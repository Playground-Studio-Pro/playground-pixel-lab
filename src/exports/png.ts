import type { PixelMapScene } from "./scene";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FONT = "Arial, Helvetica, sans-serif";

/** Reads width and height from a PNG's IHDR chunk. Null if the bytes aren't a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Draws a scene at exactly one canvas pixel per LED pixel. Browser only. */
export function drawScene(scene: PixelMapScene, canvas: HTMLCanvasElement): void {
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error(`The browser couldn't allocate a ${scene.width}×${scene.height} image. Reduce the canvas size and try again.`);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  for (const node of scene.nodes) {
    switch (node.kind) {
      case "rect":
        ctx.fillStyle = node.fill;
        ctx.fillRect(node.x, node.y, node.width, node.height);
        break;
      case "line":
        ctx.strokeStyle = node.stroke;
        ctx.beginPath();
        ctx.moveTo(node.x1, node.y1);
        ctx.lineTo(node.x2, node.y2);
        ctx.stroke();
        break;
      case "text":
        ctx.fillStyle = node.fill;
        ctx.font = `${node.size}px ${FONT}`;
        ctx.fillText(node.text, node.x, node.y);
        break;
    }
  }
}

/** Rasterizes a scene and verifies the encoded file's dimensions before returning it. */
export async function renderPng(scene: PixelMapScene): Promise<Blob> {
  if (scene.width < 1 || scene.height < 1) {
    throw new Error("This pixel map is empty. Add a screen before exporting.");
  }
  const canvas = document.createElement("canvas");
  drawScene(scene, canvas);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error(`The browser couldn't encode a ${scene.width}×${scene.height} PNG. Reduce the canvas size and try again.`);
  }
  const size = readPngSize(new Uint8Array(await blob.slice(0, 24).arrayBuffer()));
  if (!size || size.width !== scene.width || size.height !== scene.height) {
    throw new Error(`PNG export failed its size check: expected ${scene.width}×${scene.height}, got ${size ? `${size.width}×${size.height}` : "an unreadable file"}.`);
  }
  return blob;
}
