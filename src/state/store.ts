"use client";

import { create } from "zustand";
import type { CabinetProfile, Id, Project, ProjectSummary } from "@/domain/model";
import { BUILTIN_CABINETS } from "@/domain/cabinets";
import { fitViewport, zoomAt, type Viewport } from "@/engines/viewport";
import { resolveMapping, type ResolvedMapping } from "@/engines/mapping";
import { validateProject, type ValidationIssue } from "@/engines/validation";
import * as ops from "@/engines/project-ops";
import { IndexedDbCabinetLibrary, IndexedDbProjectRepository, openDatabase } from "@/persistence/indexeddb";
import { RevisionConflictError, type CabinetLibrary, type ProjectRepository } from "@/persistence/repository";
import { parseProjectFile } from "@/persistence/schema";
import * as history from "./history";
import { buildViewModel, type WorkspaceView } from "./view-model";

export type Selection =
  | { kind: "none" }
  | { kind: "screens"; ids: readonly Id[] }
  | { kind: "group"; id: Id }
  | { kind: "cabinet"; id: Id }
  | { kind: "canvas"; id: Id }
  | { kind: "output"; id: Id };

export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "conflict";

export const opContext: ops.OpContext = {
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

const LAST_PROJECT_KEY = "pixel-lab:last-project";
const AUTOSAVE_MS = 400;
const MIN_ZOOM: Record<WorkspaceView, number> = { physical: 1e-5, content: 0.01, output: 0.01 };
const MAX_ZOOM: Record<WorkspaceView, number> = { physical: 0.05, content: 40, output: 40 };

function rememberProject(id: Id | null) {
  try {
    if (id) localStorage.setItem(LAST_PROJECT_KEY, id);
    else localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // A remembered project is a convenience; blocked storage only skips it.
  }
}

function recallProject(): Id | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

interface Derived {
  mapping: ResolvedMapping | null;
  issues: readonly ValidationIssue[];
}

function derive(project: Project | null): Derived {
  if (!project) return { mapping: null, issues: [] };
  const mapping = resolveMapping(project);
  return { mapping, issues: validateProject(project, mapping) };
}

/** Drops whatever an undo or redo removed from the selection. */
export function pruneSelection(selection: Selection, project: Project): Selection {
  switch (selection.kind) {
    case "none":
      return selection;
    case "screens": {
      const ids = selection.ids.filter((id) => project.physical.screens.some((s) => s.id === id));
      if (ids.length === selection.ids.length) return selection;
      return ids.length > 0 ? { kind: "screens", ids } : { kind: "none" };
    }
    case "group":
      return project.physical.groups.some((g) => g.id === selection.id) ? selection : { kind: "none" };
    case "cabinet":
      return project.cabinets.some((c) => c.id === selection.id) ? selection : { kind: "none" };
    case "canvas":
      return project.content.canvases.some((c) => c.id === selection.id) ? selection : { kind: "none" };
    case "output":
      return project.output.outputs.some((o) => o.id === selection.id) ? selection : { kind: "none" };
  }
}

export interface EditOptions {
  /** Repeats of the same edit within a second, such as a held arrow key, undo as one step. */
  coalesce?: string;
}

export interface AppState extends Derived {
  status: "loading" | "ready" | "failed";
  startupError: string | null;
  project: Project | null;
  projects: readonly ProjectSummary[];
  library: readonly CabinetProfile[];
  saveStatus: SaveStatus;
  saveError: string | null;
  /** Undo history of the open project. Cleared when another project opens. */
  history: history.History;
  canUndo: boolean;
  canRedo: boolean;

  selection: Selection;
  view: WorkspaceView;
  activeOutputId: Id | null;
  viewports: Partial<Record<WorkspaceView, Viewport>>;
  canvasSize: { width: number; height: number };
  snapEdges: boolean;
  snapGrid: boolean;
  gridStep: number;

  init(): Promise<void>;
  refreshProjects(): Promise<void>;
  newProject(meta: { name: string; client?: string; venue?: string }): Promise<void>;
  openProject(id: Id): Promise<void>;
  closeProject(): Promise<void>;
  duplicateCurrentProject(): Promise<void>;
  deleteProject(id: Id): Promise<void>;
  importProject(text: string): Promise<void>;
  save(): Promise<void>;

  /** Applies a pure edit to the open project, records it for undo and schedules an autosave. */
  edit(change: (project: Project) => Project, options?: EditOptions): void;
  undo(): void;
  redo(): void;
  saveToLibrary(cabinet: CabinetProfile): Promise<void>;
  select(selection: Selection): void;
  setView(view: WorkspaceView): void;
  setActiveOutput(id: Id): void;
  setViewport(view: WorkspaceView, viewport: Viewport): void;
  setCanvasSize(width: number, height: number): void;
  setSnap(patch: Partial<Pick<AppState, "snapEdges" | "snapGrid" | "gridStep">>): void;
  fit(): void;
  zoomBy(factor: number): void;
  zoomActual(): void;
}

let repo: ProjectRepository | null = null;
let initStarted = false;
let cabinetLibrary: CabinetLibrary | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
/** Saves run one at a time, in order, so revisions can't interleave. */
let saveChain: Promise<void> = Promise.resolve();
/** Counts edits, so a save that finishes after newer edits doesn't mark them as saved. */
let editCounter = 0;

function mergeLibrary(stored: readonly CabinetProfile[]): CabinetProfile[] {
  return [...BUILTIN_CABINETS, ...stored.filter((c) => c.source === "custom")];
}

const noHistory = { history: history.emptyHistory, canUndo: false, canRedo: false };

function historyState(h: history.History) {
  return { history: h, canUndo: history.canUndo(h), canRedo: history.canRedo(h) };
}

export const useApp = create<AppState>((set, get) => {
  const flushAutosave = () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  };

  const adopt = (project: Project) => {
    flushAutosave();
    editCounter = 0;
    rememberProject(project.id);
    const firstOutput = project.output.outputs[0]?.id ?? null;
    set({
      project,
      ...derive(project),
      ...noHistory,
      selection: { kind: "none" },
      view: "content",
      activeOutputId: firstOutput,
      viewports: {},
      saveStatus: "saved",
      saveError: null,
    });
  };

  /** Shows a changed project and schedules its autosave. */
  const apply = (next: Project, extra: Partial<AppState>) => {
    editCounter++;
    set({ project: next, ...derive(next), ...extra, saveStatus: "unsaved" });
    flushAutosave();
    autosaveTimer = setTimeout(() => void get().save(), AUTOSAVE_MS);
  };

  const travel = (step: typeof history.undo) => {
    const { project, saveStatus, selection, activeOutputId } = get();
    if (!project || saveStatus === "conflict") return;
    const result = step(get().history, project);
    if (!result) return;
    const next = result.project;
    const outputExists = next.output.outputs.some((o) => o.id === activeOutputId);
    apply(next, {
      ...historyState(result.history),
      selection: pruneSelection(selection, next),
      activeOutputId: outputExists ? activeOutputId : (next.output.outputs[0]?.id ?? null),
    });
  };

  return {
    status: "loading",
    startupError: null,
    project: null,
    mapping: null,
    issues: [],
    projects: [],
    library: BUILTIN_CABINETS,
    saveStatus: "saved",
    saveError: null,
    ...noHistory,
    selection: { kind: "none" },
    view: "content",
    activeOutputId: null,
    viewports: {},
    canvasSize: { width: 0, height: 0 },
    snapEdges: true,
    snapGrid: false,
    gridStep: 8,

    async init() {
      if (initStarted) return;
      initStarted = true;
      try {
        const db = await openDatabase();
        repo = new IndexedDbProjectRepository(db);
        cabinetLibrary = new IndexedDbCabinetLibrary(db);
        // Asks the browser not to evict project data under storage pressure. Best effort.
        void navigator.storage?.persist?.().catch(() => undefined);
        const [projects, stored] = await Promise.all([repo.list(), cabinetLibrary.list()]);
        set({ projects, library: mergeLibrary(stored) });
        const last = recallProject();
        if (last && projects.some((p) => p.id === last)) {
          const project = await repo.load(last);
          if (project) adopt(project);
        }
        set({ status: "ready" });
      } catch (error) {
        set({ status: "failed", startupError: error instanceof Error ? error.message : String(error) });
      }
    },

    async refreshProjects() {
      if (repo) set({ projects: await repo.list() });
    },

    async newProject(meta) {
      await get().save();
      const project = ops.createProject(meta, opContext);
      await repo!.save(project, 0);
      adopt(project);
      await get().refreshProjects();
    },

    async openProject(id) {
      await get().save();
      const project = await repo!.load(id);
      if (!project) throw new Error("That project no longer exists.");
      adopt(project);
      await get().refreshProjects();
    },

    async closeProject() {
      await get().save();
      rememberProject(null);
      set({ project: null, ...derive(null), ...noHistory, selection: { kind: "none" } });
      await get().refreshProjects();
    },

    async duplicateCurrentProject() {
      await get().save();
      const current = get().project;
      if (!current) return;
      const copy = ops.duplicateProject(current, opContext);
      await repo!.save(copy, 0);
      adopt(copy);
      await get().refreshProjects();
    },

    async deleteProject(id) {
      if (get().project?.id === id) {
        flushAutosave();
        rememberProject(null);
        set({ project: null, ...derive(null), ...noHistory, selection: { kind: "none" }, saveStatus: "saved" });
      }
      await repo!.delete(id);
      await get().refreshProjects();
    },

    async importProject(text) {
      await get().save();
      const imported = parseProjectFile(text);
      // Always a new project: importing a file can never overwrite existing work.
      const project = ops.duplicateProject(imported, opContext, imported.meta.name);
      await repo!.save(project, 0);
      adopt(project);
      await get().refreshProjects();
    },

    save() {
      flushAutosave();
      saveChain = saveChain.then(async () => {
        const { project, saveStatus } = get();
        if (!project || !repo || saveStatus === "saved" || saveStatus === "conflict") return;
        const editsAtStart = editCounter;
        const updatedAt = opContext.now();
        const revision = project.meta.revision + 1;
        const next: Project = { ...project, meta: { ...project.meta, updatedAt, revision } };
        set({ saveStatus: "saving" });
        try {
          await repo.save(next, project.meta.revision);
          set((state) => {
            const current = state.project;
            if (!current || current.id !== project.id) return {};
            return {
              project: { ...current, meta: { ...current.meta, updatedAt, revision } },
              saveStatus: editCounter === editsAtStart ? "saved" : "unsaved",
              saveError: null,
            };
          });
          await get().refreshProjects();
        } catch (error) {
          set({
            saveStatus: error instanceof RevisionConflictError ? "conflict" : "error",
            saveError: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return saveChain;
    },

    edit(change, options) {
      const { project, saveStatus } = get();
      if (!project || saveStatus === "conflict") return;
      const next = change(project);
      if (next === project) return;
      apply(next, historyState(history.record(get().history, project, { key: options?.coalesce, now: Date.now() })));
    },

    undo() {
      travel(history.undo);
    },

    redo() {
      travel(history.redo);
    },

    async saveToLibrary(cabinet) {
      await cabinetLibrary!.upsert(cabinet);
      set({ library: mergeLibrary(await cabinetLibrary!.list()) });
    },

    select(selection) {
      set(selection.kind === "output" ? { selection, activeOutputId: selection.id } : { selection });
    },
    setView(view) {
      set({ view });
    },
    setActiveOutput(id) {
      set({ activeOutputId: id });
    },
    setViewport(view, viewport) {
      set((state) => ({ viewports: { ...state.viewports, [view]: viewport } }));
    },
    setCanvasSize(width, height) {
      set({ canvasSize: { width, height } });
    },
    setSnap(patch) {
      set(patch);
    },

    fit() {
      const { project, mapping, view, activeOutputId, canvasSize } = get();
      if (!project || !mapping) return;
      const model = buildViewModel(project, mapping, view, activeOutputId);
      get().setViewport(view, fitViewport(model.bounds, canvasSize.width, canvasSize.height));
    },

    zoomBy(factor) {
      const { view, viewports, canvasSize } = get();
      const current = viewports[view];
      if (!current) return;
      get().setViewport(view, zoomAt(current, factor, canvasSize.width / 2, canvasSize.height / 2, MIN_ZOOM[view], MAX_ZOOM[view]));
    },

    /** One LED pixel on one screen pixel. The physical view has no such scale, so it fits instead. */
    zoomActual() {
      const { view, viewports, canvasSize } = get();
      const current = viewports[view];
      if (!current || view === "physical") {
        get().fit();
        return;
      }
      get().setViewport(view, zoomAt(current, 1 / current.scale, canvasSize.width / 2, canvasSize.height / 2, MIN_ZOOM[view], MAX_ZOOM[view]));
    },
  };
});

export const zoomLimits = { MIN_ZOOM, MAX_ZOOM };

export function selectedScreenIds(selection: Selection, project: Project | null): readonly Id[] {
  if (selection.kind === "screens") return selection.ids;
  if (selection.kind === "group" && project) {
    return project.physical.screens.filter((s) => s.groupId === selection.id).map((s) => s.id);
  }
  return [];
}
