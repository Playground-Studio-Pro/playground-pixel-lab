import type { FrameSource } from '../../src/preview/contract';

export const CALIBRATION_VIDEO = { width: 1920, height: 1080, fps: 30, frames: 300 } as const;

/** Normalize BEFORE calculating motion, so frame 300 is bit-for-bit the same state as frame 0. */
export function calibrationMotion(frame: number) {
  if (!Number.isSafeInteger(frame)) throw new Error('Calibration requires an integer frame index.');
  const index = ((frame % CALIBRATION_VIDEO.frames) + CALIBRATION_VIDEO.frames) % CALIBRATION_VIDEO.frames;
  const phase = index / CALIBRATION_VIDEO.frames;
  const angle = phase * Math.PI * 2;
  return {
    index, phase, angle,
    // Cosine scans turn around smoothly; there is no position reset at the loop boundary.
    verticalX: 64 + 1792 * (1 - Math.cos(angle)) / 2,
    horizontalY: 192 + 576 * (1 - Math.cos(angle + Math.PI / 2)) / 2,
    markerX: 1792 + 48 * Math.sin(angle),
    markerY: 924 - 48 * Math.cos(angle),
  };
}

/** Prototype-only test card. No shared renderer or mapping logic is copied here. */
export function createCalibrationSource({ showFrameCounter = false }: { showFrameCounter?: boolean } = {}): FrameSource {
  // Snapshot the option once, rather than reading mutable controls during an export.
  return {
    id: 'output-animated-calibration-demo',
    name: 'Animated LED calibration demo',
    draw(ctx, input, options) {
      if (input.width !== 1920 || input.height !== 1080 || input.fps !== 30) {
        throw new Error('This calibration prototype requires 1920×1080 at 30 fps.');
      }
      const motion = calibrationMotion(input.frame);
      ctx.save();
      try {
        ctx.scale(options.scale, options.scale);
        ctx.fillStyle = '#080b10'; ctx.fillRect(0, 0, 1920, 1080);
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const text = (value: string, x: number, y: number, size = 24, color = '#c8d0dc') => {
          ctx.font = `${size}px ${options.fontFamily}`; ctx.fillStyle = color; ctx.fillText(value, x, y);
        };
        const line = (x1: number, y1: number, x2: number, y2: number, color: string, width = 2) => {
          ctx.strokeStyle = color; ctx.lineWidth = width;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        };
        text('Pixel Lab / LED calibration', 64, 62, 32, '#ffffff');
        text('1920 × 1080  /  30 fps  /  10 s', 64, 108, 23);
        ctx.textAlign = 'right';
        text(showFrameCounter ? `Frame ${String(motion.index).padStart(3, '0')} / 299` : 'Seamless motion / 300 frames', 1856, 62, 26, '#ffffff');
        text('Horizontal + vertical scan · center alignment · RGB references', 1856, 108, 21);
        ctx.textAlign = 'left';

        // Fixed integer-pixel geometry and a neutral grid make motion/alignment easy to inspect.
        for (let x = 64; x <= 1856; x += 112) line(x, 192, x, 768, '#26303d');
        for (let y = 192; y <= 768; y += 96) line(64, y, 1856, y, '#26303d');
        ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2; ctx.strokeRect(64, 192, 1792, 576);
        ctx.strokeStyle = '#526174'; ctx.strokeRect(16, 16, 1888, 1048);
        // Confine scans to the measurement region, keeping RGB references stable.
        ctx.save();
        ctx.beginPath(); ctx.rect(64, 192, 1792, 576); ctx.clip();
        line(motion.verticalX, 192, motion.verticalX, 768, '#ffbc6650', 18);
        line(motion.verticalX, 192, motion.verticalX, 768, '#ffbc66', 4);
        line(64, motion.horizontalY, 1856, motion.horizontalY, '#66ddff50', 18);
        line(64, motion.horizontalY, 1856, motion.horizontalY, '#66ddff', 4);
        ctx.restore();

        // True image center, distinct from the scan region center.
        line(800, 540, 1120, 540, '#ffffff');
        line(960, 380, 960, 700, '#ffffff');
        ctx.beginPath(); ctx.arc(960, 540, 118, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff'; ctx.stroke();
        text('Center / 960, 540', 1128, 540, 21);

        const refs = [
          { name: 'R / 255, 0, 0', color: '#ff0000' },
          { name: 'G / 0, 255, 0', color: '#00ff00' },
          { name: 'B / 0, 0, 255', color: '#0000ff' },
        ];
        refs.forEach((ref, i) => {
          const x = 64 + i * 504;
          text(ref.name, x, 816, 22);
          ctx.fillStyle = ref.color; ctx.fillRect(x, 844, 472, 96);
        });
        for (let i = 0; i < 16; i++) {
          const gray = i * 17;
          ctx.fillStyle = `rgb(${gray},${gray},${gray})`; ctx.fillRect(64 + i * 92, 964, 92, 44);
        }
        text('Grayscale / 0 → 255', 64, 1034, 20);

        // A rotating marker/arc is a continuous loop phase indicator, unlike a resetting fill bar.
        ctx.strokeStyle = '#526174'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(1792, 924, 48, 0, Math.PI * 2); ctx.stroke();
        for (let tick = 0; tick < 10; tick++) {
          const a = tick * Math.PI / 5;
          line(1792 + 58 * Math.sin(a), 924 - 58 * Math.cos(a),
            1792 + 65 * Math.sin(a), 924 - 65 * Math.cos(a), '#8896aa');
        }
        ctx.beginPath(); ctx.arc(1792, 924, 48, motion.angle - Math.PI / 2 - 0.7, motion.angle - Math.PI / 2);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.stroke();
        ctx.beginPath(); ctx.arc(motion.markerX, motion.markerY, 7, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.textAlign = 'center'; text('Loop phase', 1792, 1028, 21);
      } finally { ctx.restore(); }
    },
  };
}
