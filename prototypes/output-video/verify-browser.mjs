/** Dependency-free CDP check. Start isolated Chrome with --remote-debugging-port=9314 first. */
import { writeFile } from 'node:fs/promises';
const origin = process.env.PIXEL_ORIGIN ?? 'http://127.0.0.1:3104';
const endpoint = process.env.PIXEL_CDP ?? 'http://127.0.0.1:9314';
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(`${origin}/prototypes/output-video/index.html`)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const result = JSON.parse(String(data));
  if (result.id) { const request = pending.get(result.id); pending.delete(result.id); if (result.error) request.reject(result.error); else request.resolve(result.result); }
};
function command(method, params = {}) {
  return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('#export')?.onclick)`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const pixels = await evaluate(`(async () => {
    const { createCalibrationSource, CALIBRATION_VIDEO } = await import('/prototypes/output-video/calibration-source.ts');
    const source = createCalibrationSource();
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const draw = frame => { source.draw(ctx, { ...CALIBRATION_VIDEO, frame, screens: [] }, { scale: 1, fontFamily: 'Arial' }); return ctx.getImageData(0, 0, 1920, 1080).data; };
    const first = draw(0); const last = draw(299); const next = draw(300); const second = draw(1);
    const difference = (a,b) => a.reduce((n,v,i) => n + Math.abs(v-b[i]), 0) / a.length;
    return { periodic: difference(first,next), seam: difference(last,first), adjacent: difference(first,second) };
  })()`);
  if (pixels.periodic !== 0 || pixels.seam > pixels.adjacent * 1.1) throw new Error(`Loop pixel check failed: ${JSON.stringify(pixels)}`);
  await evaluate(`document.querySelector('#export').click()`);
  let status;
  for (let attempt = 0; attempt < 600; attempt++) {
    status = await evaluate(`({ busy: document.querySelector('#export').disabled, text: document.querySelector('#status').value, download: !document.querySelector('#download').hidden })`);
    if (!status.busy) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (status.busy || !status.download || !status.text.startsWith('Verified browser metadata:')) throw new Error(JSON.stringify(status));
  const base64 = await evaluate(`(async () => {
    const blob = await (await fetch(document.querySelector('#download').href)).blob();
    return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
  })()`);
  const output = process.env.PIXEL_SAMPLE_MP4 ?? '/tmp/pixel-animated-calibration.mp4';
  await writeFile(output, Buffer.from(base64, 'base64'));
  const playback = await evaluate(`(async () => {
    const video = document.querySelector('#player'); video.muted = true;
    video.currentTime = 9.8;
    await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; });
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 800));
    const result = { time: video.currentTime, paused: video.paused, width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    video.pause(); return result;
  })()`);
  if (playback.paused || playback.time >= 2) throw new Error(`Browser did not loop: ${JSON.stringify(playback)}`);
  await evaluate(`document.querySelector('#export').click(); document.querySelector('#cancel').click();`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const cancellation = await evaluate(`document.querySelector('#status').value`);
  if (!cancellation.startsWith('AbortError')) throw new Error(`Cancel failed: ${cancellation}`);
  console.log(JSON.stringify({ output, pixels, playback, cancellation, status: status.text }, null, 2));
} finally { ws.close(); }
