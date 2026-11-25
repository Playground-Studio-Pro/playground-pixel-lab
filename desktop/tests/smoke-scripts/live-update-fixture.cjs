// Projects for the live-update measurement (live-update-cost.cjs): N screens on a fixed 1920 × 1080 master and output,
// in a grid of equal cells, so only the screen count changes between 8, 32 and 60, not the pixel area.
// Every screen starts 8 px inside its cell, so a ±1 px move never touches a neighbour. The slices follow the content,
// as a move in the fast map would. Plain JSON in the stored shape (schemaVersion 2); the output page parses it with
// the app's own parseProjectFile, so a shape mistake here fails the run instead of being measured.
const GRIDS = { 8: [4, 2], 32: [8, 4], 60: [10, 6] };
const CABINET = { id: 'live-40', name: 'Live test 40 × 40', widthUm: 500000, heightUm: 500000, pixelsX: 40, pixelsY: 40, nominalPitchUm: 12500, source: 'custom' };
const INSET = 8;

/** @returns {{ project: object, outputId: string, firstScreenId: string, base: { x: number, y: number } }} */
function liveProject(count) {
  const grid = GRIDS[count];
  if (!grid) throw new Error(`No grid for ${count} screens`);
  const [cols, rows] = grid;
  const cellW = 1920 / cols, cellH = 1080 / rows;
  const columns = Math.floor((cellW - 2 * INSET) / CABINET.pixelsX);
  const rowsPerScreen = Math.floor((cellH - 2 * INSET) / CABINET.pixelsY);
  const screens = [], regions = [], slices = [];
  for (let i = 0; i < count; i++) {
    const cx = i % cols, cy = Math.floor(i / cols);
    const id = `live-s${i}`;
    screens.push({ id, name: `Screen ${i + 1}`, cabinetId: CABINET.id, columns, rows: rowsPerScreen, groupId: null, color: '#2F6FE4', stageX: cx * 6000000, stageY: cy * 6000000 });
    regions.push({ screenId: id, canvasId: 'live-canvas', x: Math.round(cx * cellW) + INSET, y: Math.round(cy * cellH) + INSET, allowOverlap: false });
    slices.push({ screenId: id, outputId: 'live-out', followsContent: true, x: 0, y: 0 });
  }
  const project = {
    schemaVersion: 2, id: `live-${count}`,
    meta: { name: `Live update ${count} screens`, client: '', venue: '', notes: '', createdAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z', revision: 0 },
    cabinets: [CABINET],
    physical: { screens, groups: [] },
    content: { master: { mode: 'fixed', width: 1920, height: 1080 }, canvases: [{ id: 'live-canvas', name: 'Main canvas', originX: 0, originY: 0 }], regions },
    output: { outputs: [{ id: 'live-out', name: 'OUT 1', sizing: { mode: 'fixed', width: 1920, height: 1080 } }], slices },
    modules: {},
  };
  return { project, outputId: 'live-out', firstScreenId: 'live-s0', base: { x: regions[0].x, y: regions[0].y } };
}

/**
 * The project text for revision `revision`: screen 1 moved by +1 px on odd revisions, back on even ones. The revision
 * is also written to meta.revision, so the output page's JSON.parse tells which session it is preparing.
 */
function movedText(fixture, revision) {
  const p = structuredClone(fixture.project);
  p.meta.revision = revision;
  p.content.regions[0].x = fixture.base.x + (revision % 2);
  return JSON.stringify({ format: 'playground-pixel-lab/project', project: p }, null, 2) + '\n';
}

module.exports = { liveProject, movedText, COUNTS: Object.keys(GRIDS).map(Number) };
