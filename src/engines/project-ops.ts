import type {
  CabinetProfile,
  CanvasSizing,
  ContentCanvas,
  ContentRegion,
  Id,
  LedScreen,
  OutputSlice,
  Project,
  ProjectMeta,
  VideoOutput,
} from "@/domain/model";
import { SCHEMA_VERSION } from "@/domain/model";
import { px, um, type Px, type Um } from "@/domain/units";
import { bottom, right } from "./geometry";
import { resolveMapping } from "./mapping";
import { computeScreenSpec } from "./physical";

/** Pure project edits. Ids and time are injected, so every operation is deterministic and testable. */
export interface OpContext {
  newId(): Id;
  now(): string;
}

export class DomainError extends Error {}

const SCREEN_COLORS = ["#2F6FE4", "#17A398", "#7A5FE8", "#D9902F", "#3FA34D", "#D2554A", "#B14FC9", "#5C8DA8"];
const STAGE_GAP_UM = 1_000_000; // 1 m between auto-placed screens
const MAX_ARRANGEMENT = 1000;

function nextColor(project: Project): string {
  return SCREEN_COLORS[project.physical.screens.length % SCREEN_COLORS.length];
}

function requireName(name: string, what: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new DomainError(`${what} needs a name.`);
  return trimmed;
}

function requireArrangement(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ARRANGEMENT) {
    throw new DomainError(`${what} must be a whole number from 1 to ${MAX_ARRANGEMENT}.`);
  }
}

function requireNonNegative(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError(`${what} must be a whole number of 0 or more.`);
  }
}

export function validateSizing(sizing: CanvasSizing): void {
  if (sizing.mode === "fixed" && (!Number.isSafeInteger(sizing.width) || !Number.isSafeInteger(sizing.height) || sizing.width < 1 || sizing.height < 1)) {
    throw new DomainError("Width and height must be whole numbers of at least 1 px.");
  }
}

export function validateCabinet(input: Omit<CabinetProfile, "id" | "source">): void {
  requireName(input.name, "A cabinet");
  const positive = (value: number, what: string) => {
    if (!Number.isSafeInteger(value) || value <= 0) throw new DomainError(`${what} must be greater than 0.`);
  };
  positive(input.widthUm, "Cabinet width");
  positive(input.heightUm, "Cabinet height");
  positive(input.pixelsX, "Horizontal pixels");
  positive(input.pixelsY, "Vertical pixels");
  positive(input.nominalPitchUm, "Pixel pitch");
}

// ─── Projects ──────────────────────────────────────────────────────────────

export function createProject(meta: Pick<ProjectMeta, "name"> & Partial<Pick<ProjectMeta, "client" | "venue" | "notes">>, ctx: OpContext): Project {
  const now = ctx.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: ctx.newId(),
    meta: {
      name: requireName(meta.name, "A project"),
      client: meta.client?.trim() ?? "",
      venue: meta.venue?.trim() ?? "",
      notes: meta.notes ?? "",
      createdAt: now,
      updatedAt: now,
      revision: 0,
    },
    cabinets: [],
    physical: { screens: [], groups: [] },
    content: {
      master: { mode: "auto" },
      canvases: [{ id: ctx.newId(), name: "Main canvas", originX: px(0), originY: px(0) }],
      regions: [],
    },
    output: {
      outputs: [{ id: ctx.newId(), name: "Output 1", sizing: { mode: "auto" } }],
      slices: [],
    },
  };
}

/** A new, independent project with fresh ids. Name defaults to “<name> copy”. */
export function duplicateProject(project: Project, ctx: OpContext, name?: string): Project {
  const now = ctx.now();
  return {
    ...project,
    id: ctx.newId(),
    meta: { ...project.meta, name: name ?? `${project.meta.name} copy`, createdAt: now, updatedAt: now, revision: 0 },
  };
}

export function updateMeta(project: Project, patch: Partial<Pick<ProjectMeta, "name" | "client" | "venue" | "notes">>): Project {
  if (patch.name !== undefined) requireName(patch.name, "A project");
  return { ...project, meta: { ...project.meta, ...patch } };
}

// ─── Cabinets ──────────────────────────────────────────────────────────────

