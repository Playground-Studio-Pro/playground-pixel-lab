"use client";

import type { ResolvedMapping } from "@/engines/mapping";

/**
 * Drawings of a resolved mapping, for checking at a glance. Every rectangle is a `ResolvedScreen` rectangle as it is:
 * nothing here computes a position. Screens are numbered in project order, as the Fix step's keys 1–9 pick them.
 */

export interface PreviewOptions {
  /** Screen id → its number. */
  numbers: ReadonlyMap<string, number>;
  selected: ReadonlySet<string>;
  /** Screens left out of the output drawing, because they found no room. */
  hidden?: ReadonlySet<string>;
}

/** One shape a drawing shows: a screen, or a part of a split screen in an output. */
interface Shape {
  readonly key: string;
  readonly screenId: string;
  readonly color: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Number shown, such as "3" or "3·1/2". */
  readonly mark: string;
  /** Degrees clockwise about the centre (content only). */
  readonly rotation?: number;
  readonly flip?: "none" | "h" | "v" | "hv";
  /** Cut lines inside the shape, as x positions (split screens on the content canvas). */
  readonly cuts?: readonly { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }[];
}

const FLIP_GLYPH = { none: "", h: " ⇋", v: " ⇵", hv: " ⇋⇵" } as const;

function Drawing({ title, detail, width, height, shapes, options, frame, originX = 0, originY = 0, label: aria }: { title: string; detail: string; width: number; height: number; originX?: number; originY?: number; shapes: readonly Shape[]; options: PreviewOptions; frame: boolean; label: string }) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const unit = Math.max(w, h) / 400;
  // Shapes drawn on the same rectangle (same content) share one label: "4 = 6".
  const groups = new Map<string, Shape[]>();
  for (const s of shapes) {
    const r = s.rect;
    const key = `${r.x},${r.y},${r.width},${r.height},${s.rotation ?? 0}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span>
        <span className="tabular-nums">{detail}</span>
      </figcaption>
      <svg viewBox={`${originX} ${originY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${title}, ${detail}: ${aria}`} className="block max-h-[34vh] w-full rounded border border-border bg-black">
        {frame && <rect x={0} y={0} width={w} height={h} fill="#0b0d18" />}
        {[...groups.values()].map((group) => {
          const s = group[0];
          const r = s.rect;
          const selected = group.some((g) => options.selected.has(g.screenId));
          const text = group.map((g) => g.mark).join(" = ") + FLIP_GLYPH[s.flip ?? "none"];
          const size = Math.max(unit * 6, Math.min(r.height * 0.6, (r.width / Math.max(1, text.length)) * 0.9));
          const turn = s.rotation ? `rotate(${s.rotation} ${r.x + r.width / 2} ${r.y + r.height / 2})` : undefined;
          return (
            <g key={s.key} transform={turn}>
              <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={s.color} fillOpacity={0.55} stroke={selected ? "#ffffff" : s.color} strokeWidth={selected ? unit * 2.5 : unit} />
              {s.cuts?.map((c, i) => <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#e5484d" strokeWidth={unit * 2} strokeDasharray={`${unit * 5} ${unit * 3}`} />)}
              <text x={r.x + r.width / 2} y={r.y + r.height / 2} fill="#ffffff" fontSize={size} fontWeight={700} textAnchor="middle" dominantBaseline="central" stroke="#000000" strokeOpacity={0.7} strokeWidth={size * 0.08} paintOrder="stroke">
                {text}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function describeShapes(shapes: readonly Shape[], options: PreviewOptions, names: ReadonlyMap<string, string>): string {
  return shapes.map((s) => `${s.mark} ${names.get(s.screenId) ?? ""}${s.rotation ? ` turned ${s.rotation}°` : ""}${s.flip && s.flip !== "none" ? " mirrored" : ""}`).join(", ") || (options.hidden?.size ? "nothing shown" : "empty");
}

const um = (v: number) => (v / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

export function StagePreview({ mapping, options }: { mapping: ResolvedMapping; options: PreviewOptions }) {
  const right = Math.max(0, ...mapping.screens.map((s) => s.stage.x + s.stage.width));
  const bottom = Math.max(0, ...mapping.screens.map((s) => s.stage.y + s.stage.height));
  const left = Math.min(0, ...mapping.screens.map((s) => s.stage.x));
  const top = Math.min(0, ...mapping.screens.map((s) => s.stage.y));
  // Stage is drawn in millimetres: browsers can't draw text at micrometre sizes. Display only.
  const shapes: Shape[] = mapping.screens.map((s) => ({ key: s.screenId, screenId: s.screenId, color: s.color, mark: String(options.numbers.get(s.screenId)), rect: { x: s.stage.x / 1000, y: s.stage.y / 1000, width: s.stage.width / 1000, height: s.stage.height / 1000 } }));
  return <Drawing title="Stage" detail={`${um(right - left)} × ${um(bottom - top)} mm`} width={(right - left) / 1000} height={(bottom - top) / 1000} originX={left / 1000} originY={top / 1000} shapes={shapes} options={options} frame={false} label={describeShapes(shapes, options, names(mapping))} />;
}

const names = (mapping: ResolvedMapping) => new Map(mapping.screens.map((s) => [s.screenId, s.name]));

export function ContentPreview({ mapping, options }: { mapping: ResolvedMapping; options: PreviewOptions }) {
  const shapes: Shape[] = mapping.screens.map((s) => ({
    key: s.screenId,
    screenId: s.screenId,
    color: s.color,
    mark: String(options.numbers.get(s.screenId)),
    rect: s.masterRect,
    rotation: s.rotation,
    flip: s.flip,
    cuts: s.parts.slice(1).map((p) => (p.source.x > 0 ? { x1: p.masterRect.x, y1: s.masterRect.y, x2: p.masterRect.x, y2: s.masterRect.y + s.masterRect.height } : { x1: s.masterRect.x, y1: p.masterRect.y, x2: s.masterRect.x + s.masterRect.width, y2: p.masterRect.y })),
  }));
  return <Drawing title="Content canvas" detail={`${mapping.master.width} × ${mapping.master.height} px`} width={mapping.master.width} height={mapping.master.height} shapes={shapes} options={options} frame label={describeShapes(shapes, options, names(mapping))} />;
}

export function OutputPreviews({ mapping, options }: { mapping: ResolvedMapping; options: PreviewOptions }) {
  return (
    <>
      {mapping.outputs.map((o) => {
        const shapes: Shape[] = mapping.screens
          .filter((s) => !options.hidden?.has(s.screenId))
          .flatMap((s) =>
            s.parts
              .filter((p) => p.outputId === o.outputId)
              .map((p) => ({ key: `${s.screenId}#${p.index}`, screenId: s.screenId, color: s.color, rect: p.outputRect, mark: p.count === 1 ? String(options.numbers.get(s.screenId)) : `${options.numbers.get(s.screenId)}·${p.index}/${p.count}` })),
          );
        return <Drawing key={o.outputId} title={o.name} detail={`${o.width} × ${o.height} px`} width={o.width} height={o.height} shapes={shapes} options={options} frame label={describeShapes(shapes, options, names(mapping))} />;
      })}
    </>
  );
}
