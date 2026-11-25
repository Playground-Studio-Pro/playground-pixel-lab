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

/** Screen colors offered in the inspector and assigned to new screens in turn. */
export const SCREEN_COLORS = ["#2F6FE4", "#17A398", "#7A5FE8", "#D9902F", "#3FA34D", "#D2554A", "#B14FC9", "#5C8DA8"] as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
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
    modules: {},
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

// ─── Module data ───────────────────────────────────────────────────────────

const MODULE_ID = /^[a-z][a-z0-9-]*$/;

/** Stores one module's saved data, replacing what it had. `data` must be plain JSON. */
export function setModuleData(project: Project, moduleId: string, version: number, data: unknown): Project {
  if (!MODULE_ID.test(moduleId)) throw new DomainError(`"${moduleId}" isn't a valid module id.`);
  if (!Number.isSafeInteger(version) || version < 1) throw new DomainError("A module data version must be a whole number of 1 or more.");
  if (!isPlainJson(data)) throw new DomainError(`Data for module "${moduleId}" must be plain JSON.`);
  return { ...project, modules: { ...project.modules, [moduleId]: { version, data } } };
}

export function removeModuleData(project: Project, moduleId: string): Project {
  if (!(moduleId in project.modules)) return project;
  const modules = { ...project.modules };
  delete modules[moduleId];
  return { ...project, modules };
}

/** True for values that survive `JSON.stringify` and `JSON.parse` unchanged. */
export function isPlainJson(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isPlainJson(v, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value as Record<string, unknown>).every((v) => v !== undefined && isPlainJson(v, depth + 1));
  }
  return false;
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

