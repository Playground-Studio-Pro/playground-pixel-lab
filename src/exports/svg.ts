import type { PixelMapScene } from "./scene";

const FONT = "Arial, Helvetica, sans-serif";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Width, height and viewBox are identical, so one SVG unit is exactly one LED pixel. */
export function renderSvg(scene: PixelMapScene): string {
  const body = scene.nodes.map((node) => {
    switch (node.kind) {
      case "rect":
        return `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${node.fill}"/>`;
      case "line":
        return `<line x1="${node.x1}" y1="${node.y1}" x2="${node.x2}" y2="${node.y2}" stroke="${node.stroke}" stroke-width="1" shape-rendering="geometricPrecision"/>`;
      case "text":
        return `<text x="${node.x}" y="${node.y}" font-size="${node.size}" fill="${node.fill}" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" text-rendering="geometricPrecision">${escapeXml(node.text)}</text>`;
    }
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" shape-rendering="crispEdges">`,
    `<title>${escapeXml(scene.title)}</title>`,
    ...body,
    `</svg>`,
    "",
  ].join("\n");
}
