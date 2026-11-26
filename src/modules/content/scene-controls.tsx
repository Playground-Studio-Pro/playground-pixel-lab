"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/workspace/fields";
import { PATTERNS } from "@/domain/motion";
import { MASK_MODULE_ID, MASK_VERSION, parsePointsText, parseSvgMask, pointsText, setCanvasMask } from "@/engines/content/mask";
import { activeScene, addScene, removeScene, SCENES_MODULE_ID, SCENES_VERSION, setActiveScene, setOverride, setStagePose, type ScenesData } from "@/engines/content/scenes";
import { cn } from "@/lib/utils";
import { MODULE_SOURCES } from "@/modules/catalog";
import { writeModuleData } from "@/modules/module-data";
import { selectedScreenIds, useApp } from "@/state/store";
import { useMotion } from "@/state/motion-store";
import { useMaskBitmaps, useProjectMaskBitmaps } from "./mask-bitmaps";
import { readMask, readScenes, SOURCE_PREFIX } from "./scene-sources";

const NONE = "none";
const BASE = "base";
const sourceItems = [
  ...PATTERNS.map((p) => ({ value: p.id as string, label: p.name })),
  ...MODULE_SOURCES.map((s) => ({ value: SOURCE_PREFIX + s.id, label: s.name })),
];
const saveScenes = (data: ScenesData) => writeModuleData(SCENES_MODULE_ID, SCENES_VERSION, data);

/**
 * Scenes, stage poses and the content mask, in the Live preview header. Everything here is saved in the
 * project's module data; none of it changes the mapping.
 */
