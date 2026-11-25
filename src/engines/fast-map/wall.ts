import type { Project } from "@/domain/model";
import type { ResolvedMapping } from "../mapping";
import { hasErrors, type ValidationIssue } from "../validation";

/**
 * What "send to the wall" may send. Only a map with no errors goes out: with an error the wall keeps the last good
 * map, and the reason is shown. Pure: the sending itself is a hook the output lane fills (`shell/fast-map/wall-link.ts`).
 */
export type WallUpdate =
  | { readonly ok: true; readonly project: Project; readonly mapping: ResolvedMapping }
  | { readonly ok: false; readonly reason: string };

export function wallUpdate(project: Project, mapping: ResolvedMapping, issues: readonly ValidationIssue[]): WallUpdate {
  if (!hasErrors(issues)) return { ok: true, project, mapping };
  const first = issues.find((i) => i.severity === "error")!;
  return { ok: false, reason: `${first.message} The wall keeps the last good map.` };
}
