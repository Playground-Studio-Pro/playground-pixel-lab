"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EXAMPLES, type ExampleId } from "@/examples/catalog";
import { reportError } from "@/state/actions";
import { useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ImportProjectInput({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const importProject = useApp((s) => s.importProject);
  const openDialog = useUi((s) => s.openDialog);
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".json,application/json"
      className="hidden"
      aria-label="Import project file"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        try {
          await importProject(await file.text());
          openDialog(null);
        } catch (error) {
          reportError(error);
        }
      }}
    />
  );
}

export function StartScreen() {
  const projects = useApp((s) => s.projects);
  const openProject = useApp((s) => s.openProject);
  const openDialog = useUi((s) => s.openDialog);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <main className="flex h-full justify-center overflow-auto px-6 pt-[14vh] pb-10">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">Pixel Lab</h1>
        <p className="mt-1 mb-6 text-muted-foreground">Map LED screens to exact pixels and prepare them for Resolume.</p>
        <div className="mb-8 flex gap-2">
          <Button onClick={() => openDialog("new-project")}>New project</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>Import project file</Button>
          <ImportProjectInput inputRef={fileRef} />
        </div>
        {projects.length > 0 && (
          <>
            <h2 className="mb-2 text-xs font-semibold">Recent projects</h2>
            <ul className="divide-y divide-border border-y border-border">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-4 px-2 py-2.5 text-left hover:bg-accent focus-visible:outline-2"
                    onClick={() => openProject(p.id).catch(reportError)}
                  >
                    <span className="min-w-0 truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {p.screenCount} {p.screenCount === 1 ? "screen" : "screens"}, {formatDate(p.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <ExampleGallery />
      </div>
    </main>
  );
}

/** Opens an example as a new project. The builders load on first use, so the start screen stays light. */
function ExampleGallery() {
  const importProject = useApp((s) => s.importProject);
  const [opening, setOpening] = useState<ExampleId | null>(null);

  async function open(id: ExampleId) {
    setOpening(id);
    try {
      const [{ buildExample }, { serializeProject }] = await Promise.all([import("@/examples"), import("@/persistence/schema")]);
      // Through the same path as a file, so the example is validated and opens as a new copy.
      await importProject(serializeProject(buildExample(id)));
    } catch (error) {
      reportError(error);
    } finally {
      setOpening(null);
    }
  }

  return (
    <section className="mt-8" aria-labelledby="examples-heading">
      <h2 id="examples-heading" className="text-xs font-semibold">Examples</h2>
      <p className="mt-0.5 mb-2 text-xs text-muted-foreground">Each opens as a new project you can edit. The original stays unchanged.</p>
      <ul className="divide-y divide-border border-y border-border">
        {EXAMPLES.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              disabled={opening !== null}
              className="flex w-full items-start justify-between gap-4 px-2 py-2.5 text-left hover:bg-accent focus-visible:outline-2 disabled:cursor-wait disabled:opacity-60"
              onClick={() => open(e.id)}
            >
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{e.name}</span>
                  {e.kind === "test" && <span className="shrink-0 text-xs text-muted-foreground">Test project</span>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{e.description}</span>
              </span>
              <span className="shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular-nums">
                {opening === e.id ? (
                  "Opening…"
                ) : (
                  <>
                    {e.screens} {e.screens === 1 ? "screen" : "screens"}
                    <br />
                    {e.master} px
                  </>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
