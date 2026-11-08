import type { OpContext } from "@/engines/project-ops";

/** Fixed ids and time, so an example always builds the same project. Importing gives it fresh ids. */
export function exampleContext(prefix: string): OpContext {
  let n = 0;
  return { newId: () => `${prefix}-${++n}`, now: () => "2026-11-07T00:00:00.000Z" };
}
