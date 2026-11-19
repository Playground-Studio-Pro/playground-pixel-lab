import { describe, expect, it } from "vitest";
import { resampleArea, type RgbaImage } from "@/engines/resample";

const image = (width: number, height: number, px: (x: number, y: number) => [number, number, number, number]): RgbaImage => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(px(x, y), (y * width + x) * 4);
  return { width, height, data };
};
const at = (img: RgbaImage, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe("resampleArea (deterministic logo scaling)", () => {
  it("same input, same bytes", () => {
    const src = image(2000, 624, (x, y) => [255, 255, 255, (x * 7 + y * 13) % 256]);
    const a = resampleArea(src, 520, 162);
    const b = resampleArea(src, 520, 162);
    expect(a.width).toBe(520);
    expect(a.height).toBe(162);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it("an integer ratio averages each block exactly", () => {
    const src = image(4, 2, (x) => (x < 2 ? [200, 100, 0, 255] : [0, 0, 0, 255]));
    const out = resampleArea(src, 2, 1);
    expect(at(out, 0, 0)).toEqual([200, 100, 0, 255]);
    expect(at(out, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it("works in premultiplied alpha: transparent pixels don't darken the colour", () => {
    const src = image(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    expect(at(resampleArea(src, 1, 1), 0, 0)).toEqual([255, 255, 255, 128]);
  });

  it("weights partial coverage by area at a non-integer ratio", () => {
    // 3 → 2: output 0 covers source 0 and half of 1; output 1 covers the other half of 1 and 2.
    const src = image(3, 1, (x) => [[0, 0, 0, 255], [90, 90, 90, 255], [180, 180, 180, 255]][x] as [number, number, number, number]);
    const out = resampleArea(src, 2, 1);
    expect(at(out, 0, 0)).toEqual([30, 30, 30, 255]);
    expect(at(out, 1, 0)).toEqual([150, 150, 150, 255]);
  });

  it("a flat image stays flat at any size, up or down", () => {
    const src = image(7, 5, () => [12, 34, 56, 255]);
    for (const [w, h] of [[3, 2], [7, 5], [20, 9], [1, 1]]) {
      const out = resampleArea(src, w, h);
      for (let i = 0; i < w * h; i++) expect([...out.data.slice(i * 4, i * 4 + 4)]).toEqual([12, 34, 56, 255]);
    }
  });

  it("refuses sizes that aren't whole positive pixels", () => {
    const src = image(2, 2, () => [0, 0, 0, 255]);
    for (const [w, h] of [[0, 1], [1, 0], [1.5, 1], [-1, 2]]) expect(() => resampleArea(src, w, h)).toThrow(RangeError);
  });
});
