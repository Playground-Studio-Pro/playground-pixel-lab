"use client";

import type { ResolvedMapping, ResolvedScreen } from "@/engines/mapping";

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

type Space = "stage" | "content" | "output";

/** Stage is drawn in millimetres: browsers can't draw text at micrometre sizes. Display only. */
function rectOf(s: ResolvedScreen, space: Space) {
  if (space === "stage") return { x: s.stage.x / 1000, y: s.stage.y / 1000, width: s.stage.width / 1000, height: s.stage.height / 1000 };
  return space === "content" ? s.masterRect : s.outputRect;
}

function Drawing({ title, detail, width, height, screens, space, options, frame, originX = 0, originY = 0 }: { title: string; detail: string; width: number; height: number; originX?: number; originY?: number; screens: readonly ResolvedScreen[]; space: Space; options: PreviewOptions; frame: boolean }) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const unit = Math.max(w, h) / 400;
  // Screens drawn on the same rectangle (same content) share one label: "4 = 6".
  const groups = new Map<string, ResolvedScreen[]>();
  for (const s of screens) {
    const r = rectOf(s, space);
    const key = `${r.x},${r.y},${r.width},${r.height}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const label = `${title}, ${detail}: ` + screens.map((s) => `${options.numbers.get(s.screenId)} ${s.name}`).join(", ");
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span>
        <span className="tabular-nums">{detail}</span>
      </figcaption>
      <svg viewBox={`${originX} ${originY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label} className="block max-h-[34vh] w-full rounded border border-border bg-black">
        {frame && <rect x={0} y={0} width={w} height={h} fill="#0b0d18" />}
        {[...groups.values()].map((group) => {
          const s = group[0];
          const r = rectOf(s, space);
          const selected = group.some((g) => options.selected.has(g.screenId));
          const text = group.map((g) => options.numbers.get(g.screenId)).join(" = ");
          const size = Math.max(unit * 6, Math.min(r.height * 0.6, (r.width / Math.max(1, text.length)) * 0.9));
          return (
            <g key={s.screenId}>
              <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={s.color} fillOpacity={0.55} stroke={selected ? "#ffffff" : s.color} strokeWidth={selected ? unit * 2.5 : unit} />
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

const um = (v: number) => (v / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

export function StagePreview({ mapping, options }: { mapping: ResolvedMapping; options: PreviewOptions }) {
  const right = Math.max(0, ...mapping.screens.map((s) => s.stage.x + s.stage.width));
  const bottom = Math.max(0, ...mapping.screens.map((s) => s.stage.y + s.stage.height));
  const left = Math.min(0, ...mapping.screens.map((s) => s.stage.x));
  const top = Math.min(0, ...mapping.screens.map((s) => s.stage.y));
  return <Drawing title="Stage" detail={`${um(right - left)} × ${um(bottom - top)} mm`} width={(right - left) / 1000} height={(bottom - top) / 1000} originX={left / 1000} originY={top / 1000} screens={mapping.screens} space="stage" options={options} frame={false} />;
}

export function ContentPreview({ mapping, options }: { mapping: ResolvedMapping; options: PreviewOptions }) {
  return <Drawing title="Content canvas" detail={`${mapping.master.width} × ${mapping.master.height} px`} width={mapping.master.width} height={mapping.master.height} screens={mapping.screens} space="content" options={options} frame />;
}

export function OutputPreviews({ mapping, options }: { mapping: ResolvedMapping; options: PreviewOptions }) {
  return (
    <>
      {mapping.outputs.map((o) => (
        <Drawing
          key={o.outputId}
          title={o.name}
          detail={`${o.width} × ${o.height} px`}
          width={o.width}
          height={o.height}
          screens={mapping.screens.filter((s) => s.outputId === o.outputId && !options.hidden?.has(s.screenId))}
          space="output"
          options={options}
          frame
        />
      ))}
    </>
  );
}
