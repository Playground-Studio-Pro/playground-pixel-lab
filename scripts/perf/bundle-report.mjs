#!/usr/bin/env node
// Reports production JavaScript sizes after `npm run build`. Pass --check to fail on a budget breach.
// Budgets are explained in docs/development/PERFORMANCE.md.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = { initial: 190, full: 460, largestLazy: 280 };
const dir = ".next/static/chunks";
const html = readFileSync(".next/server/app/index.html", "utf8");
const initialNames = new Set([...html.matchAll(/\/_next\/static\/chunks\/([^"?]+\.js)/g)].map((m) => m[1]));

const walk = (path) => readdirSync(path).flatMap((name) => {
  const full = join(path, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

const chunks = walk(dir)
  .filter((file) => file.endsWith(".js"))
  .map((file) => {
    const content = readFileSync(file);
    const name = file.slice(dir.length + 1);
    return { name, raw: content.length, gzip: gzipSync(content).length, initial: initialNames.has(name) };
  })
  .sort((a, b) => b.gzip - a.gzip);

const sum = (list) => list.reduce((total, c) => total + c.gzip, 0);
const initial = chunks.filter((c) => c.initial);
const lazy = chunks.filter((c) => !c.initial);

for (const c of chunks) {
  console.log(`${c.initial ? "initial" : "lazy   "} ${String(kb(c.raw)).padStart(8)} KB ${String(kb(c.gzip)).padStart(8)} KB gzip  ${c.name}`);
}
const totals = { initial: kb(sum(initial)), largestLazy: kb(lazy[0]?.gzip ?? 0), full: kb(sum(initial) + (lazy[0]?.gzip ?? 0)) };
console.log(`\nInitial JS:              ${totals.initial} KB gzip (budget ${BUDGET_KB.initial})`);
console.log(`Largest lazy chunk:      ${totals.largestLazy} KB gzip (budget ${BUDGET_KB.largestLazy})`);
console.log(`Initial + largest lazy:  ${totals.full} KB gzip (budget ${BUDGET_KB.full})`);

if (process.argv.includes("--check")) {
  const breaches = Object.keys(BUDGET_KB).filter((key) => totals[key] > BUDGET_KB[key]);
  if (breaches.length > 0) {
    console.error(`Over budget: ${breaches.join(", ")}`);
    process.exit(1);
  }
}
