import type { ResolvedMapping } from "@/engines/mapping";
import { drawScene, readPngSize } from "@/exports/png";
import { outputScene } from "@/exports/scene";
import { drawCalibration } from "../calibration/draw";
import type { GuidedCard } from "./cards";

/**
 * Turns guided cards and pixel maps into PNG files, at exactly one image pixel per LED pixel. Browser only. Every file
 * is checked after encoding: its PNG header must carry the size it was drawn at.
 */

export interface PngFile {
  readonly name: string;
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

async function encode(canvas: HTMLCanvasElement, name: string): Promise<PngFile> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(`The browser couldn't encode a ${canvas.width}×${canvas.height} PNG for ${name}.`);
  const size = readPngSize(new Uint8Array(await blob.slice(0, 24).arrayBuffer()));
  if (!size || size.width !== canvas.width || size.height !== canvas.height) throw new Error(`${name} came out at the wrong size. Nothing was saved.`);
  return { name, blob, width: size.width, height: size.height };
}

export async function cardPng(card: GuidedCard, fontFamily: string): Promise<PngFile> {
  const canvas = document.createElement("canvas");
  canvas.width = card.frame.width;
  canvas.height = card.frame.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error(`The browser couldn't allocate a ${card.frame.width}×${card.frame.height} image.`);
  const options = { scale: 1, fontFamily, logo: null, frame: 0, fps: 30 as const };
  drawCalibration(ctx, card.frame, options, "static");
  drawCalibration(ctx, card.frame, options, "counters");
  return encode(canvas, card.fileName);
}

/** The processor pixel map of every output: where each screen sits, from the existing pixel map export. */
export async function pixelMapPngs(mapping: ResolvedMapping, projectName: string): Promise<PngFile[]> {
  const files: PngFile[] = [];
  for (const [i, output] of mapping.outputs.entries()) {
    const scene = outputScene(mapping, output.outputId, `${projectName} · OUT ${i + 1}`);
    const canvas = document.createElement("canvas");
    drawScene(scene, canvas);
    files.push(await encode(canvas, `pixel-map_out-${i + 1}_${scene.width}x${scene.height}.png`));
  }
  return files;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function zipFiles(files: readonly PngFile[], readme: string): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("README.txt", readme);
  for (const f of files) zip.file(f.name, f.blob);
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
