import type { DrawingBox, DrawingPage, DrawingText } from "@/engines/guided-led";

/**
 * Reads the first page of a vector PDF into what the drawing reader needs: text with positions and closed
 * axis-aligned rectangles, in PDF points, top-left origin, y down. No OCR, no network.
 *
 * pdf.js is imported only here, and this module is imported only when a PDF is opened, so it never weighs on the
 * app's first load. Its worker code runs on the main thread (`globalThis.pdfjsWorker`), which needs no worker URL: that
 * keeps it working from a static export and inside Electron without touching either's security settings. A one-page
 * drawing is small enough for that.
 */

type PdfJs = typeof import("pdfjs-dist");
type Matrix = [number, number, number, number, number, number];

let loading: Promise<PdfJs> | null = null;

async function pdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import("pdfjs-dist");
  })();
  return loading;
}

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Closed four-corner axis-aligned subpaths in one path's draw data. */
function rectsInPath(data: ArrayLike<number>, ctm: Matrix, ops: { moveTo: number; lineTo: number; closePath: number }): DrawingBox[] {
  const out: DrawingBox[] = [];
  let points: [number, number][] = [];
  let closed = false;
  const flush = () => {
    const pts = points.length === 5 && near(points[0], points[4]) ? points.slice(0, 4) : points;
    if ((closed || points.length === 5) && pts.length === 4) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const axisAligned = pts.every((p, i) => {
        const q = pts[(i + 1) % 4];
        return Math.abs(p[0] - q[0]) < 0.01 || Math.abs(p[1] - q[1]) < 0.01;
      });
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const w = Math.max(...xs) - x0;
      const h = Math.max(...ys) - y0;
      if (axisAligned && w > 0.5 && h > 0.5) out.push({ x: x0, y: y0, width: w, height: h });
    }
    points = [];
    closed = false;
  };
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === ops.moveTo) {
      flush();
      points.push(apply(ctm, data[i], data[i + 1]));
      i += 2;
    } else if (op === ops.lineTo) {
      points.push(apply(ctm, data[i], data[i + 1]));
      i += 2;
    } else if (op === ops.closePath) {
      closed = true;
      flush();
    } else {
      // Curves: not a rectangle. Skip their coordinates and drop the subpath.
      i += op === 2 ? 6 : op === 3 ? 4 : 0;
      points = [];
    }
  }
  flush();
  return out;
}

const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;

export interface LoadedPdf {
  readonly page: DrawingPage;
  readonly pageCount: number;
  /** Draws the page into a canvas at `scale` canvas pixels per PDF point. Browser only. */
  render(canvas: HTMLCanvasElement, scale: number): Promise<void>;
  destroy(): Promise<void>;
}

/** Opens a PDF and reads its first page. Throws a plain-words error when the file isn't a readable PDF. */
export async function readPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const lib = await pdfjs();
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = lib.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    throw new Error(`This PDF can't be opened: ${e instanceof Error ? e.message : String(e)}`);
  }
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const base = viewport.transform as Matrix;

  const texts: DrawingText[] = [];
  const content = await page.getTextContent();
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const t = multiply(base, item.transform as Matrix);
    const size = Math.hypot(t[2], t[3]) || item.height;
    const width = item.width * (Math.hypot(base[0], base[1]) || 1);
    texts.push({ text: item.str, x: t[4], y: t[5] - size, width, height: size });
  }

  const rects: DrawingBox[] = [];
  const list = await page.getOperatorList();
  const { OPS } = lib;
  const drawOps = { moveTo: 0, lineTo: 1, closePath: 4 };
  const stack: Matrix[] = [];
  let ctm: Matrix = base;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? base;
    else if (fn === OPS.transform) ctm = multiply(ctm, args as unknown as Matrix);
    else if (fn === OPS.constructPath) {
      const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
      if (data) rects.push(...rectsInPath(data, ctm, drawOps));
    }
  }

  return {
    page: { kind: "vector", width: viewport.width, height: viewport.height, texts, rects },
    pageCount: doc.numPages,
    async render(canvas, scale) {
      const vp = page.getViewport({ scale });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("The browser couldn't draw the PDF.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    },
    destroy: () => task.destroy(),
  };
}
