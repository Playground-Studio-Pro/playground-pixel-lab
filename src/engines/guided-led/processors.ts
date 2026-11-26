/**
 * Output choices for the guided flow. Processor values come only from `docs/engineering/LED_HARDWARE_CATALOG.md`; none is
 * checked against the manufacturer's PDF yet, so every one carries `checked: false` and the interface says so. Where the
 * catalog states no single input size, the processor has none here and the operator picks a generic size: no value is
 * filled in from a typical one. Pure data.
 */

export interface OutputChoice {
  readonly id: string;
  readonly label: string;
  /** The raster each output carries, px. Null when the source states none. */
  readonly size: { readonly width: number; readonly height: number } | null;
  /** Pixel load one unit drives, px, as the catalog states it, or null. */
  readonly loadPx: number | null;
  /** Ethernet ports per unit and the pixels one port carries, with the basis of that figure. */
  readonly ports: { readonly count: number; readonly perPortPx: number; readonly basis: string } | null;
  /** Where the values come from, in words. */
  readonly source: string;
  /** False until read in the manufacturer's PDF for the exact model. */
  readonly checked: boolean;
  readonly kind: "processor" | "generic";
}

const CATALOG = "LED hardware catalog, from search results quoting the manufacturer's sheet (accessed 2026-11-20)";

export const OUTPUT_CHOICES: readonly OutputChoice[] = [
  { id: "generic-1080", label: "Generic 1920×1080 outputs", size: { width: 1920, height: 1080 }, loadPx: null, ports: null, source: "Standard HD raster", checked: true, kind: "generic" },
  { id: "generic-2160", label: "Generic 3840×2160 outputs", size: { width: 3840, height: 2160 }, loadPx: null, ports: null, source: "Standard UHD raster", checked: true, kind: "generic" },
  {
    id: "novastar-mctrl4k",
    label: "NovaStar MCTRL4K",
    size: { width: 4096, height: 2160 },
    loadPx: 8_800_000,
    ports: { count: 16, perPortPx: 650_000, basis: "8-bit; 320 000 at 10/12-bit" },
    source: `${CATALOG}: input 4096 × 2160 @ 60 Hz, 8.8 M px (HDMI/DP)`,
    checked: false,
    kind: "processor",
  },
  {
    id: "novastar-mctrl660-pro",
    label: "NovaStar MCTRL660 Pro",
    size: { width: 1920, height: 1200 },
    loadPx: 2_304_000,
    ports: null,
    source: `${CATALOG}: 1920 × 1200 @ 60 Hz; per-port load not stated`,
    checked: false,
    kind: "processor",
  },
  {
    id: "novastar-mx40-pro",
    label: "NovaStar MX40 Pro (COEX)",
    size: { width: 4096, height: 2160 },
    loadPx: 9_000_000,
    ports: null,
    source: `${CATALOG}: 4096 × 2160 @ 60 Hz, 9 M px; per-port load is the sum of loaded cabinets`,
    checked: false,
    kind: "processor",
  },
  {
    id: "novastar-vx1000",
    label: "NovaStar VX1000",
    size: null,
    loadPx: 6_500_000,
    ports: null,
    source: `${CATALOG}: 6.5 M px, width up to 10 240, height up to 8192; no single input size stated`,
    checked: false,
    kind: "processor",
  },
  {
    id: "novastar-vx600",
    label: "NovaStar VX600",
    size: null,
    loadPx: null,
    ports: null,
    source: `${CATALOG}: maximum size is in conflict between sources (3840 × 648 vs 10 240 × 8192)`,
    checked: false,
    kind: "processor",
  },
];

export function outputChoice(id: string): OutputChoice | undefined {
  return OUTPUT_CHOICES.find((c) => c.id === id);
}
