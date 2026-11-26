// pdf.js ships its worker without types. It is imported only to run on the main thread (`globalThis.pdfjsWorker`).
declare module "pdfjs-dist/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
