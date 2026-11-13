import { spawn } from 'node:child_process';
import path from 'node:path';
import { stage, desktopRoot } from './stage.mjs';
import electron from 'electron';
const root = await stage();
const port = process.env.PIXEL_LAB_DESKTOP_PORT || '3210';
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw new Error('Invalid desktop development port');
const url = `http://127.0.0.1:${port}/`;
// Refuse to attach privileged preload to an existing server at this port.
try { await fetch(url, { signal: AbortSignal.timeout(500) }); throw new Error('Desktop port is already occupied'); }
catch (error) { if (error.message === 'Desktop port is already occupied') throw error; }
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', port], { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
let shell;
let stopped = false;
function stop(code = 0) { if (stopped) return; stopped = true; shell?.kill(); server.kill(); process.exitCode = code; }
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.on('error', error => { console.error(error); stop(1); });
server.on('exit', code => { if (!stopped) stop(code || 1); });
try {
  let ready = false;
  const deadline = Date.now() + 120000;
  while (!stopped && Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Desktop Next server did not become ready within 120 seconds');
  const env = { ...process.env, PIXEL_LAB_DEV_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  shell = spawn(electron, [desktopRoot, ...process.argv.slice(2)], { cwd: desktopRoot, stdio: 'inherit', env });
  shell.on('error', error => { console.error(error); stop(1); });
  shell.on('exit', code => stop(code || 0));
} catch (error) { console.error(error); stop(1); }
