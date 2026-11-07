import { describe, expect, it } from "vitest";
import { UnitError, formatMm, mmToUm, parseMm, parsePx, px, um } from "@/domain/units";

describe("px and um", () => {
  it("reject anything that isn't an exact integer rather than rounding", () => {
    expect(() => px(1.5)).toThrow(UnitError);
    expect(() => px(NaN)).toThrow(UnitError);
    expect(() => um(0.1 + 0.2)).toThrow(UnitError);
    expect(() => px(2 ** 53)).toThrow(UnitError);
    expect(px(1920)).toBe(1920);
  });
});

describe("millimetres", () => {
  it("parses without float error", () => {
    expect(parseMm("499.98")).toBe(499980);
    expect(parseMm("0.1")).toBe(100);
    expect(parseMm("3.91")).toBe(3910);
    expect(parseMm("2.604")).toBe(2604);
    expect(parseMm("500")).toBe(500000);
  });

  it("rejects bad or over-precise input", () => {
    expect(parseMm("1.2345")).toBeNull();
    expect(parseMm("abc")).toBeNull();
    expect(parseMm("")).toBeNull();
    expect(parseMm("1e3")).toBeNull();
  });

  it("formats with integer arithmetic", () => {
    expect(formatMm(499980)).toBe("499.98");
    expect(formatMm(500000)).toBe("500");
    expect(formatMm(2604)).toBe("2.604");
    expect(formatMm(50)).toBe("0.05");
    expect(formatMm(-1500)).toBe("-1.5");
  });

  it("stays exact where float mm would drift", () => {
    // In float mm, 0.1 × 3 = 0.30000000000000004. In µm it is exact.
    expect(formatMm(mmToUm(0.1) * 3)).toBe("0.3");
    expect(formatMm(parseMm("499.98")! * 7)).toBe("3499.86");
  });
});

describe("parsePx", () => {
  it("accepts whole numbers only", () => {
    expect(parsePx("1024")).toBe(1024);
    expect(parsePx(" 12 ")).toBe(12);
    expect(parsePx("-4")).toBe(-4);
    expect(parsePx("1.5")).toBeNull();
    expect(parsePx("10px")).toBeNull();
    expect(parsePx("")).toBeNull();
  });
});
