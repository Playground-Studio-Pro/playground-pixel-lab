import { z } from "zod";
import { SCHEMA_VERSION, type CabinetProfile, type Project } from "@/domain/model";

/**
 * Runtime schema for everything that enters the app from storage or files.
 * The branded unit types in the domain hold exactly when values are safe
 * integers, which is what these validators enforce; so the casts below are sound.
 */
const int = z.number().int().refine(Number.isSafeInteger, "must be a safe integer");
const positiveInt = int.positive();
const name = z.string().trim().min(1);

const sizing = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }),
  z.object({ mode: z.literal("fixed"), width: positiveInt, height: positiveInt }),
]);

const cabinet = z.object({
  id: z.string().min(1),
  name,
  widthUm: positiveInt,
  heightUm: positiveInt,
  pixelsX: positiveInt,
  pixelsY: positiveInt,
  nominalPitchUm: positiveInt,
  source: z.enum(["builtin", "custom"]),
});

const project = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  meta: z.object({
    name,
    client: z.string(),
    venue: z.string(),
    notes: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: int.nonnegative(),
  }),
  cabinets: z.array(cabinet),
  physical: z.object({
    screens: z.array(
      z.object({
        id: z.string().min(1),
        name,
        cabinetId: z.string(),
        columns: positiveInt,
        rows: positiveInt,
        groupId: z.string().nullable(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        stageX: int,
        stageY: int,
      }),
    ),
    groups: z.array(z.object({ id: z.string().min(1), name })),
  }),
  content: z.object({
    master: sizing,
    canvases: z.array(z.object({ id: z.string().min(1), name, originX: int.nonnegative(), originY: int.nonnegative() })).min(1),
    regions: z.array(
      z.object({
        screenId: z.string(),
        canvasId: z.string(),
        x: int.nonnegative(),
        y: int.nonnegative(),
        allowOverlap: z.boolean(),
      }),
    ),
  }),
  output: z.object({
    outputs: z.array(z.object({ id: z.string().min(1), name, sizing })).min(1),
    slices: z.array(
      z.object({
        screenId: z.string(),
        outputId: z.string(),
        followsContent: z.boolean(),
        x: int.nonnegative(),
        y: int.nonnegative(),
      }),
    ),
  }),
  modules: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.object({ version: positiveInt, data: z.unknown() })),
});

export class ProjectFormatError extends Error {}

const FILE_FORMAT = "playground-pixel-lab/project";

/** Upgrades older stored documents to the current schema. Add one step per schema version. */
function migrate(raw: unknown): unknown {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === "number" && version > SCHEMA_VERSION) {
    throw new ProjectFormatError(`This project was saved by a newer version of Pixel Lab (schema ${version}). Update the app to open it.`);
  }
  let doc = raw;
  // 1 → 2: projects gain a `modules` section, empty for files written before modules could save data.
  if (version === 1 && typeof doc === "object" && doc !== null) doc = { ...doc, schemaVersion: 2, modules: {} };
  return doc;
}

/** Validates an unknown value as a Project, or throws an error naming the first bad fields. */
export function parseProject(raw: unknown): Project {
  const result = project.safeParse(migrate(raw));
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "project"}: ${issue.message}`)
      .join("; ");
    throw new ProjectFormatError(`This isn't a valid Pixel Lab project (${details}).`);
  }
  return result.data as unknown as Project;
}

export function parseCabinet(raw: unknown): CabinetProfile {
  return cabinet.parse(raw) as unknown as CabinetProfile;
}

/** The on-disk file format: the project wrapped in a labelled envelope. */
export function serializeProject(value: Project): string {
  return JSON.stringify({ format: FILE_FORMAT, project: value }, null, 2) + "\n";
}

export function parseProjectFile(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectFormatError("This file isn't valid JSON, so it can't be opened as a project.");
  }
  const envelope = data as { format?: unknown; project?: unknown } | null;
  if (envelope?.format !== FILE_FORMAT) {
    throw new ProjectFormatError("This JSON file isn't a Pixel Lab project. Mapping manifests can't be reopened; use the project file.");
  }
  return parseProject(envelope.project);
}
