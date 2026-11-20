"use client";

import { useEffect, useMemo } from "react";
import { BUILTIN_CABINETS, CATALOG_CABINETS, catalogProfile, sameCabinetProfile, toProjectCabinet } from "@/domain/cabinets";
import type { CabinetProfile, Project } from "@/domain/model";
import type { LibraryCabinet } from "@/domain/cabinets";
import { useCabinetLibrary } from "@/modules/engineering/library-store";
import { useApp } from "@/state/store";

/** Where a cabinet option comes from, in the order the dropdowns show them. */
export type CabinetGroup = "Project" | "Generic" | "Catalog" | "Library";

export interface CabinetOption {
  readonly cabinet: CabinetProfile;
  readonly group: CabinetGroup;
}

/**
 * Every cabinet a screen can use: the project's own copies first, then the generic profiles, the researched
 * catalog and the user's cabinet library. A cabinet already in the project is listed once, under Project. A
 * library entry identical to a catalog one (the Yestech profile seeded into older libraries) is listed once.
 * Pure, so the dropdowns and tests share it.
 */
export function cabinetOptions(project: Project | null, library: readonly LibraryCabinet[]): CabinetOption[] {
  const inProject = project?.cabinets ?? [];
  const ids = new Set(inProject.map((c) => c.id));
  const catalog = CATALOG_CABINETS.map(catalogProfile);
  const out: CabinetOption[] = inProject.map((cabinet) => ({ cabinet, group: "Project" }));
  const add = (cabinet: CabinetProfile, group: CabinetGroup) => {
    if (ids.has(cabinet.id)) return;
    ids.add(cabinet.id);
    out.push({ cabinet, group });
  };
  for (const c of BUILTIN_CABINETS) add(c, "Generic");
  for (const c of catalog) add(c, "Catalog");
  for (const e of library) {
    const profile = toProjectCabinet(e);
    if (catalog.some((c) => sameCabinetProfile(c, profile))) continue;
    add(profile, "Library");
  }
  return out;
}

/** `cabinetOptions` for the open project and the loaded cabinet library. */
export function useCabinetOptions(): CabinetOption[] {
  const project = useApp((s) => s.project);
  const entries = useCabinetLibrary((s) => s.entries);
  const initLibrary = useCabinetLibrary((s) => s.init);
  useEffect(() => void initLibrary(), [initLibrary]);
  return useMemo(() => cabinetOptions(project, entries), [project, entries]);
}
