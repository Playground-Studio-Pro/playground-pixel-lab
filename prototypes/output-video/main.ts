import { exportMp4 } from '../../src/modules/output/video-export';
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
    const file = document.querySelector<HTMLInputElement>('#logo')!.files?.[0];
    if (file) image = await createImageBitmap(file);
    const blob = await exportMp4({
      width: 1920, height: 1080, fps: 30, frames: 300, input: { screens: [] }, signal: controller.signal,
      logo: image ? { image, width: 360, height: 360 * image.height / image.width } : undefined,
      source: { id: 'static-verification', name: 'Static verification', draw(ctx, input) {
        const colors = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f', '#000'];
        colors.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(i * input.width / 8, 0, input.width / 8, input.height); });
      } },
      onProgress: (n, total) => { status.value = `Encoded ${n}/${total}`; },
    });
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    download.href = url; download.download = 'pixel-verification-1920x1080-30fps.mp4'; download.hidden = false;
    player.src = url;
    await new Promise<void>((resolve, reject) => {
      player.onloadedmetadata = () => resolve();
      player.onerror = () => reject(new Error('Browser could not load the MP4.'));
    });
    if (player.videoWidth !== 1920 || player.videoHeight !== 1080 || Math.abs(player.duration - 10) > 0.01) throw new Error('Playback metadata verification failed.');
    status.value = `Verified browser metadata: ${player.videoWidth}×${player.videoHeight}, ${player.duration}s. Play and inspect looping; ffprobe verifies encoded frame count.`;
  } catch (error) { status.value = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
  finally { image?.close(); button.disabled = false; cancel.disabled = true; }
};