/** Copies a profile into the project. No-op if already present. */
export function addCabinet(project: Project, cabinet: CabinetProfile): Project {
  if (project.cabinets.some((c) => c.id === cabinet.id)) return project;
  validateCabinet(cabinet);
  return { ...project, cabinets: [...project.cabinets, cabinet] };
}

export function updateCabinet(project: Project, id: Id, patch: Partial<Omit<CabinetProfile, "id" | "source">>): Project {
  const existing = project.cabinets.find((c) => c.id === id);
  if (!existing) throw new DomainError("That cabinet is no longer in this project.");
  if (existing.source === "builtin") throw new DomainError("Generic profiles can't be edited. Duplicate it as a custom profile first.");
  validateCabinet({ ...existing, ...patch });
  return { ...project, cabinets: project.cabinets.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function removeCabinet(project: Project, id: Id): Project {
  const users = project.physical.screens.filter((s) => s.cabinetId === id);
  if (users.length > 0) {
    throw new DomainError(`Can't remove this cabinet: it's used by ${users.map((s) => s.name).join(", ")}.`);
  }
  return { ...project, cabinets: project.cabinets.filter((c) => c.id !== id) };
}

// ─── Screens ───────────────────────────────────────────────────────────────

export interface NewScreenInput {
  readonly name: string;
  readonly cabinetId: Id;
  readonly columns: number;
  readonly rows: number;
}

/** First free spot to the right of everything in the content layout, and in the output layout. */
function appendScreen(project: Project, screen: LedScreen, canvasId: Id, outputId: Id, allowOverlap: boolean, position?: { x: Px; y: Px }): Project {
  const canvas = project.content.canvases.find((c) => c.id === canvasId);
  if (!canvas) throw new DomainError("Choose a content canvas that exists.");
  const mapping = resolveMapping(project);
  const canvasScreens = mapping.screens.filter((s) => s.canvasId === canvasId);
  const region: ContentRegion = {
    screenId: screen.id,
    canvasId,
    x: position?.x ?? px(Math.max(0, ...canvasScreens.map((s) => right(s.canvasRect)))),
    y: position?.y ?? px(0),
    allowOverlap,
  };
  const slice: OutputSlice = { screenId: screen.id, outputId, followsContent: true, x: px(0), y: px(0) };
  return {
    ...project,
    physical: { ...project.physical, screens: [...project.physical.screens, screen] },
    content: { ...project.content, regions: [...project.content.regions, region] },
    output: { ...project.output, slices: [...project.output.slices, slice] },
  };
}

export function addScreen(project: Project, input: NewScreenInput, ctx: OpContext): Project {
  requireArrangement(input.columns, "Columns");
  requireArrangement(input.rows, "Rows");
  if (!project.cabinets.some((c) => c.id === input.cabinetId)) {
    throw new DomainError("Choose a cabinet profile before adding a screen.");
  }
  const mapping = resolveMapping(project);
  const stageX = project.physical.screens.length === 0 ? 0 : Math.max(...mapping.screens.map((s) => right(s.stage))) + STAGE_GAP_UM;
  const screen: LedScreen = {
    id: ctx.newId(),
    name: requireName(input.name, "A screen"),
    cabinetId: input.cabinetId,
    columns: input.columns,
    rows: input.rows,
    groupId: null,
    color: nextColor(project),
    stageX: um(stageX),
    stageY: um(0),
  };
  return appendScreen(project, screen, project.content.canvases[0].id, project.output.outputs[0].id, false);
}

export function updateScreen(project: Project, id: Id, patch: Partial<Pick<LedScreen, "name" | "cabinetId" | "columns" | "rows" | "groupId">>): Project {
  if (patch.name !== undefined) requireName(patch.name, "A screen");
  if (patch.columns !== undefined) requireArrangement(patch.columns, "Columns");
  if (patch.rows !== undefined) requireArrangement(patch.rows, "Rows");
  if (patch.cabinetId !== undefined && !project.cabinets.some((c) => c.id === patch.cabinetId)) {
    throw new DomainError("Choose a cabinet profile in this project.");
  }
  return {
    ...project,
    physical: {
      ...project.physical,
      screens: project.physical.screens.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    },
  };
}

function uniqueCopyName(project: Project, base: string): string {
  const names = new Set(project.physical.screens.map((s) => s.name));
  let candidate = `${base} copy`;
  for (let n = 2; names.has(candidate); n++) candidate = `${base} copy ${n}`;
  return candidate;
}

export function duplicateScreen(project: Project, id: Id, ctx: OpContext): { project: Project; newId: Id } {
  const source = project.physical.screens.find((s) => s.id === id);
  if (!source) throw new DomainError("That screen no longer exists.");
  const region = project.content.regions.find((r) => r.screenId === id);
  const slice = project.output.slices.find((s) => s.screenId === id);
  if (!region || !slice) throw new DomainError(`“${source.name}” has no mapping to copy.`);
  const cabinet = project.cabinets.find((c) => c.id === source.cabinetId);
  if (!cabinet) throw new DomainError(`“${source.name}” has no cabinet profile to copy.`);

  const mapping = resolveMapping(project);
  const newId = ctx.newId();
  const stageX = Math.max(...mapping.screens.map((s) => right(s.stage))) + STAGE_GAP_UM;
  const copy: LedScreen = {
    ...source,
    id: newId,
    name: uniqueCopyName(project, source.name),
    color: nextColor(project),
    stageX: um(stageX),
  };
  const next = appendScreen(project, copy, region.canvasId, slice.outputId, region.allowOverlap);
  return { project: next, newId };
}

export function deleteScreens(project: Project, ids: readonly Id[]): Project {
  const gone = new Set(ids);
  const screens = project.physical.screens.filter((s) => !gone.has(s.id));
  const usedGroups = new Set(screens.map((s) => s.groupId));
  return {
    ...project,
    physical: { screens, groups: project.physical.groups.filter((g) => usedGroups.has(g.id)) },
    content: { ...project.content, regions: project.content.regions.filter((r) => !gone.has(r.screenId)) },
    output: { ...project.output, slices: project.output.slices.filter((s) => !gone.has(s.screenId)) },
  };
}

// ─── Groups ────────────────────────────────────────────────────────────────

export function groupScreens(project: Project, ids: readonly Id[], name: string, ctx: OpContext): { project: Project; groupId: Id } {
  if (ids.length < 2) throw new DomainError("Select at least two screens to group.");
  const groupId = ctx.newId();
  const members = new Set(ids);
  const screens = project.physical.screens.map((s) => (members.has(s.id) ? { ...s, groupId } : s));
  const used = new Set(screens.map((s) => s.groupId));
  return {
    groupId,
    project: {
      ...project,
      physical: {
        screens,
        groups: [...project.physical.groups.filter((g) => used.has(g.id)), { id: groupId, name: requireName(name, "A group") }],
      },
    },
  };
}

export function ungroup(project: Project, groupId: Id): Project {
  return {
    ...project,
    physical: {
      screens: project.physical.screens.map((s) => (s.groupId === groupId ? { ...s, groupId: null } : s)),
      groups: project.physical.groups.filter((g) => g.id !== groupId),
    },
  };
}

export function renameGroup(project: Project, groupId: Id, name: string): Project {
  const trimmed = requireName(name, "A group");
  return {
    ...project,
    physical: {
      ...project.physical,
      groups: project.physical.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)),
    },
  };
}

