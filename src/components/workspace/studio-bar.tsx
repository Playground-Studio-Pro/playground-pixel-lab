"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STUDIOS } from "@/modules/catalog";
import type { StudioId } from "@/modules/contract";
import { useUi } from "@/state/ui-store";

/**
 * The studio switch: Mapping, Content, Engineering, Output. A minimal version from task L1, built from
 * existing components. Product Design owns its final form (D4) and may move it into the top bar.
 */
export function StudioBar() {
  const studio = useUi((s) => s.studio);
  const setStudio = useUi((s) => s.setStudio);
  return (
    <nav aria-label="Studios" className="col-span-3 flex h-9 items-center border-b border-border bg-panel px-2" data-testid="studio-bar">
      <Tabs value={studio} onValueChange={(value) => setStudio(value as StudioId)}>
        <TabsList className="h-7 rounded p-0.5">
          {STUDIOS.map((s) => (
            <TabsTrigger key={s.id} value={s.id} title={s.description} className="rounded-sm px-3 text-xs" data-testid={`studio-${s.id}`}>
              {s.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  );
}
