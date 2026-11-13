import { exportMp4 } from '../../src/modules/output/video-export';
import { CALIBRATION_VIDEO, createCalibrationSource } from './calibration-source';
const button = document.querySelector<HTMLButtonElement>('#export')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const download = document.querySelector<HTMLAnchorElement>('#download')!;
const player = document.querySelector<HTMLVideoElement>('#player')!;
let controller: AbortController;
let url: string | undefined;
cancel.onclick = () => controller.abort();
button.onclick = async () => {
  controller = new AbortController();
  button.disabled = true; cancel.disabled = false; download.hidden = true;
  let image: ImageBitmap | undefined;
  try {
    const showFrameCounter = document.querySelector<HTMLInputElement>('#counter')!.checked;
    const logoWidth = Number(document.querySelector<HTMLInputElement>('#logo-width')!.value);
    const logoOpacity = Number(document.querySelector<HTMLInputElement>('#logo-opacity')!.value);
    const file = document.querySelector<HTMLInputElement>('#logo')!.files?.[0];
    if (file) image = await createImageBitmap(file);
    const blob = await exportMp4({
      ...CALIBRATION_VIDEO, input: { screens: [] }, signal: controller.signal,
      logo: image ? { image, width: logoWidth, height: logoWidth * image.height / image.width, opacity: logoOpacity } : undefined,
      source: createCalibrationSource({ showFrameCounter }),
      onProgress: (n, total) => { status.value = `Encoded ${n}/${total}`; },
    });
    if (url) URL.revokeObjectURL(url);
    const playbackUrl = URL.createObjectURL(blob);
    url = playbackUrl;
    download.href = url; download.download = 'pixel-animated-calibration-1920x1080-30fps.mp4'; download.hidden = false;
    await new Promise<void>((resolve, reject) => {
      player.onloadedmetadata = () => resolve();
      player.onerror = () => reject(new Error('Browser could not load the MP4.'));
      player.src = playbackUrl;
    });
    if (player.videoWidth !== 1920 || player.videoHeight !== 1080 || Math.abs(player.duration - 10) > 0.01) throw new Error('Playback metadata verification failed.');
    status.value = `Verified browser metadata: ${player.videoWidth}×${player.videoHeight}, ${player.duration}s. Play and inspect looping; ffprobe verifies encoded frame count.`;
  } catch (error) { status.value = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
  finally { image?.close(); button.disabled = false; cancel.disabled = true; }
};
