// Browser measurement helpers for docs/development/PERFORMANCE.md.
// Load from the DevTools console on a production build: await import("/perf/browser-harness.js")
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stage = () => document.querySelector(".konvajs-content");
const button = (label) => [...document.querySelectorAll("button,[role=menuitem]")].find((b) => b.textContent.trim().startsWith(label));

/** Runs step(frameIndex) on each animation frame and summarizes frame intervals in ms. */
function frames(count, step = () => {}) {
  return new Promise((resolve) => {
    const times = [];
    let last = performance.now();
    let index = 0;
    const tick = (now) => {
      times.push(now - last);
      last = now;
      step(index);
      if (++index < count) return requestAnimationFrame(tick);
      times.shift();
      times.sort((a, b) => a - b);
      resolve({
        p50: +times[Math.floor(times.length * 0.5)].toFixed(1),
        p95: +times[Math.floor(times.length * 0.95)].toFixed(1),
        max: +times[times.length - 1].toFixed(1),
        over20ms: times.filter((t) => t > 20).length,
      });
    };
    requestAnimationFrame(tick);
  });
}

const mouse = (type, x, y, target) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window }));

/** Imports a fixture from /perf through the app's own file input. */
async function importFixture(name) {
  const text = await (await fetch(`/perf/${name}.json`)).text();
  const input = document.querySelector("input[type=file]");
  const transfer = new DataTransfer();
  transfer.items.add(new File([text], `${name}.json`, { type: "application/json" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(1200);
  return document.querySelector("[data-testid=master-readout]")?.textContent;
}

function loadMetrics() {
  const nav = performance.getEntriesByType("navigation")[0];
  const paint = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, Math.round(e.startTime)]));
  return { dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), ...paint };
}

/** Oscillates pinch zoom around the canvas centre. Run after importFixture. */
function measureZoom(count = 180) {
  const box = stage().getBoundingClientRect();
  const host = stage().parentElement.parentElement;
  return frames(count, (i) =>
    host.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, ctrlKey: true, deltaY: i % 60 < 30 ? -8 : 8 })),
  );
}

/** Drags whatever is under the canvas centre in a circle. This moves content: re-import before measuring exports. */
async function measureDrag(count = 180) {
  const box = stage().getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  mouse("mousedown", x, y, stage());
  await sleep(50);
  const result = await frames(count, (i) => mouse("mousemove", x + 40 * Math.sin(i / 15) + 6, y + 40 * Math.cos(i / 15), window));
  mouse("mouseup", x, y, window);
  return result;
}

/** Captures exports in memory instead of downloading them, and times PNG, SVG and the Resolume package. */
async function measureExports() {
  const captured = [];
  if (!window.__pplHooked) {
    window.__pplHooked = true;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => ((window.__pplLast = blob), create(blob));
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return click.call(this);
      window.__pplCapture?.({ name: this.download, size: window.__pplLast.size, at: performance.now() });
    };
  }
  window.__pplCapture = (entry) => captured.push(entry);
  const until = async (n) => {
    const start = performance.now();
    while (captured.length < n && performance.now() - start < 180000) await sleep(10);
    if (captured.length < n) throw new Error("Export did not finish. Check for validation errors.");
  };
  const out = {};
  button("Preview").click();
  await sleep(1500);
  let start = performance.now();
  button("Export PNG").click();
  await until(1);
  out.pngMs = Math.round(captured[0].at - start);
  await sleep(300);
  start = performance.now();
  button("Export SVG").click();
  await until(2);
  out.svgMs = Math.round(captured[1].at - start);
  document.querySelector("[data-slot=dialog-close]")?.click();
  await sleep(500);
  const trigger = button("Export");
  const rect = trigger.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, clientX: rect.left + 5, clientY: rect.top + 5, button: 0, pointerType: "mouse", pointerId: 1 };
  trigger.dispatchEvent(new PointerEvent("pointerdown", init));
  trigger.dispatchEvent(new MouseEvent("mousedown", init));
  trigger.dispatchEvent(new PointerEvent("pointerup", init));
  trigger.dispatchEvent(new MouseEvent("mouseup", init));
  trigger.click();
  await sleep(500);
  start = performance.now();
  button("Resolume package").click();
  await until(3);
  out.packageMs = Math.round(captured[2].at - start);
  out.packageMB = +(captured[2].size / 1048576).toFixed(1);
  return out;
}

window.ppl = { frames, importFixture, loadMetrics, measureZoom, measureDrag, measureExports };