export function updateScreen(project: Project, id: Id, patch: Partial<Pick<LedScreen, "name" | "cabinetId" | "columns" | "rows" | "groupId" | "color">>): Project {
  if (patch.name !== undefined) requireName(patch.name, "A screen");
  if (patch.color !== undefined) {
    if (!HEX_COLOR.test(patch.color)) throw new DomainError("A screen color is a hex value such as #2F6FE4.");
    patch = { ...patch, color: patch.color.toUpperCase() };
  }
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

// ─── Fast map ──────────────────────────────────────────────────────────────
// Added for the fast map flow (`engines/fast-map/`). Each is one atomic edit, so through `edit()` it is one undo step.

/** One screen to create, with every position already decided. Positions are in the named space. */
export interface PlannedScreen {
  readonly name: string;
  readonly cabinet: CabinetProfile;
  readonly columns: number;
  readonly rows: number;
  /** Stage space, micrometres. */
  readonly stageX: Um;
  readonly stageY: Um;
  /** Master space, pixels. Converted into the first canvas's space when applied. */
  readonly masterX: Px;
  readonly masterY: Px;
  /** An output already in the project, or the n-th output listed in `ScreenPlan.newOutputs`. */
  readonly output: { readonly kind: "existing"; readonly id: Id } | { readonly kind: "new"; readonly index: number };
  /** Output space, pixels. */
  readonly outputX: Px;
  readonly outputY: Px;
}

export interface ScreenPlan {
  readonly screens: readonly PlannedScreen[];
  /** Outputs to create, fixed at these sizes, in order. */
  readonly newOutputs: readonly { readonly width: Px; readonly height: Px }[];
}

/**
 * A project with no screens, ready for a new list: every screen, group, extra canvas and output is removed, the first
 * canvas moves to (0, 0), the master goes back to auto size. The first output is kept (its id and name) for reuse.
 * Cabinets, metadata and module data stay.
 */
export function clearScreens(project: Project): Project {
  const canvas = project.content.canvases[0];
  const output = project.output.outputs[0];
  return {
    ...project,
    physical: { screens: [], groups: [] },
    content: { master: { mode: "auto" }, canvases: [{ ...canvas, originX: px(0), originY: px(0) }], regions: [] },
    output: { outputs: [output], slices: [] },
  };
}

/**
 * Creates every screen of a plan in one edit. Each slice is placed explicitly (“Same as content position” off), so
 * moving content later never moves an output. New outputs are fixed at their planned size; when `reuseFirstOutput` is
 * set, the first new output is the project's first output, resized. Returns the new screen ids in plan order.
 */
export function applyScreenPlan(project: Project, plan: ScreenPlan, ctx: OpContext, options: { reuseFirstOutput?: boolean } = {}): { project: Project; screenIds: Id[] } {
  if (plan.screens.length === 0) throw new DomainError("The list has no screens.");
  const canvas = project.content.canvases[0];
  const ids = new Set<Id>([project.id, ...project.physical.screens.map((s) => s.id), ...project.content.canvases.map((c) => c.id), ...project.output.outputs.map((o) => o.id)]);
  const fresh = () => {
    const id = ctx.newId();
    if (ids.has(id)) throw new DomainError(`Id “${id}” is already used in this project.`);
    ids.add(id);
    return id;
  };
  const freshCtx: OpContext = { newId: fresh, now: () => ctx.now() };
  let next = project;
  const newOutputIds: Id[] = [];
  plan.newOutputs.forEach((size, i) => {
    const sizing: CanvasSizing = { mode: "fixed", width: size.width, height: size.height };
    validateSizing(sizing);
    if (i === 0 && options.reuseFirstOutput) {
      const first = next.output.outputs[0];
      next = updateOutput(next, first.id, { sizing });
      newOutputIds.push(first.id);
    } else {
      const added = addOutput(next, `Output ${next.output.outputs.length + 1}`, freshCtx);
      next = updateOutput(added.project, added.outputId, { sizing });
      newOutputIds.push(added.outputId);
    }
  });

  const names = new Set(next.physical.screens.map((s) => s.name.trim().toLowerCase()));
  const screens: LedScreen[] = [];
  const regions: ContentRegion[] = [];
  const slices: OutputSlice[] = [];
  for (const planned of plan.screens) {
    requireArrangement(planned.columns, "Columns");
    requireArrangement(planned.rows, "Rows");
    const name = requireName(planned.name, "A screen");
    if (names.has(name.toLowerCase())) throw new DomainError(`“${name}” is already a screen name.`);
    names.add(name.toLowerCase());
    next = addCabinet(next, planned.cabinet);
    const outputId = planned.output.kind === "existing" ? planned.output.id : newOutputIds[planned.output.index];
    if (!outputId || !next.output.outputs.some((o) => o.id === outputId)) throw new DomainError(`“${name}” points to an output that doesn't exist.`);
    requireNonNegative(planned.masterX - canvas.originX, "Canvas X");
    requireNonNegative(planned.masterY - canvas.originY, "Canvas Y");
    requireNonNegative(planned.outputX, "Output X");
    requireNonNegative(planned.outputY, "Output Y");
    const id = fresh();
    screens.push({
      id,
      name,
      cabinetId: planned.cabinet.id,
      columns: planned.columns,
      rows: planned.rows,
      groupId: null,
      color: SCREEN_COLORS[(next.physical.screens.length + screens.length) % SCREEN_COLORS.length],
      stageX: um(planned.stageX),
      stageY: um(planned.stageY),
    });
    regions.push({ screenId: id, canvasId: canvas.id, x: px(planned.masterX - canvas.originX), y: px(planned.masterY - canvas.originY), allowOverlap: false });
    slices.push({ screenId: id, outputId, followsContent: false, x: px(planned.outputX), y: px(planned.outputY) });
  }
  return {
    screenIds: screens.map((s) => s.id),
    project: {
      ...next,
      physical: { ...next.physical, screens: [...next.physical.screens, ...screens] },
      content: { ...next.content, regions: [...next.content.regions, ...regions] },
      output: { ...next.output, slices: [...next.output.slices, ...slices] },
    },
  };
}

function resolvedPair(project: Project, a: Id, b: Id) {
  if (a === b) throw new DomainError("Choose two different screens.");
  const mapping = resolveMapping(project);
  const first = mapping.screens.find((s) => s.screenId === a);
  const second = mapping.screens.find((s) => s.screenId === b);
  if (!first || !second) throw new DomainError("Both screens must exist and be mapped.");
  if (first.outputRect.width !== second.outputRect.width || first.outputRect.height !== second.outputRect.height) {
    throw new DomainError(
      `“${first.name}” is ${first.outputRect.width}×${first.outputRect.height} px and “${second.name}” is ${second.outputRect.width}×${second.outputRect.height} px. Only screens of the same size can do this 1:1.`,
    );
  }
  return [first, second] as const;
}

/**
 * Two same-size screens trade output and output position. Their content doesn't move. Both slices become explicit
 * (“Same as content position” off), so a later content move can't undo the swap.
 */
export function swapOutputs(project: Project, a: Id, b: Id): Project {
  const [first, second] = resolvedPair(project, a, b);
  const to = new Map([
    [a, second],
    [b, first],
  ]);
  return {
    ...project,
    output: {
      ...project.output,
      slices: project.output.slices.map((s) => {
        const other = to.get(s.screenId);
        return other ? { ...s, outputId: other.outputId, x: other.outputRect.x, y: other.outputRect.y, followsContent: false } : s;
      }),
    },
  };
}

/**
 * The second screen shows the same content as the first: it takes the first's canvas and position, and both are
 * marked as sharing pixels. The second's output stays exactly where it was, whether or not it followed its content
 * before, so the wall keeps its signal. The first screen's output doesn't move either.
 */
export function sameContent(project: Project, fromId: Id, toId: Id): Project {
  const [from, to] = resolvedPair(project, fromId, toId);
  return {
    ...project,
    content: {
      ...project.content,
      regions: project.content.regions.map((r) => {
        if (r.screenId === fromId) return { ...r, allowOverlap: true };
        if (r.screenId === toId) return { ...r, canvasId: from.canvasId, x: from.canvasRect.x, y: from.canvasRect.y, allowOverlap: true };
        return r;
      }),
    },
    output: {
      ...project.output,
      slices: project.output.slices.map((s) => (s.screenId === toId ? { ...s, followsContent: false, x: to.outputRect.x, y: to.outputRect.y } : s)),
    },
  };
}

export { computeScreenSpec };
