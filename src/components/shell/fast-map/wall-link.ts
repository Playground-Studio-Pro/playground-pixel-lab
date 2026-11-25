import type { Project } from "@/domain/model";
import { wallUpdate } from "@/engines/fast-map/wall";
import type { ResolvedMapping } from "@/engines/mapping";
import type { ValidationIssue } from "@/engines/validation";

/**
 * The hook for "send to the wall". Fast map calls `sendToWall` after every change in the Fix step. Nothing is sent
 * until another lane registers a link: live output is Output Engineering's and Desktop Engineering's, not built here.
 * A map with errors is never sent; the wall keeps the last good one.
 */
export interface WallLink {
  /** Shown in Fast map, such as "OUT 1 on the HP display". */
  readonly label: string;
  send(update: { readonly project: Project; readonly mapping: ResolvedMapping }): void | Promise<void>;
}

let current: WallLink | null = null;

/** Registers the link, replacing any other. Returns a function that removes it. */
export function registerWallLink(link: WallLink): () => void {
  current = link;
  return () => {
    if (current === link) current = null;
  };
}

export function wallLink(): WallLink | null {
  return current;
}

export type WallResult = { readonly state: "sent"; readonly label: string } | { readonly state: "held"; readonly reason: string } | { readonly state: "off" };

/** Sends the map if a link is registered and the map has no errors. Never throws: a failed send is reported as held. */
export async function sendToWall(project: Project, mapping: ResolvedMapping, issues: readonly ValidationIssue[]): Promise<WallResult> {
  const link = current;
  if (!link) return { state: "off" };
  const update = wallUpdate(project, mapping, issues);
  if (!update.ok) return { state: "held", reason: update.reason };
  try {
    await link.send({ project: update.project, mapping: update.mapping });
    return { state: "sent", label: link.label };
  } catch (error) {
    return { state: "held", reason: `Sending failed: ${error instanceof Error ? error.message : String(error)} The wall keeps the last good map.` };
  }
}