export function SceneControls() {
  const project = useApp((s) => s.project)!;
  const selection = useApp((s) => s.selection);
  const pattern = useMotion((s) => s.pattern);
  const sourceId = useMotion((s) => s.sourceId);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const svgInput = useRef<HTMLInputElement>(null);
  const pngInput = useRef<HTMLInputElement>(null);

  const scenes = readScenes(project);
  const scene = activeScene(scenes);
  const mask = readMask(project);
  const canvases = project.content.canvases;
  const canvas = canvases.find((c) => c.id === canvasId) ?? canvases[0];
  const bitmaps = useProjectMaskBitmaps(project.id, canvases.map((c) => c.id));
  const canvasMask = canvas ? mask.canvases[canvas.id] : undefined;
  const bitmap = canvas ? bitmaps[canvas.id] : undefined;
  // An edit in the points box, until the saved mask changes under it.
  const [draft, setDraft] = useState<{ base: unknown; text: string } | null>(null);
  const selected = selectedScreenIds(selection, project);
  const screen = selected.length === 1 ? project.physical.screens.find((s) => s.id === selected[0]) : undefined;
  const override = scene && screen ? scene.overrides.find((o) => o.screenId === screen.id)?.sourceId : undefined;
  const maskOn = Object.values(mask.canvases).some((m) => m.enabled);

  const points = draft && draft.base === canvasMask ? draft.text : canvasMask ? pointsText(canvasMask.polygons) : "";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !root.current?.contains(t) && !t.closest('[role="listbox"],[role="option"]')) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const run = (f: () => void) => {
    try {
      f();
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const saveMask = (polygons: number[][], enabled = true) => {
    if (!canvas) return;
    writeModuleData(MASK_MODULE_ID, MASK_VERSION, setCanvasMask(mask, canvas.id, { enabled, polygons }));
  };
  const saveCurrent = () => {
    let n = scenes.scenes.length + 1;
    while (scenes.scenes.some((s) => s.id === `scene-${n}`)) n++;
    const base = sourceId ? SOURCE_PREFIX + sourceId : pattern;
    const next = addScene(scenes, { id: `scene-${n}`, name: `Scene ${n}`, base, overrides: [] });
    saveScenes(setActiveScene(next, `scene-${n}`));
  };
  const importSvg = async (file: File) => {
    const text = await file.text();
    run(() => saveMask(parseSvgMask(text)));
  };
  const importPng = async (file: File) => {
    if (!canvas) return;
    try {
      await useMaskBitmaps.getState().importPng(project.id, canvas.id, file);
      // The project records only that the mask is on; the PNG stays on this machine.
      if (!canvasMask) saveMask([]);
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const sceneItems = [{ value: NONE, label: "No scene: play the source" }, ...scenes.scenes.map((s) => ({ value: s.id, label: s.name }))];
  const maskStatus = !canvasMask
    ? "No mask"
    : bitmap
      ? "PNG mask, kept on this machine"
      : canvasMask.polygons.length > 0
        ? `${canvasMask.polygons.length} polygon${canvasMask.polygons.length === 1 ? "" : "s"}`
        : "PNG mask not on this machine";

  return (
    <div ref={root} className="relative shrink-0" data-testid="scene-controls">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Scenes, stage poses and content mask"
        onClick={() => setOpen((v) => !v)}
        className={cn("flex h-7 items-center gap-1.5 rounded border border-border px-2 text-xs text-foreground hover:bg-accent", open && "bg-accent")}
        data-testid="scene-button"
      >
        {scene ? scene.name : "Scenes"}
        {maskOn && <span className="rounded bg-secondary px-1 text-[10px] text-muted-foreground">Mask</span>}
      </button>
      {open && (
        <div role="group" aria-label="Scenes and mask" className="fixed z-50 mt-1 flex w-72 flex-col gap-3 rounded-md border border-border bg-panel p-3 shadow-lg" data-testid="scene-panel">
          <SelectField label="Scene" value={scenes.active ?? NONE} items={sceneItems} onChange={(v) => saveScenes(setActiveScene(scenes, v === NONE ? null : v))} />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={saveCurrent}>Save current source as scene</Button>
            {scene && <Button size="sm" variant="ghost" onClick={() => saveScenes(removeScene(scenes, scene.id))}>Delete</Button>}
          </div>
          {scene && screen && (
            <SelectField
              label={`${screen.name} plays`}
              value={override ?? BASE}
              items={[{ value: BASE, label: "The scene's base" }, ...sourceItems]}
              onChange={(v) => saveScenes(setOverride(scenes, scene.id, screen.id, v === BASE ? null : v))}
            />
          )}
          {scene && !screen && <p className="text-[11px] text-muted-foreground">Select one screen to give it its own source in this scene.</p>}
          {screen && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={screen.id in scenes.stagePoses} onChange={(e) => saveScenes(setStagePose(scenes, screen.id, e.target.checked ? "closed" : null))} />
              {screen.name} opens on stage, as a door
            </label>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="text-xs font-semibold">Content mask</span>
            {canvases.length > 1 && canvas && (
              <SelectField label="Canvas" value={canvas.id} items={canvases.map((c) => ({ value: c.id, label: c.name }))} onChange={setCanvasId} />
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground" data-testid="mask-status">{maskStatus}</span>
              {canvasMask && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={canvasMask.enabled} onChange={(e) => saveMask([...canvasMask.polygons.map((p) => [...p])], e.target.checked)} data-testid="mask-enabled" />
                  On
                </label>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => svgInput.current?.click()}>Import SVG</Button>
              <Button size="sm" variant="secondary" onClick={() => pngInput.current?.click()}>Import PNG</Button>
              {canvasMask && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (canvas) writeModuleData(MASK_MODULE_ID, MASK_VERSION, setCanvasMask(mask, canvas.id, null));
                    if (canvas && bitmap) void useMaskBitmaps.getState().remove(project.id, canvas.id);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            <input ref={svgInput} type="file" accept=".svg,image/svg+xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importSvg(f); }} />
            <input ref={pngInput} type="file" accept="image/png" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importPng(f); }} />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Points, canvas pixels: one polygon per line
              <textarea
                value={points}
                onChange={(e) => setDraft({ base: canvasMask, text: e.target.value })}
                rows={3}
                spellCheck={false}
                placeholder="0,336 168,0 336,336"
                className="rounded border border-border bg-background p-1.5 font-mono text-[11px] text-foreground"
                data-testid="mask-points"
              />
            </label>
            <Button size="sm" variant="secondary" onClick={() => run(() => saveMask(parsePointsText(points), canvasMask?.enabled ?? true))} data-testid="mask-apply">Apply points</Button>
            <p className="text-[11px] leading-snug text-muted-foreground">Black outside the shape, every pixel inside untouched. The mapping, outputs and Resolume package don&apos;t change.</p>
          </div>
          {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
        </div>
      )}
    </div>
  );
}
