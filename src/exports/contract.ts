import type { Project } from "@/domain/model";
import type { ResolvedMapping } from "@/engines/mapping";
import type { ValidationIssue } from "@/engines/validation";
import type { PixelMapScene } from "./scene";

/**
 * Shared export contract. Types only: see docs/architecture/CONTRACTS.md.
 * Owned by the Lead Architect. Change it only through a PR that every lane can see.
 */

/** Everything an export reads. It comes from the store, and an export never computes mapping values itself. */
export interface ExportInput {
  readonly project: Project;
  readonly mapping: ResolvedMapping;
  readonly issues: readonly ValidationIssue[];
  /** ISO time, injected so builders stay pure. */
  readonly generatedAt: string;
  /** Browser rasterizer, injected so builders run in tests without a DOM. Today: `renderPng`. */
  readonly rasterize: (scene: PixelMapScene) => Promise<Blob>;
}

/** One file in a download. Several files are zipped by the caller. */
export interface ExportFile {
  /** Relative path inside the download, with forward slashes. */
  readonly path: string;
  readonly content: string | Blob;
}

/** One entry in the Export menu. */
export interface ExportEntry {
  readonly id: string;
  /** Menu label in sentence case, naming the format, for example "Mapping manifest (.json)". */
  readonly label: string;
  /** True for anything a processor or media server reads. Blocked while validation has errors (`exports/gate.ts`). */
  readonly requiresValidMapping: boolean;
  build(input: ExportInput): Promise<readonly ExportFile[]>;
}