// ─── Positions ─────────────────────────────────────────────────────────────

export function setStagePositions(project: Project, positions: readonly { id: Id; x: Um; y: Um }[]): Project {
  const byId = new Map(positions.map((p) => [p.id, p]));
  return {
    ...project,
    physical: {
      ...project.physical,
      screens: project.physical.screens.map((s) => {
        const p = byId.get(s.id);
        return p ? { ...s, stageX: p.x, stageY: p.y } : s;
      }),
    },
  };
}

/** Sets regions from master-space positions, converting into each region's canvas space. */
export function setMasterPositions(project: Project, positions: readonly { id: Id; x: Px; y: Px }[]): Project {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const canvases = new Map(project.content.canvases.map((c) => [c.id, c]));
  return {
    ...project,
    content: {
      ...project.content,
      regions: project.content.regions.map((r) => {
        const p = byId.get(r.screenId);
        const canvas = canvases.get(r.canvasId);
        if (!p || !canvas) return r;
        requireNonNegative(p.x - canvas.originX, "Canvas X");
        requireNonNegative(p.y - canvas.originY, "Canvas Y");
        return { ...r, x: px(p.x - canvas.originX), y: px(p.y - canvas.originY) };
      }),
    },
  };
}

/** Sets a region directly in canvas space (custom screen coordinates). */
export function setRegionPosition(project: Project, screenId: Id, x: Px, y: Px): Project {
  requireNonNegative(x, "Canvas X");
  requireNonNegative(y, "Canvas Y");
  return {
    ...project,
    content: {
      ...project.content,
      regions: project.content.regions.map((r) => (r.screenId === screenId ? { ...r, x, y } : r)),
    },
  };
}

