import type { EngineeringSummary } from "@/domain/engineering";
import type { Project } from "@/domain/model";
import type { ResolvedMapping } from "@/engines/mapping";

/**
 * The project's engineering summary, read by reports (`ExportInput.engineering`). Owned by LED
 * Engineering, which replaces this body; the signature is the contract and stays.
 *
 * Until then it returns null: no plan, so reports say engineering data is not available.
 */
export function summarizeEngineering(project: Project, mapping: ResolvedMapping): EngineeringSummary | null {
  void project;
  void mapping;
  return null;
}
