import { cp, mkdir, readFile, writeFile, access, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const stageRoot = path.join(desktopRoot, '.staging', 'app');
export async function stage() {
  const candidates = process.env.PIXEL_LAB_WEB_ROOT ? [path.resolve(process.env.PIXEL_LAB_WEB_ROOT)] : [path.resolve(desktopRoot, '../app'), path.resolve(desktopRoot, '..')];
  let source;
  for (const candidate of candidates) { try { const pkg = JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8')); if (pkg.name === 'playground-pixel-lab') { source = candidate; break; } } catch {} }
  if (!source || source.startsWith(path.join(desktopRoot, '.staging'))) throw new Error('Set PIXEL_LAB_WEB_ROOT to the existing Pixel Lab app');
  await access(path.join(source, 'node_modules/next/dist/bin/next'));
  await mkdir(stageRoot, { recursive: true });
  // Only owned staging paths are replaced. Never write to source app or its .next.
  for (const name of ['src', 'public', 'tests', 'examples', 'scripts']) {
    await rm(path.join(stageRoot, name), { recursive: true, force: true });
    try { await cp(path.join(source, name), path.join(stageRoot, name), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'postcss.config.mjs', 'eslint.config.mjs', 'vitest.config.ts', 'vitest.config.mts', 'AGENTS.md']) {
    try { await cp(path.join(source, name), path.join(stageRoot, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await cp(path.join(source, 'next.config.ts'), path.join(stageRoot, 'web.next.config.ts'));
  await writeFile(path.join(stageRoot, 'next.config.ts'), `import original from './web.next.config';\nimport path from 'node:path';\nconst config = { ...original, turbopack: { ...original.turbopack, root: path.resolve(__dirname, '../../..') }, ...(process.env.PIXEL_LAB_STATIC === '1' ? { output: 'export', cacheComponents: false, partialPrefetching: false, images: { unoptimized: true } } : {}) };\nexport default config;\n`);
  const modules = path.join(stageRoot, 'node_modules');
  await rm(modules, { recursive: true, force: true });
  await symlink(path.join(source, 'node_modules'), modules, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`Staged ${source} into ${stageRoot}`);
  return stageRoot;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await stage();
