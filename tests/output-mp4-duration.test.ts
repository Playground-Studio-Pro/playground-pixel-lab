import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMapping } from "@/engines/mapping";
import { videoTargets } from "@/engines/video-targets";
import { exportMp4 } from "@/modules/output/video-export";
import { pixelTestProject } from "./fixtures/pixel-test";

// A fragmented MP4 whose moov also claims the samples' duration plays at half speed in AVFoundation (QuickTime and
// Resolume Arena on macOS), which adds the two. CI has no AVFoundation: this reads the boxes of a whole export.
// `prototypes/output-video/avfoundation-check.swift` is the local check.

const CONTAINERS = new Set(["moov", "trak", "mdia", "mvex", "moof", "traf"]);
type Box = { type: string; path: string; body: DataView };

function boxes(view: DataView, path = ""): Box[] {
  const out: Box[] = [];
  for (let at = 0; at < view.byteLength; ) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > view.byteLength) throw new Error(`bad box size ${size} at ${at} in ${path}`);
    const type = String.fromCharCode(...[4, 5, 6, 7].map((i) => view.getUint8(at + i)));
    const body = new DataView(view.buffer, view.byteOffset + at + 8, size - 8);
    out.push({ type, path: `${path}/${type}`, body });
    if (CONTAINERS.has(type)) out.push(...boxes(body, `${path}/${type}`));
    at += size;
  }
  return out;
}

const only = (all: Box[], type: string): DataView => {
  const found = all.filter((b) => b.type === type);
  expect(found, type).toHaveLength(1);
  return found[0].body;
};

function stubEncoder() {
  const ctx = { save() {}, restore() {}, setTransform() {}, fillRect() {} };
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx }) });
  vi.stubGlobal("VideoFrame", class {
    timestamp: number;
    constructor(_canvas: unknown, init: { timestamp: number }) {
      this.timestamp = init.timestamp;
    }
    close() {}
  });
  vi.stubGlobal("VideoEncoder", class {
    static isConfigSupported = async () => ({ supported: true });
    state = "configured";
    private n = 0;
    constructor(private readonly callbacks: VideoEncoderInit) {}
    configure() {}
    encode(frame: VideoFrame, options: VideoEncoderEncodeOptions) {
      const data = [0, 0, 0, 2, 0x65, this.n++ & 255];
      this.callbacks.output({ timestamp: frame.timestamp, byteLength: data.length, type: options.keyFrame ? "key" : "delta", copyTo: (b: Uint8Array) => b.set(data) } as unknown as EncodedVideoChunk, {
        decoderConfig: { codec: "avc1.640033", description: new Uint8Array([1, 100, 0, 51, 255, 225, 0]) },
      });
    }
    async flush() {}
    close() {
      this.state = "closed";
    }
  });
}

afterEach(() => vi.unstubAllGlobals());

// One of each kind the exporter accepts, from a real project.
const all = videoTargets(resolveMapping(pixelTestProject()));
const targets = (["master", "output", "screen"] as const).map((kind) => ({ kind, target: all.find((t) => t.kind === kind && t.problem === null) }));

describe("exported MP4: one duration, the fragments' (AVFoundation, Resolume Arena on macOS)", () => {
  for (const { kind, target } of targets) {
    for (const fps of [24, 25, 30, 50, 60]) {
      it(`${kind} at ${fps} fps`, async () => {
        expect(target, `an exportable ${kind}`).toBeDefined();
        const { width, height } = target!;
        const frames = fps * 2;
        stubEncoder();
        const blob = await exportMp4({ width, height, fps, frames, source: { id: "t", name: "t", draw() {} }, input: { screens: [] } });
        const bytes = await blob.arrayBuffer();
        const found = boxes(new DataView(bytes));
        expect(found.filter((b) => b.path === `/${b.type}`).map((b) => b.type).slice(0, 4)).toEqual(["ftyp", "moov", "moof", "mdat"]);

        // Init segment: the moov lists no samples, so it claims no duration. Timescale is the frame rate.
        const mvhd = only(found, "mvhd"), tkhd = only(found, "tkhd"), mdhd = only(found, "mdhd"), mehd = only(found, "mehd");
        expect({ mvhd: mvhd.getUint32(12), mvhdDuration: mvhd.getUint32(16), tkhdDuration: tkhd.getUint32(20), mdhd: mdhd.getUint32(12), mdhdDuration: mdhd.getUint32(16) }).toEqual({ mvhd: fps, mvhdDuration: 0, tkhdDuration: 0, mdhd: fps, mdhdDuration: 0 });
        expect([tkhd.getUint32(76) / 65536, tkhd.getUint32(80) / 65536]).toEqual([width, height]);
        expect(found.filter((b) => b.path.startsWith("/moov/mvex/")).map((b) => b.type)).toEqual(["mehd", "trex"]);
        expect(mehd.getUint32(4)).toBe(frames);

        // Fragments: consecutive, one sample of one tick each, adding up to the same length.
        const starts = found.filter((b) => b.type === "tfdt").map((b) => b.body.getUint32(4));
        const truns = found.filter((b) => b.type === "trun").map((b) => b.body);
        expect(starts).toEqual(Array.from({ length: frames }, (_, i) => i));
        const durations = truns.map((t) => {
          expect(t.getUint32(0)).toBe(0x701); // data offset, sample duration, size, flags
          expect(t.getUint32(4)).toBe(1);
          return t.getUint32(12);
        });
        expect(durations.reduce((a, b) => a + b, 0)).toBe(mehd.getUint32(4));
        expect(durations.reduce((a, b) => a + b, 0) / fps).toBe(2);
        expect(found.filter((b) => b.type === "mdat").map((b) => b.body.getUint8(5))).toEqual(Array.from({ length: frames }, (_, i) => i & 255));
      });
    }
  }
});