export function setRegionShared(project: Project, screenId: Id, allowOverlap: boolean): Project {
  return {
    ...project,
    content: {
      ...project.content,
      regions: project.content.regions.map((r) => (r.screenId === screenId ? { ...r, allowOverlap } : r)),
    },
  };
}

/** Removes unused space: each canvas shrinks to its regions, then everything shifts so content starts at (0, 0). */
export function trimContent(project: Project): Project {
  const mapping = resolveMapping(project);
  const box = mapping.master.contentBounds;
  if (!box) return project;

  const minLocal = new Map<Id, { x: number; y: number }>();
  for (const s of mapping.screens) {
    const current = minLocal.get(s.canvasId);
    minLocal.set(s.canvasId, {
      x: Math.min(current?.x ?? Infinity, s.canvasRect.x),
      y: Math.min(current?.y ?? Infinity, s.canvasRect.y),
    });
  }
  return {
    ...project,
    content: {
      ...project.content,
      canvases: project.content.canvases.map((canvas) => {
        const min = minLocal.get(canvas.id);
        if (!min) return canvas;
        return { ...canvas, originX: px(canvas.originX + min.x - box.x), originY: px(canvas.originY + min.y - box.y) };
      }),
      regions: project.content.regions.map((r) => {
        const min = minLocal.get(r.canvasId);
        return min ? { ...r, x: px(r.x - min.x), y: px(r.y - min.y) } : r;
      }),
    },
  };
}

export function setMasterSizing(project: Project, sizing: CanvasSizing): Project {
  validateSizing(sizing);
  return { ...project, content: { ...project.content, master: sizing } };
}

// ─── Canvases ──────────────────────────────────────────────────────────────

export function addCanvas(project: Project, name: string, ctx: OpContext): { project: Project; canvasId: Id } {
  const mapping = resolveMapping(project);
  const canvas: ContentCanvas = {
    id: ctx.newId(),
    name: requireName(name, "A canvas"),
    originX: px(0),
    originY: px(mapping.screens.length ? Math.max(...mapping.screens.map((s) => bottom(s.masterRect))) : 0),
  };
  return { canvasId: canvas.id, project: { ...project, content: { ...project.content, canvases: [...project.content.canvases, canvas] } } };
}

export function updateCanvas(project: Project, id: Id, patch: Partial<Pick<ContentCanvas, "name" | "originX" | "originY">>): Project {
  if (patch.name !== undefined) requireName(patch.name, "A canvas");
  if (patch.originX !== undefined) requireNonNegative(patch.originX, "Canvas origin X");
  if (patch.originY !== undefined) requireNonNegative(patch.originY, "Canvas origin Y");
  return {
    ...project,
    content: {
      ...project.content,
      canvases: project.content.canvases.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    },
  };
}

export function removeCanvas(project: Project, id: Id): Project {
  if (project.content.canvases.length <= 1) throw new DomainError("A project needs at least one content canvas.");
  if (project.content.regions.some((r) => r.canvasId === id)) {
    throw new DomainError("Move this canvas's screens to another canvas before removing it.");
  }
  return { ...project, content: { ...project.content, canvases: project.content.canvases.filter((c) => c.id !== id) } };
}

