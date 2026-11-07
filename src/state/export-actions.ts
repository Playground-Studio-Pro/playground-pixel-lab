"use client";

import { toast } from "sonner";
import type { Id } from "@/domain/model";
import { assertExportable, slugify } from "@/exports/gate";
import { buildManifest } from "@/exports/manifest";
import { renderPng } from "@/exports/png";
import { buildReport } from "@/exports/report";
import { buildResolumePackage, zipPackage } from "@/exports/resolume/package";
import { masterScene, outputScene, type PixelMapScene } from "@/exports/scene";
import { renderSvg } from "@/exports/svg";
import { serializeProject } from "@/persistence/schema";
import { reportError } from "./actions";
import { useApp } from "./store";

function current() {
  const { project, mapping, issues } = useApp.getState();
  if (!project || !mapping) throw new Error("Open a project first.");
  return { project, mapping, issues, slug: slugify(project.meta.name) };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function guarded(work: () => Promise<string>) {
  try {
    const filename = await work();
    toast.success(`Exported ${filename}`);
  } catch (error) {
    reportError(error);
  }
}

/** Which pixel map to export: the master canvas, or one output. */
export type MapSource = { kind: "master" } | { kind: "output"; id: Id };

export function sourceScene(source: MapSource): { scene: PixelMapScene; base: string } {
  const { project, mapping, slug } = current();
  if (source.kind === "master") {
    return {
      scene: masterScene(mapping, `${project.meta.name}: master canvas`),
      base: `${slug}_master_${mapping.master.width}x${mapping.master.height}`,
    };
  }
  const output = mapping.outputs.find((o) => o.outputId === source.id);
  return {
    scene: outputScene(mapping, source.id, `${project.meta.name}: ${output?.name ?? "output"}`),
    base: `${slug}_${slugify(output?.name ?? "output")}_${output?.width}x${output?.height}`,
  };
}

export function exportPng(source: MapSource) {
  return guarded(async () => {
    assertExportable(current().issues);
    const { scene, base } = sourceScene(source);
    download(await renderPng(scene), `${base}.png`);
    return `${base}.png`;
  });
}

export function exportSvg(source: MapSource) {
  return guarded(async () => {
    assertExportable(current().issues);
    const { scene, base } = sourceScene(source);
    download(new Blob([renderSvg(scene)], { type: "image/svg+xml" }), `${base}.svg`);
    return `${base}.svg`;
  });
}

export function exportManifest() {
  return guarded(async () => {
    const { project, mapping, issues, slug } = current();
    assertExportable(issues);
    const name = `${slug}_manifest.json`;
    const manifest = buildManifest(project, mapping, issues, new Date().toISOString());
    download(new Blob([JSON.stringify(manifest, null, 2) + "\n"], { type: "application/json" }), name);
    return name;
  });
}

/** Reports may be exported with errors present: they list those errors. */
export function exportReport() {
  return guarded(async () => {
    const { project, mapping, issues, slug } = current();
    const name = `${slug}_mapping-report.md`;
    download(new Blob([buildReport(project, mapping, issues, new Date().toISOString())], { type: "text/markdown" }), name);
    return name;
  });
}

/** A project backup is always allowed, even mid-edit with errors. */
export function exportProjectFile() {
  return guarded(async () => {
    const { project, slug } = current();
    const name = `${slug}.pixellab.json`;
    download(new Blob([serializeProject(project)], { type: "application/json" }), name);
    return name;
  });
}

export function exportResolumePackage() {
  return guarded(async () => {
    const { project, mapping, issues } = current();
    const { rootName, files } = await buildResolumePackage(project, mapping, issues, new Date().toISOString(), renderPng);
    const name = `${rootName}.zip`;
    download(await zipPackage(rootName, files), name);
    return name;
  });
}
