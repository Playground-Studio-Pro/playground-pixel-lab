"use client";

import { toast } from "sonner";
import { slugify } from "@/exports/gate";
import { renderPng } from "@/exports/png";
import { zipPackage } from "@/exports/resolume/package";
import { contentTemplatesExport } from "@/exports/templates/templates";
import { reportError } from "@/state/actions";
import { useApp } from "@/state/store";

/** Downloads every content template of the open project as one ZIP. Loaded when the menu item is used. */
export async function exportContentTemplates(): Promise<void> {
  try {
    const { project, mapping, issues } = useApp.getState();
    if (!project || !mapping) throw new Error("Open a project first.");
    const files = await contentTemplatesExport.build({ project, mapping, issues, generatedAt: new Date().toISOString(), rasterize: renderPng });
    const rootName = `${slugify(project.meta.name)}_templates`;
    const blob = await zipPackage(rootName, files);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${rootName}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success(`Exported ${rootName}.zip, ${files.length / 2} templates`);
  } catch (error) {
    reportError(error);
  }
}
