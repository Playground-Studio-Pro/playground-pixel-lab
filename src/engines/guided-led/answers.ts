import { z } from "zod";
import type { DrawingProposal, ProposedGap, ProposedScreen } from "./drawing";
import type { Rounding } from "./plan";

/**
 * What the guided flow saves in the project, under `modules["guided-led"]`: the screens as confirmed on the drawing and
 * the operator's answers. Never the drawing or the render themselves: those stay in this machine's IndexedDB, because
 * how a project stores media isn't decided yet.
 */

export const GUIDED_MODULE_ID = "guided-led";
export const GUIDED_MODULE_VERSION = 1;

export interface GuidedRecord {
  readonly drawing: { readonly fileName: string; readonly kind: "vector" | "raster"; readonly width: number; readonly height: number } | null;
  readonly screens: readonly ProposedScreen[];
  readonly gaps: readonly ProposedGap[];
  /** Guesses the operator accepted, as `field:key`. */
  readonly accepted: readonly string[];
  readonly sameCabinet: boolean;
  /** Cabinet id per screen key. */
  readonly cabinetIds: Readonly<Record<string, string>>;
  readonly rounding: Readonly<Record<string, Rounding>>;
  readonly outputChoice: string | null;
  readonly outputSize: { readonly width: number; readonly height: number } | null;
  readonly outputCount: number | null;
  readonly assignment: Readonly<Record<string, number>>;
}

export const EMPTY_GUIDED_RECORD: GuidedRecord = {
  drawing: null,
  screens: [],
  gaps: [],
  accepted: [],
  sameCabinet: true,
  cabinetIds: {},
  rounding: {},
  outputChoice: null,
  outputSize: null,
  outputCount: null,
  assignment: {},
};

const finite = z.number().finite();
const int = z.number().int().safe();
const source = z.enum(["read", "typed", "guessed", "missing"]);
const sourced = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable(), source, note: z.string().max(500).optional() });
const box = z.object({ x: finite, y: finite, width: finite.positive(), height: finite.positive() });
const key = z.string().min(1).max(64);

const recordSchema = z.object({
  drawing: z.object({ fileName: z.string().max(500), kind: z.enum(["vector", "raster"]), width: finite.positive(), height: finite.positive() }).nullable(),
  screens: z.array(z.object({ key, rect: box, name: sourced(z.string().max(200)), width: sourced(int.positive()), height: sourced(int.positive()), top: sourced(int.nonnegative()) })).max(200),
  gaps: z.array(z.object({ left: key, right: key, um: sourced(int.nonnegative()) })).max(200),
  accepted: z.array(z.string().max(200)).max(2000),
  sameCabinet: z.boolean(),
  cabinetIds: z.record(key, z.string().max(200)),
  rounding: z.record(z.string().max(100), z.enum(["down", "up", "keep"])),
  outputChoice: z.string().max(100).nullable(),
  outputSize: z.object({ width: int.min(1).max(16384), height: int.min(1).max(16384) }).nullable(),
  outputCount: int.min(1).max(16).nullable(),
  assignment: z.record(key, int.min(0).max(15)),
});

/** Reads saved answers; null when they can't be read, so the flow starts fresh. */
export function parseGuidedRecord(data: unknown, version: number): GuidedRecord | null {
  if (version !== GUIDED_MODULE_VERSION) return null;
  const parsed = recordSchema.safeParse(data);
  return parsed.success ? (parsed.data as GuidedRecord) : null;
}

/** A proposal's screens and gaps, ready to save. */
export function recordFromProposal(base: GuidedRecord, proposal: Pick<DrawingProposal, "screens" | "gaps">): GuidedRecord {
  return { ...base, screens: proposal.screens, gaps: proposal.gaps };
}
