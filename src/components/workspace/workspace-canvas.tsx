"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Line, Rect as KRect, Shape, Stage, Text } from "react-konva";
import type Konva from "konva";
import { Button } from "@/components/ui/button";
import type { Id } from "@/domain/model";
import { formatMm } from "@/domain/units";
import { boundingBox, overlaps } from "@/engines/geometry";
import { snapPosition, type SnapGuide } from "@/engines/snap";
import { screenToWorld, type Viewport } from "@/engines/viewport";
import { moveInCurrentView } from "@/state/actions";
import { selectedScreenIds, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { buildViewModel, type ViewItem } from "@/state/view-model";
import { useCanvasViewport } from "./use-canvas-viewport";

const SIGNAL = "#3EC1E3";
const ERROR = "#F0695E";
const SNAP_PIXELS = 6;

type Gesture =
  | { kind: "pan"; startX: number; startY: number; origin: Viewport }
  | { kind: "drag"; startX: number; startY: number; ids: readonly Id[]; moved: boolean }
  | { kind: "marquee"; startX: number; startY: number; additive: boolean };

interface DragState {
  dx: number;
  dy: number;
  guides: readonly SnapGuide[];
}

function darker(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * amount);
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function ScreenItem({
  item,
  viewport,
  dx,
  dy,
  selected,
  hasError,
  fontFamily,
}: {
  item: ViewItem;
  viewport: Viewport;
  dx: number;
  dy: number;
  selected: boolean;
  hasError: boolean;
  fontFamily: string;
}) {
  const x = (item.rect.x + dx) * viewport.scale + viewport.offsetX;
  const y = (item.rect.y + dy) * viewport.scale + viewport.offsetY;
  const w = item.rect.width * viewport.scale;
  const h = item.rect.height * viewport.scale;
  const cellW = item.cellWidth * viewport.scale;
  const cellH = item.cellHeight * viewport.scale;
  const light = darker(item.color, 0.8);
  const dark = darker(item.color, 0.55);

  return (
    <Group x={x} y={y} name="item" id={item.id}>
      <KRect width={w} height={h} fill={light} />
      {cellW >= 3 && cellH >= 3 && (
        <Shape
          listening={false}
          sceneFunc={(ctx) => {
            // Checkerboard: one square per cabinet, as in the exported pixel map.
            const c = ctx as unknown as CanvasRenderingContext2D;
            c.fillStyle = dark;
            const cols = Math.round(item.rect.width / item.cellWidth);
            const rows = Math.round(item.rect.height / item.cellHeight);
            for (let row = 0; row < rows; row++) {
              for (let col = 0; col < cols; col++) {
                if ((row + col) % 2 === 1) c.fillRect(col * cellW, row * cellH, cellW, cellH);
              }
            }
          }}
        />
      )}
      <KRect
        listening={false}
        width={w}
        height={h}
        stroke={hasError ? ERROR : selected ? SIGNAL : "rgba(255,255,255,0.75)"}
        strokeWidth={selected || hasError ? 2 : 1}
        dash={hasError ? [6, 4] : undefined}
      />
      {w > 44 && h > 18 && (
        <Text
          listening={false}
          x={6}
          y={5}
          width={w - 12}
          height={h - 8}
          ellipsis
          wrap="none"
          text={item.name}
          fontFamily={fontFamily}
          fontStyle="600"
          fontSize={12}
          fill="#fff"
        />
      )}
      {w > 80 && h > 36 && (
        <Text listening={false} x={6} y={21} width={w - 12} ellipsis wrap="none" text={item.detail} fontFamily={fontFamily} fontSize={11} fill="rgba(255,255,255,0.85)" />
      )}
      {w > 80 && h > 52 && (
        <Text listening={false} x={6} y={36} width={w - 12} ellipsis wrap="none" text={item.position} fontFamily={fontFamily} fontSize={11} fill="rgba(255,255,255,0.7)" />
      )}
    </Group>
  );
}

export function WorkspaceCanvas() {
  const project = useApp((s) => s.project)!;
  const mapping = useApp((s) => s.mapping)!;
  const view = useApp((s) => s.view);
  const activeOutputId = useApp((s) => s.activeOutputId);
  const selection = useApp((s) => s.selection);
  const issues = useApp((s) => s.issues);
  const viewport = useApp((s) => s.viewports[s.view]);
  const size = useApp((s) => s.canvasSize);
  const snapEdges = useApp((s) => s.snapEdges);
  const snapGrid = useApp((s) => s.snapGrid);
  const gridStep = useApp((s) => s.gridStep);
  const openDialog = useUi((s) => s.openDialog);

  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const spaceHeld = useRef(false);
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [fontFamily, setFontFamily] = useState("sans-serif");

  const model = useMemo(() => buildViewModel(project, mapping, view, activeOutputId), [project, mapping, view, activeOutputId]);
  const selectedIds = useMemo(() => new Set(selectedScreenIds(selection, project)), [selection, project]);
  const errorIds = useMemo(() => new Set(issues.filter((i) => i.severity === "error").flatMap((i) => i.screenIds)), [issues]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setFontFamily(getComputedStyle(document.body).fontFamily));
    return () => cancelAnimationFrame(frame);
  }, []);

  useCanvasViewport(containerRef);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code === "Space" && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && target.tagName !== "BUTTON") {
        e.preventDefault();
        spaceHeld.current = true;
        if (containerRef.current) containerRef.current.style.cursor = "grab";
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld.current = false;
        if (containerRef.current) containerRef.current.style.cursor = "";
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Lowest allowed x/y delta: content can't pass its canvas origin, and outputs can't pass 0. */
  const minDelta = (ids: readonly Id[]) => {
    let dx = -Infinity;
    let dy = -Infinity;
    if (view === "physical") return { dx, dy };
    for (const id of ids) {
      const item = model.items.find((i) => i.id === id);
      if (!item) continue;
      let minX = 0;
      let minY = 0;
      if (view === "content") {
        const resolved = mapping.screens.find((s) => s.screenId === id);
        const canvas = project.content.canvases.find((c) => c.id === resolved?.canvasId);
        minX = canvas?.originX ?? 0;
        minY = canvas?.originY ?? 0;
      }
      dx = Math.max(dx, minX - item.rect.x);
      dy = Math.max(dy, minY - item.rect.y);
    }
    return { dx, dy };
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const evt = e.evt;
    const vp = useApp.getState().viewports[view];
    if (!vp) return;
    const { x, y } = local(evt);

    if (evt.button === 1 || spaceHeld.current) {
      evt.preventDefault();
      gesture.current = { kind: "pan", startX: x, startY: y, origin: vp };
      return;
    }
    if (evt.button !== 0) return;

    const node = e.target.findAncestor(".item", true) as Konva.Node | undefined;
    const app = useApp.getState();
    if (node) {
      const id = node.id();
      const screen = project.physical.screens.find((s) => s.id === id);
      let ids: readonly Id[];
      if (evt.shiftKey) {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        ids = [...next];
        app.select(ids.length ? { kind: "screens", ids } : { kind: "none" });
        if (!next.has(id)) return;
      } else if (selectedIds.has(id)) {
        ids = [...selectedIds];
      } else if (screen?.groupId && !evt.metaKey && !evt.ctrlKey) {
        app.select({ kind: "group", id: screen.groupId });
        ids = project.physical.screens.filter((s) => s.groupId === screen.groupId).map((s) => s.id);
      } else {
        app.select({ kind: "screens", ids: [id] });
        ids = [id];
      }
      gesture.current = { kind: "drag", startX: x, startY: y, ids, moved: false };
    } else {
      gesture.current = { kind: "marquee", startX: x, startY: y, additive: evt.shiftKey };
    }
  };

  // Gestures listen on the window, so a drag keeps working when the pointer leaves the canvas.
  useEffect(() => {
    const onMove = (evt: MouseEvent) => {
      const g = gesture.current;
      const vp = useApp.getState().viewports[view];
      const el = containerRef.current;
      if (!vp || !el) return;
      const { x, y } = local(evt);

      if (cursorRef.current) {
        const world = screenToWorld(vp, x, y);
        cursorRef.current.textContent =
          model.unit === "mm"
            ? `${formatMm(Math.round(world.x / 1000) * 1000)}, ${formatMm(Math.round(world.y / 1000) * 1000)} mm`
            : `${Math.floor(world.x)}, ${Math.floor(world.y)} px`;
      }
      if (!g) return;

      if (g.kind === "pan") {
        useApp.getState().setViewport(view, { ...g.origin, offsetX: g.origin.offsetX + x - g.startX, offsetY: g.origin.offsetY + y - g.startY });
      } else if (g.kind === "marquee") {
        setMarquee({ x: Math.min(g.startX, x), y: Math.min(g.startY, y), w: Math.abs(x - g.startX), h: Math.abs(y - g.startY) });
      } else {
        if (!g.moved && Math.hypot(x - g.startX, y - g.startY) < 3) return;
        g.moved = true;
        const moving = model.items.filter((i) => g.ids.includes(i.id));
        const box = boundingBox(moving.map((i) => i.rect));
        if (!box) return;
        const q = model.quantum;
        const rawX = Math.round((box.x + (x - g.startX) / vp.scale) / q) * q;
        const rawY = Math.round((box.y + (y - g.startY) / vp.scale) / q) * q;
        const bypass = evt.ctrlKey;
        const others = snapEdges && !bypass ? model.items.filter((i) => !g.ids.includes(i.id)).map((i) => i.rect) : null;
        const snapped = snapPosition(
          { x: rawX, y: rawY, width: box.width, height: box.height },
          { others, gridStep: snapGrid && !bypass ? gridStep * q : null, threshold: SNAP_PIXELS / vp.scale },
        );
        const min = minDelta(g.ids);
        setDrag({
          dx: Math.max(snapped.x - box.x, min.dx),
          dy: Math.max(snapped.y - box.y, min.dy),
          guides: snapped.guides,
        });
      }
    };

    const onUp = (evt: MouseEvent) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      const app = useApp.getState();
      if (g.kind === "drag" && g.moved) {
        const current = dragRef.current;
        setDrag(null);
        if (current && (current.dx !== 0 || current.dy !== 0)) {
          moveInCurrentView(
            model.items
              .filter((i) => g.ids.includes(i.id))
              .map((i) => ({ id: i.id, x: i.rect.x + current.dx, y: i.rect.y + current.dy })),
          );
        }
      } else if (g.kind === "marquee") {
        const vp = app.viewports[view];
        const { x, y } = local(evt);
        setMarquee(null);
        const dragged = Math.hypot(x - g.startX, y - g.startY) >= 3;
        if (!dragged) {
          if (!g.additive) app.select({ kind: "none" });
          return;
        }
        if (!vp) return;
        const a = screenToWorld(vp, Math.min(g.startX, x), Math.min(g.startY, y));
        const b = screenToWorld(vp, Math.max(g.startX, x), Math.max(g.startY, y));
        const area = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
        const hit = model.items.filter((i) => overlaps(i.rect, area)).map((i) => i.id);
        const ids = g.additive ? [...new Set([...selectedScreenIds(app.selection, app.project), ...hit])] : hit;
        app.select(ids.length ? { kind: "screens", ids } : { kind: "none" });
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // minDelta and local read only values already listed here or from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, view, snapEdges, snapGrid, gridStep, mapping, project]);

  const vp = viewport;
  const toScreenX = (x: number) => (vp ? x * vp.scale + vp.offsetX : 0);
  const toScreenY = (y: number) => (vp ? y * vp.scale + vp.offsetY : 0);
  const gridWorld = gridStep * model.quantum;

  const selectionBox = boundingBox(model.items.filter((i) => selectedIds.has(i.id)).map((i) => i.rect));
  const selectionText =
    selectionBox &&
    (model.unit === "mm"
      ? `Selection ${formatMm(selectionBox.width)} × ${formatMm(selectionBox.height)} mm at ${formatMm(selectionBox.x + (drag?.dx ?? 0))}, ${formatMm(selectionBox.y + (drag?.dy ?? 0))}`
      : `Selection ${selectionBox.width} × ${selectionBox.height} px at ${selectionBox.x + (drag?.dx ?? 0)}, ${selectionBox.y + (drag?.dy ?? 0)}`);

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-stage" aria-label="Interactive canvas">
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden" data-testid="canvas">
        {vp && (
          <Stage width={size.width} height={size.height} onMouseDown={onMouseDown}>
            <Layer listening={false}>
              {model.frames.map((frame) => {
                const x = toScreenX(frame.rect.x);
                const y = toScreenY(frame.rect.y);
                const w = frame.rect.width * vp.scale;
                const h = frame.rect.height * vp.scale;
                const isCanvas = frame.kind === "canvas";
                return (
                  <Group key={frame.id}>
                    {!isCanvas && <KRect x={x} y={y} width={w} height={h} fill="#10121E" />}
                    {!isCanvas && snapGrid && gridWorld * vp.scale >= 6 && (
                      <Shape
                        sceneFunc={(ctx) => {
                          const c = ctx as unknown as CanvasRenderingContext2D;
                          c.strokeStyle = "rgba(255,255,255,0.06)";
                          c.lineWidth = 1;
                          c.beginPath();
                          for (let gx = gridWorld; gx < frame.rect.width; gx += gridWorld) {
                            const sx = Math.round(x + gx * vp.scale) + 0.5;
                            c.moveTo(sx, y);
                            c.lineTo(sx, y + h);
                          }
                          for (let gy = gridWorld; gy < frame.rect.height; gy += gridWorld) {
                            const sy = Math.round(y + gy * vp.scale) + 0.5;
                            c.moveTo(x, sy);
                            c.lineTo(x + w, sy);
                          }
                          c.stroke();
                        }}
                      />
                    )}
                  </Group>
                );
              })}
            </Layer>

            <Layer>
              {model.items.map((item) => (
                <ScreenItem
                  key={item.id}
                  item={item}
                  viewport={vp}
                  dx={drag && selectedIds.has(item.id) ? drag.dx : 0}
                  dy={drag && selectedIds.has(item.id) ? drag.dy : 0}
                  selected={selectedIds.has(item.id)}
                  hasError={errorIds.has(item.id)}
                  fontFamily={fontFamily}
                />
              ))}
            </Layer>

            <Layer listening={false}>
              {model.frames.map((frame) => {
                const x = toScreenX(frame.rect.x);
                const y = toScreenY(frame.rect.y);
                const w = frame.rect.width * vp.scale;
                const h = frame.rect.height * vp.scale;
                const isCanvas = frame.kind === "canvas";
                return (
                  <Group key={frame.id}>
                    <KRect x={x} y={y} width={w} height={h} stroke={isCanvas ? "#E8B04A" : "#6C7087"} strokeWidth={1} dash={isCanvas ? [5, 4] : undefined} />
                    <Text
                      x={x}
                      y={isCanvas ? y + h + 4 : y - 17}
                      text={frame.name}
                      fontFamily={fontFamily}
                      fontSize={11}
                      fill={isCanvas ? "#E8B04A" : "#A5A8BA"}
                    />
                  </Group>
                );
              })}
              {drag?.guides.map((guide, index) =>
                guide.axis === "x" ? (
                  <Line key={index} points={[toScreenX(guide.position), 0, toScreenX(guide.position), size.height]} stroke={SIGNAL} strokeWidth={1} />
                ) : (
                  <Line key={index} points={[0, toScreenY(guide.position), size.width, toScreenY(guide.position)]} stroke={SIGNAL} strokeWidth={1} />
                ),
              )}
              {marquee && <KRect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} stroke={SIGNAL} strokeWidth={1} fill="rgba(62,193,227,0.1)" />}
            </Layer>
          </Stage>
        )}

        {project.physical.screens.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-muted-foreground">Add a screen to start mapping.</p>
            <Button onClick={() => openDialog("add-screen")}>Add screen</Button>
          </div>
        )}
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-panel px-3 text-xs text-muted-foreground tabular-nums">
        <span ref={cursorRef} className="w-36 shrink-0" data-testid="cursor-readout" />
        <span className="shrink-0 text-foreground" data-testid="selection-readout">{selectionText}</span>
        <span className="ml-auto truncate">Scroll or Space-drag to pan. Pinch or ⌘-scroll to zoom. Arrows nudge 1, Shift 10.</span>
      </footer>
    </main>
  );
}
