import { describe, expect, it } from 'vitest';
import { calibrationMotion, CALIBRATION_VIDEO, createCalibrationSource } from '../prototypes/output-video/calibration-source';

function recording() {
  const calls: unknown[][] = [];
  const ctx = new Proxy({}, {
    get: (_target, key) => (...args: unknown[]) => calls.push([key, ...args]),
    set: (_target, key, value) => { calls.push([key, value]); return true; },
  }) as CanvasRenderingContext2D;
  return { ctx, calls };
}
function draw(frame: number, showFrameCounter = false) {
  const { ctx, calls } = recording();
  createCalibrationSource({ showFrameCounter }).draw(ctx, { ...CALIBRATION_VIDEO, frame, screens: [] }, { scale: 1, fontFamily: 'Arial' });
  return calls;
}
describe('animated calibration prototype', () => {
  it('has the exact acceptance settings', () => {
    expect(CALIBRATION_VIDEO).toEqual({ width: 1920, height: 1080, fps: 30, frames: 300 });
  });
  it('renders deterministically and repeats exactly every 300 frames', () => {
    for (let frame = 0; frame < 300; frame++) {
      expect(draw(frame)).toEqual(draw(frame + 300));
    }
    expect(draw(0)).not.toEqual(draw(75));
    expect(draw(75)).toEqual(draw(75));
  });
  it('scans both axes and bounds seam movement to an ordinary adjacent step', () => {
    const states = Array.from({ length: 301 }, (_, i) => calibrationMotion(i));
    for (const state of states) {
      expect(state.verticalX).toBeGreaterThanOrEqual(64);
      expect(state.verticalX).toBeLessThanOrEqual(1856);
      expect(state.horizontalY).toBeGreaterThanOrEqual(192);
      expect(state.horizontalY).toBeLessThanOrEqual(768);
    }
    expect(calibrationMotion(0)).toEqual(calibrationMotion(300));
    expect(calibrationMotion(0).verticalX).not.toBe(calibrationMotion(150).verticalX);
    expect(calibrationMotion(0).horizontalY).not.toBe(calibrationMotion(75).horizontalY);
    for (const axis of ['verticalX', 'horizontalY', 'markerX', 'markerY'] as const) {
      const steps = states.slice(1).map((state, i) => Math.abs(state[axis] - states[i][axis]));
      expect(steps[299]).toBeLessThanOrEqual(Math.max(...steps.slice(0, 299)) + 1e-9);
    }
  });
  it('disables the resetting counter by default and makes it explicitly optional', () => {
    expect(JSON.stringify(draw(299))).not.toContain('Frame 299');
    expect(JSON.stringify(draw(299, true))).toContain('Frame 299 / 299');
    expect(JSON.stringify(draw(300, true))).toContain('Frame 000 / 299');
  });
  it('includes exact RGB references and the true center crosshair', () => {
    const calls = draw(0);
    for (const color of ['#ff0000', '#00ff00', '#0000ff']) expect(calls).toContainEqual(['fillStyle', color]);
    expect(calls).toContainEqual(['moveTo', 800, 540]);
    expect(calls).toContainEqual(['lineTo', 1120, 540]);
    expect(calls).toContainEqual(['moveTo', 960, 380]);
    expect(calls).toContainEqual(['lineTo', 960, 700]);
    expect(() => calibrationMotion(0.5)).toThrow('integer');
  });
});
