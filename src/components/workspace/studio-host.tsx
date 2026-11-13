"use client";

import { lazy, Suspense, useMemo, useState, type ComponentType, type LazyExoticComponent } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STUDIOS } from "@/modules/catalog";
import type { PixelLabModule, StudioId } from "@/modules/contract";
import { MODULES, modulesFor } from "@/modules/registry";

// One lazy component per module, made once when this chunk loads, so switching studios doesn't reload a panel.
const PANELS: readonly (readonly [string, LazyExoticComponent<ComponentType>])[] = MODULES.flatMap((m) => (m.panel ? [[m.id, lazy(m.panel)] as const] : []));

function Requirements({ m }: { m: PixelLabModule }) {
  const needs = [m.requires?.network && "a network connection", m.requires?.native && "a native helper", m.requires?.secrets && "a key"].filter(Boolean);
  if (needs.length === 0) return null;
  return <p className="text-xs text-warn">Needs {needs.join(", ")}. Off until set up.</p>;
}

/**
 * The Content, Engineering and Output studios: their modules' panels in the canvas and inspector
 * columns. One module fills the space; several get tabs. A studio with no panel yet shows an empty state.
 */
export default function StudioHost({ studio }: { studio: StudioId }) {
  const info = STUDIOS.find((s) => s.id === studio)!;
  const withPanels = useMemo(() => modulesFor(studio).filter((m) => m.panel), [studio]);
  const [chosen, setChosen] = useState<Partial<Record<StudioId, string>>>({});
  const active = withPanels.find((m) => m.id === chosen[studio]) ?? withPanels[0];

  if (!active) {
    return (
      <main className="col-span-2 flex min-h-0 items-center justify-center bg-stage p-6" data-testid="studio-empty">
        <div className="max-w-sm text-center">
          <h2 className="mb-1 text-sm font-semibold">{info.name} Studio</h2>
          <p className="text-xs text-muted-foreground">{info.description}. Nothing here yet: its tools are being built.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="col-span-2 flex min-h-0 min-w-0 flex-col" data-testid={`studio-host-${studio}`}>
      {withPanels.length > 1 && (
        <div className="flex h-9 shrink-0 items-center border-b border-border bg-panel px-2">
          <Tabs value={active.id} onValueChange={(id) => setChosen((c) => ({ ...c, [studio]: String(id) }))}>
            <TabsList className="h-7 rounded p-0.5">
              {withPanels.map((m) => (
                <TabsTrigger key={m.id} value={m.id} className="rounded-sm px-2.5 text-xs">{m.name}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      <Requirements m={active} />
      <Suspense fallback={<main className="min-h-0 flex-1 bg-stage" aria-busy="true" />}>
        <div className="flex min-h-0 min-w-0 flex-1">
          {PANELS.map(([id, Panel]) => (id === active.id ? <Panel key={id} /> : null))}
        </div>
      </Suspense>
    </div>
  );
}
