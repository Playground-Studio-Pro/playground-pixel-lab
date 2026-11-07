import type { Project } from "@/domain/model";
import type { ResolvedMapping } from "@/engines/mapping";
import type { ValidationIssue } from "@/engines/validation";
import { assertExportable, slugify } from "../gate";
import { buildManifest } from "../manifest";
import { buildReport } from "../report";
import { masterScene, outputScene, screenScene, type PixelMapScene } from "../scene";
import { renderSvg } from "../svg";
import { serializeProject } from "@/persistence/schema";
import { buildResolumeGuide, buildResolumeSetup, buildSlicesCsv } from "./adapter";

export interface PackageFile {
  readonly path: string;
  readonly content: string | Blob;
}

export type Rasterizer = (scene: PixelMapScene) => Promise<Blob>;

/** Keeps every output and screen file name distinct, even if two share a name. */
function uniquePaths() {
  const seen = new Set<string>();
  return (base: string) => {
    let candidate = base;
    for (let n = 2; seen.has(candidate); n++) candidate = `${base}-${n}`;
    seen.add(candidate);
    return candidate;
  };
}

/** Lists every file in a Resolume preparation package. The rasterizer is injected, so this runs without a browser. */
export async function buildResolumePackage(
  project: Project,
  mapping: ResolvedMapping,
  issues: readonly ValidationIssue[],
  generatedAt: string,
  rasterize: Rasterizer,
): Promise<{ rootName: string; files: PackageFile[] }> {
  assertExportable(issues);

  const slug = slugify(project.meta.name);
  const setup = buildResolumeSetup(mapping);
  const size = `${mapping.master.width}x${mapping.master.height}`;
  const masterBase = `pixelmaps/master_${size}`;
  const master = masterScene(mapping, `${project.meta.name}: master canvas`);

  const unique = uniquePaths();
  const outputs = mapping.outputs
    .filter((o) => o.screenIds.length > 0)
    .map((o) => ({
      name: o.name,
      base: unique(`pixelmaps/outputs/${slugify(o.name)}_${o.width}x${o.height}`),
      scene: outputScene(mapping, o.outputId, `${project.meta.name}: ${o.name}`),
    }));
  const screens = mapping.screens.map((s) => ({
    base: unique(`pixelmaps/screens/${slugify(s.name)}_${s.spec.pixelWidth}x${s.spec.pixelHeight}`),
    scene: screenScene(s),
  }));

  const guide = buildResolumeGuide(project, setup, { masterPng: `${masterBase}.png` });

  const files: PackageFile[] = [
    { path: "README.md", content: guide },
    { path: "manifest.json", content: JSON.stringify(buildManifest(project, mapping, issues, generatedAt), null, 2) + "\n" },
    { path: "slices.csv", content: buildSlicesCsv(setup) },
    { path: "mapping-report.md", content: buildReport(project, mapping, issues, generatedAt) },
    { path: `project/${slug}.pixellab.json`, content: serializeProject(project) },
    { path: `${masterBase}.svg`, content: renderSvg(master) },
    { path: `${masterBase}.png`, content: await rasterize(master) },
  ];
  for (const item of [...outputs, ...screens]) {
    files.push({ path: `${item.base}.svg`, content: renderSvg(item.scene) });
    files.push({ path: `${item.base}.png`, content: await rasterize(item.scene) });
  }
  return { rootName: `${slug}_resolume_${size}`, files };
}

/** Zips package files under a single root folder. JSZip loads only when a package is requested. */
export async function zipPackage(rootName: string, files: readonly PackageFile[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const root = zip.folder(rootName)!;
  for (const file of files) root.file(file.path, file.content);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/zip" });
}
