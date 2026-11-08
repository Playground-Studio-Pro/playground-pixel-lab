/**
 * The example gallery, as plain data so the start screen can list it without loading the builders.
 * tests/examples.test.ts checks every figure here against the project its builder makes.
 */
export type ExampleId = "festival" | "keynote" | "motion-lab" | "stress-500";

export interface ExampleEntry {
  readonly id: ExampleId;
  readonly name: string;
  readonly description: string;
  readonly screens: number;
  readonly master: string;
  readonly outputs: number;
  /** Demos show real show shapes. Tests exist to measure or check, and say so. */
  readonly kind: "demo" | "test";
}

export const EXAMPLES: readonly ExampleEntry[] = [
  {
    id: "festival",
    name: "Festival Main Stage",
    description: "Center wall with a header sharing its top band, two IMAG screens, a ribbon and a DJ booth on its own canvas.",
    screens: 6,
    master: "5120 × 1664",
    outputs: 2,
    kind: "demo",
  },
  {
    id: "keynote",
    name: "Corporate Keynote",
    description: "A wide main wall between two portrait side screens, mapped edge to edge on one canvas.",
    screens: 3,
    master: "4224 × 1536",
    outputs: 1,
    kind: "demo",
  },
  {
    id: "motion-lab",
    name: "Motion Lab acceptance",
    description: "Three resolutions, an intentional overlap and an independent canvas. Checks that content stays continuous.",
    screens: 3,
    master: "2688 × 768",
    outputs: 1,
    kind: "test",
  },
  {
    id: "stress-500",
    name: "Stress test, 500 screens",
    description: "500 identical screens in a grid, for checking speed on this machine.",
    screens: 500,
    master: "6400 × 5120",
    outputs: 1,
    kind: "test",
  },
];
