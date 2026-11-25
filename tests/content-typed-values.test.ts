import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatNumber, parseTypedColor, parseTypedNumber, stepTypedNumber, type ValueLimit } from "@/engines/content/typed-value";
import { DEPTH_LIMITS, EMERALD_CHAMBER, normalizeDepthConfig } from "@/engines/depth/config";

const depth = DEPTH_LIMITS.depthM;

describe("typed numbers", () => {
  it("accepts a point, a comma, signs, spaces and the unit", () => {
    for (const [text, value] of [["12.5", 12.5], ["12,5", 12.5], [" 12 ", 12], ["+7", 7], [".5e", null], ["12 m", 12], ["12.5M", 12.5], ["2.", 2]] as const) {
      const typed = parseTypedNumber(text, depth, { unit: "m" });
      if (value === null) expect(typed.ok).toBe(false);
      else expect(typed).toEqual({ ok: true, value, limited: null });
    }
    expect(parseTypedNumber("-,5", DEPTH_LIMITS.offsetXM)).toEqual({ ok: true, value: -0.5, limited: null });
  });

  it("refuses anything else, and says why", () => {
    for (const text of ["", " ", "abc", "1e3", "0x10", "1,000.5", "1.2.3", "--2", "NaN", "Infinity", "12 px"]) {
      expect(parseTypedNumber(text, depth, { unit: "m" })).toEqual({ ok: false, reason: "Type a number, such as 12.5." });
    }
    expect(parseTypedNumber("9".repeat(400), depth).ok).toBe(false);
  });

  it("brings a value out of range to its limit, and says which", () => {
    expect(parseTypedNumber("99", depth, { unit: "m" })).toEqual({ ok: true, value: 30, limited: "The highest is 30 m." });
    expect(parseTypedNumber("-1", depth, { unit: "m" })).toEqual({ ok: true, value: 2, limited: "The lowest is 2 m." });
    expect(parseTypedNumber("30", depth)).toEqual({ ok: true, value: 30, limited: null });
  });

  it("takes whole numbers only where the value is whole", () => {
    expect(parseTypedNumber("1234", DEPTH_LIMITS.count, { whole: true })).toEqual({ ok: true, value: 1234, limited: null });
    expect(parseTypedNumber("12.5", DEPTH_LIMITS.count, { whole: true })).toEqual({ ok: false, reason: "Type a whole number, such as 12." });
    expect(parseTypedNumber("12.0", DEPTH_LIMITS.count, { whole: true })).toMatchObject({ ok: true, value: 12 });
  });

  it("steps from what's typed and stops at the limits, without float noise", () => {
    expect(stepTypedNumber("0.1", 1, DEPTH_LIMITS.offsetXM)).toBe("0.2");
    expect(stepTypedNumber("0.2", 1, DEPTH_LIMITS.offsetXM)).toBe("0.3");
    expect(stepTypedNumber("0.045", -1, DEPTH_LIMITS.fogDensity)).toBe("0.04");
    expect(stepTypedNumber("29.5", 10, depth)).toBe("30");
    expect(stepTypedNumber("2", -1, depth)).toBe("2");
    expect(stepTypedNumber("abc", 1, depth)).toBeNull();
  });

  it("what it shows types back to the same value, for every Depth Studio limit", () => {
    for (const limit of Object.values(DEPTH_LIMITS) as ValueLimit[]) {
      for (let v = limit.min; v <= limit.max; v += Math.max(limit.step, (limit.max - limit.min) / 200)) {
        const value = Number(v.toFixed(3)) + 0;
        expect(parseTypedNumber(formatNumber(value), limit)).toEqual({ ok: true, value, limited: null });
      }
    }
  });

  it("a committed value is already one Depth Studio accepts unchanged", () => {
    const typed = parseTypedNumber("12.34", depth);
    expect(typed.ok && normalizeDepthConfig({ ...EMERALD_CHAMBER, room: { ...EMERALD_CHAMBER.room, depthM: typed.value } }).room.depthM).toBe(12.34);
  });
});

describe("typed colors", () => {
  it("accepts #RRGGBB, with or without the #, in any case", () => {
    for (const text of ["#5fd08c", "5FD08C", " #5FD08C "]) expect(parseTypedColor(text)).toEqual({ ok: true, value: "#5FD08C", limited: null });
  });

  it("refuses anything else, and says why", () => {
    for (const text of ["", "#FFF", "red", "#12345G", "#1234567", "rgb(0,0,0)"]) {
      expect(parseTypedColor(text)).toEqual({ ok: false, reason: "Type a color as #RRGGBB, such as #5FD08C." });
    }
  });
});

describe("every Content slider and picker has a typed value", () => {
  it("no bare range or color input outside the shared fields", () => {
    for (const file of ["src/modules/depth-studio/depth-inspector.tsx", "src/modules/content/aurora-controls.tsx"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/type="(range|color)"/);
    }
    // The loop position is the one other slider: its number is the frame field.
    expect(readFileSync("src/modules/depth-studio/depth-panel.tsx", "utf8").match(/type="range"/g)).toHaveLength(1);
  });
});
