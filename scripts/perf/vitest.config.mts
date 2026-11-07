import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Separate from the unit test config: timing runs must never make CI flaky.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { environment: "node", include: ["scripts/perf/*.perf.ts"] },
});