/** Moves a screen to another canvas. It keeps its master position when the target canvas's origin allows it. */
export function assignCanvas(project: Project, screenId: Id, canvasId: Id): Project {
  const target = project.content.canvases.find((c) => c.id === canvasId);
  if (!target) throw new DomainError("Choose a content canvas that exists.");
  const resolved = resolveMapping(project).screens.find((s) => s.screenId === screenId);
  return {
    ...project,
    content: {
      ...project.content,
      regions: project.content.regions.map((r) =>
        r.screenId === screenId
          ? {
              ...r,
              canvasId,
              x: px(Math.max(0, (resolved?.masterRect.x ?? target.originX) - target.originX)),
              y: px(Math.max(0, (resolved?.masterRect.y ?? target.originY) - target.originY)),
            }
          : r,
      ),
    },
  };
}

/** Gives a screen its own canvas at its current master position, so nothing moves on screen. */
export function makeScreenIndependent(project: Project, screenId: Id, ctx: OpContext): { project: Project; canvasId: Id } {
  const resolved = resolveMapping(project).screens.find((s) => s.screenId === screenId);
  if (!resolved) throw new DomainError("That screen can't be mapped yet.");
  const canvas: ContentCanvas = { id: ctx.newId(), name: `${resolved.name} canvas`, originX: resolved.masterRect.x, originY: resolved.masterRect.y };
  return {
    canvasId: canvas.id,
    project: {
      ...project,
      content: {
        ...project.content,
        canvases: [...project.content.canvases, canvas],
        regions: project.content.regions.map((r) => (r.screenId === screenId ? { ...r, canvasId: canvas.id, x: px(0), y: px(0) } : r)),
      },
    },
  };
}

// ─── Outputs ───────────────────────────────────────────────────────────────

export function addOutput(project: Project, name: string, ctx: OpContext): { project: Project; outputId: Id } {
  const output: VideoOutput = { id: ctx.newId(), name: requireName(name, "An output"), sizing: { mode: "auto" } };
  return { outputId: output.id, project: { ...project, output: { ...project.output, outputs: [...project.output.outputs, output] } } };
}

export function updateOutput(project: Project, id: Id, patch: Partial<Pick<VideoOutput, "name" | "sizing">>): Project {
  if (patch.name !== undefined) requireName(patch.name, "An output");
  if (patch.sizing) validateSizing(patch.sizing);
  return {
    ...project,
    output: { ...project.output, outputs: project.output.outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)) },
  };
}

export function removeOutput(project: Project, id: Id): Project {
  if (project.output.outputs.length <= 1) throw new DomainError("A project needs at least one output.");
  if (project.output.slices.some((s) => s.outputId === id)) {
    throw new DomainError("Move this output's screens to another output before removing it.");
  }
  return { ...project, output: { ...project.output, outputs: project.output.outputs.filter((o) => o.id !== id) } };
}

/** Sets a slice's position in output space. It stops following the content position. */
export function setSlicePositions(project: Project, positions: readonly { id: Id; x: Px; y: Px }[]): Project {
  const byId = new Map(positions.map((p) => [p.id, p]));
  for (const p of positions) {
    requireNonNegative(p.x, "Output X");
    requireNonNegative(p.y, "Output Y");
  }
  return {
    ...project,
    output: {
      ...project.output,
      slices: project.output.slices.map((s) => {
        const p = byId.get(s.screenId);
        return p ? { ...s, x: p.x, y: p.y, followsContent: false } : s;
      }),
    },
  };
}

/** Turning follow off keeps the slice where it currently is, so it doesn't jump. */
export function setSliceFollowsContent(project: Project, screenId: Id, follows: boolean): Project {
  const resolved = resolveMapping(project).screens.find((s) => s.screenId === screenId);
  return {
    ...project,
    output: {
      ...project.output,
      slices: project.output.slices.map((s) =>
        s.screenId === screenId
          ? { ...s, followsContent: follows, x: resolved?.outputRect.x ?? s.x, y: resolved?.outputRect.y ?? s.y }
          : s,
      ),
    },
  };
}

export function assignOutput(project: Project, screenId: Id, outputId: Id): Project {
  if (!project.output.outputs.some((o) => o.id === outputId)) throw new DomainError("Choose an output that exists.");
  return {
    ...project,
    output: { ...project.output, slices: project.output.slices.map((s) => (s.screenId === screenId ? { ...s, outputId } : s)) },
  };
}

export { computeScreenSpec };
