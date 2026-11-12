/**
 * Engineering contract: what the Engineering Studio works out about a project's LED system, in the
 * shape the Output Studio's reports read. Types only. Owned by the Lead Architect; see
 * docs/architecture/CONTRACTS.md#engineering-contract.
 *
 * LED Engineering produces an `EngineeringSummary` with `summarizeEngineering` in
 * `engines/led/summary.ts`. Output Engineering only reads it. Neither computes mapping values: pixel
 * sizes and positions come from `resolveMapping`.
 *
 * Units are integers named in each field: pixels, micrometres (`Um`), square millimetres, grams,
 * milliwatts, millivolts, milliamps, hertz. `null` always means "not stated by the source", never zero.
 */

/** Where a hardware value comes from. Every processor and cabinet value cites at least one. */
export interface SourceRef {
  readonly id: string;
  /** Document title as the manufacturer publishes it, for example "MCTRL4K Specifications". */
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  /** The date the document was read, `YYYY-MM-DD`. */
  readonly accessed: string;
  /** Page, table or section, when it helps someone check the value. */
  readonly locator?: string;
}

/** A statement a calculation relies on, shown next to its result. */
export interface Assumption {
  readonly id: string;
  readonly text: string;
}

export type FindingLevel = "error" | "warning" | "info";

export interface EngineeringFinding {
  readonly level: FindingLevel;
  /** Stable code for tests and filtering, for example `processor-over-capacity`. */
  readonly code: string;
  readonly message: string;
  readonly subject?: { readonly kind: "processor" | "port" | "output" | "screen" | "cabinet"; readonly id: string };
}

/** One input connector type on a processor. */
export interface ProcessorInput {
  /** As the data sheet names it, for example "HDMI 1.3" or "DVI". */
  readonly connector: string;
  readonly count: number;
  readonly maxWidthPx: number | null;
  readonly maxHeightPx: number | null;
  readonly maxRateHz: number | null;
  readonly note?: string;
}

/** A processor model from the library. Values only from manufacturer documentation, each cited. */
export interface ProcessorModel {
  readonly id: string;
  readonly manufacturer: string;
  readonly model: string;
  /** Total pixels it can load. */
  readonly maxPixels: number | null;
  readonly maxWidthPx: number | null;
  readonly maxHeightPx: number | null;
  readonly ethernetPorts: number;
  /** Pixels one Ethernet output port can load, at `portBasis`. */
  readonly pixelsPerPort: number | null;
  /** The conditions `pixelsPerPort` holds for, as the source states them, for example "8-bit, 60 Hz". */
  readonly portBasis: string | null;
  readonly inputs: readonly ProcessorInput[];
  readonly sources: readonly SourceRef[];
  readonly notes?: string;
}

export interface PortUsage {
  /** 1-based, as printed on the processor. */
  readonly port: number;
  readonly screenIds: readonly string[];
  readonly pixels: number;
  readonly capacity: number | null;
}

/** One processor in the project's plan, and how full it is. */
export interface ProcessorUsage {
  /** The plan entry's id, unique in the project. */
  readonly id: string;
  readonly modelId: string;
  /** "Processor 1: NovaStar MCTRL4K". */
  readonly label: string;
  /** The project outputs it receives, in order. */
  readonly outputIds: readonly string[];
  readonly loadWidthPx: number;
  readonly loadHeightPx: number;
  readonly pixelsUsed: number;
  readonly pixelsCapacity: number | null;
  readonly ports: readonly PortUsage[];
}

/** One screen's cabinets and what they add up to. */
export interface ScreenEngineering {
  readonly screenId: string;
  readonly screenName: string;
  readonly cabinetName: string;
  readonly columns: number;
  readonly rows: number;
  readonly cabinetCount: number;
  readonly widthUm: number;
  readonly heightUm: number;
  readonly areaMm2: number;
  readonly pixelsX: number;
  readonly pixelsY: number;
  readonly pitchUm: number;
  readonly weightG: number | null;
  readonly maxPowerMw: number | null;
  readonly typicalPowerMw: number | null;
  readonly refreshRateHz: number | null;
  readonly environment: "indoor" | "outdoor" | null;
  /** Supply voltage as the data sheet states it, for example "AC 100–240 V, 50/60 Hz". */
  readonly supplyVoltage: string | null;
}

export interface EngineeringTotals {
  readonly cabinetCount: number;
  readonly areaMm2: number;
  readonly pixels: number;
  /** Null when any screen's value is missing: a partial total is never shown as a total. */
  readonly weightG: number | null;
  readonly maxPowerMw: number | null;
  readonly typicalPowerMw: number | null;
}

export interface EngineeringSummary {
  readonly processors: readonly ProcessorUsage[];
  readonly screens: readonly ScreenEngineering[];
  readonly totals: EngineeringTotals;
  readonly findings: readonly EngineeringFinding[];
  readonly assumptions: readonly Assumption[];
  /** Every source cited by a processor or cabinet in this summary. */
  readonly sources: readonly SourceRef[];
  /** Printed with every report that shows these values. */
  readonly disclaimer: string;
}
