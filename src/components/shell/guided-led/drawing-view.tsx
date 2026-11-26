"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { DrawingBox, ProposedScreen } from "@/engines/guided-led";
import { cn } from "@/lib/utils";

/**
 * The drawing with the screens found on it, as an editable overlay in the drawing's own units. In draw mode a drag
 * draws a missing screen. Pointer only for drawing; the side panel does everything else from the keyboard.
 */
export function DrawingView({
  src,
  width,
  height,
  screens,
  selected,
  highlight,
  drawing,
  onSelect,
  onDraw,
}: {
  src: string;
  width: number;
  height: number;
  screens: readonly ProposedScreen[];
  selected: string | null;
  /** Screens a question points at. */
  highlight: readonly string[];
  drawing: boolean;
  onSelect(key: string): void;
  onDraw(box: DrawingBox): void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const at = (e: PointerEvent) => {
    const el = svg.current!;
    const m = el.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.min(width, Math.max(0, p.x)), y: Math.min(height, Math.max(0, p.y)) };
  };
  const box = drag && { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) };
  const stroke = Math.max(width, height) / 600;
  const font = Math.max(width, height) / 70;

  return (
    <div className="relative w-full select-none" style={{ aspectRatio: `${width} / ${height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset */}
      <img src={src} alt="The drawing" className="absolute inset-0 h-full w-full rounded bg-white object-fill" draggable={false} />
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={cn("absolute inset-0 h-full w-full", drawing && "cursor-crosshair")}
        aria-hidden="true"
        onPointerDown={(e) => {
          if (!drawing) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = at(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = at(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (box && box.width > width / 200 && box.height > height / 200) onDraw(box);
          setDrag(null);
        }}
      >
        {screens.map((s, i) => {
          const sel = s.key === selected;
          const hot = highlight.includes(s.key);
          const unsure = [s.name, s.width, s.height, s.top].some((v) => v.source === "missing" || v.source === "guessed");
          const color = hot ? "#f5a524" : sel ? "#3ddc97" : unsure ? "#f5a524" : "#3b82f6";
          return (
            <g key={s.key} onPointerDown={(e) => !drawing && (e.stopPropagation(), onSelect(s.key))} className={drawing ? undefined : "cursor-pointer"}>
              <rect x={s.rect.x} y={s.rect.y} width={s.rect.width} height={s.rect.height} fill={color} fillOpacity={sel || hot ? 0.22 : 0.1} stroke={color} strokeWidth={stroke * (sel || hot ? 3 : 2)} />
              <text x={s.rect.x + stroke * 3} y={s.rect.y + font * 1.1} fontSize={font} fontWeight={700} fill={color} style={{ paintOrder: "stroke" }} stroke="#fff" strokeWidth={font / 6}>
                {i + 1}
              </text>
            </g>
          );
        })}
        {box && <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="#3ddc97" fillOpacity={0.15} stroke="#3ddc97" strokeWidth={stroke * 2} strokeDasharray={`${stroke * 6} ${stroke * 4}`} />}
      </svg>
    </div>
  );
}
