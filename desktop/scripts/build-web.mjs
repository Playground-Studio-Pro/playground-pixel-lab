import { spawn } from 'node:child_process';
import { cp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { stage, desktopRoot } from './stage.mjs';
const root = await stage();
await rm(path.join(root, '.next'), { recursive: true, force: true });
await rm(path.join(root, 'out'), { recursive: true, force: true });
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, PIXEL_LAB_STATIC: '1', NEXT_TELEMETRY_DISABLED: '1' } });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
if (code !== 0) process.exit(code || 1);
await access(path.join(root, 'out/index.html'));
const destination = path.join(desktopRoot, 'web');
await rm(destination, { recursive: true, force: true });
await cp(path.join(root, 'out'), destination, { recursive: true });
// The output window's page is src/app/output/page.tsx (Output Engineering, O4), exported as output.html.
// Until it exists, ship Desktop's black stub so the output window has its allowlisted page (Phase C D4).
try { await access(path.join(destination, 'output.html')); }
catch {
  await cp(path.join(desktopRoot, 'resources', 'output-stub.html'), path.join(destination, 'output.html'));
  console.log('Output page not in the export yet (O4): using desktop/resources/output-stub.html as web/output.html');
}
console.log(`Desktop web assets: ${destination}`);
