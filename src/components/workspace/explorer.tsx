"use client";

import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Id } from "@/domain/model";
import { addCanvas, addOutput } from "@/engines/project-ops";
import { cn } from "@/lib/utils";
import { tryEdit } from "@/state/actions";
import { opContext, selectedScreenIds, useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";

function Row({ active, onClick, children, indent, testId }: { active?: boolean; onClick(e: React.MouseEvent): void; children: ReactNode; indent?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-accent focus-visible:outline-2",
        active && "bg-primary/25 hover:bg-primary/30",
        indent && "pl-5",
      )}
    >
      {children}
    </button>
  );
}

function Heading({ title, addLabel, onAdd }: { title: string; addLabel: string; onAdd(): void }) {
  return (
    <div className="flex h-7 items-center justify-between pr-1 pl-2">
      <h2 className="text-xs font-semibold">{title}</h2>
      <Button variant="ghost" size="icon-xs" aria-label={addLabel} title={addLabel} onClick={onAdd}><Plus /></Button>
    </div>
  );
}

const Count = ({ children }: { children: ReactNode }) => (
  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{children}</span>
);

export function Explorer() {
  const project = useApp((s) => s.project)!;
  const mapping = useApp((s) => s.mapping)!;
  const selection = useApp((s) => s.selection);
  const issues = useApp((s) => s.issues);
  const select = useApp((s) => s.select);
  const setView = useApp((s) => s.setView);
  const openDialog = useUi((s) => s.openDialog);

  const selectedIds = new Set(selectedScreenIds(selection, project));

  const clickScreen = (id: Id, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      select(next.size ? { kind: "screens", ids: [...next] } : { kind: "none" });
    } else {
      select({ kind: "screens", ids: [id] });
    }
  };

  const screenRow = (id: Id, name: string, color: string, indent: boolean) => {
    const resolved = mapping.screens.find((s) => s.screenId === id);
    return (
      <Row key={id} active={selectedIds.has(id) && selection.kind === "screens"} indent={indent} onClick={(e) => clickScreen(id, e)}>
        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />
        <span className="min-w-0 truncate">{name}</span>
        <Count>{resolved ? `${resolved.spec.pixelWidth}×${resolved.spec.pixelHeight}` : "unmapped"}</Count>
      </Row>
    );
  };

  const ungrouped = project.physical.screens.filter((s) => s.groupId === null);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-panel" aria-label="Project explorer">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-1.5">
          <div>
            <Heading title="Screens" addLabel="Add screen" onAdd={() => openDialog("add-screen")} />
            {project.physical.groups.map((group) => (
              <div key={group.id}>
                <Row active={selection.kind === "group" && selection.id === group.id} onClick={() => select({ kind: "group", id: group.id })}>
                  <span className="min-w-0 truncate font-medium">{group.name}</span>
                </Row>
                {project.physical.screens.filter((s) => s.groupId === group.id).map((s) => screenRow(s.id, s.name, s.color, true))}
              </div>
            ))}
            {ungrouped.map((s) => screenRow(s.id, s.name, s.color, false))}
            {project.physical.screens.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No screens yet.</p>}
          </div>

          <div>
            <Heading
              title="Content canvases"
              addLabel="Add content canvas"
              onAdd={() => {
                let id: Id | null = null;
                tryEdit((p) => {
                  const result = addCanvas(p, `Canvas ${p.content.canvases.length + 1}`, opContext);
                  id = result.canvasId;
                  return result.project;
                });
                if (id) select({ kind: "canvas", id });
                setView("content");
              }}
            />
            {mapping.canvases.map((c) => (
              <Row
                key={c.canvasId}
                active={selection.kind === "canvas" && selection.id === c.canvasId}
                onClick={() => {
                  select({ kind: "canvas", id: c.canvasId });
                  setView("content");
                }}
              >
                <span className="min-w-0 truncate">{c.name}</span>
                <Count>{c.bounds ? `${c.bounds.width}×${c.bounds.height}` : "empty"}</Count>
              </Row>
            ))}
          </div>

          <div>
            <Heading
              title="Outputs"
              addLabel="Add output"
              onAdd={() => {
                let id: Id | null = null;
                tryEdit((p) => {
                  const result = addOutput(p, `Output ${p.output.outputs.length + 1}`, opContext);
                  id = result.outputId;
                  return result.project;
                });
                if (id) select({ kind: "output", id });
                setView("output");
              }}
            />
            {mapping.outputs.map((o) => (
              <Row
                key={o.outputId}
                active={selection.kind === "output" && selection.id === o.outputId}
                onClick={() => {
                  select({ kind: "output", id: o.outputId });
                  setView("output");
                }}
              >
                <span className="min-w-0 truncate">{o.name}</span>
                <Count>{o.width}×{o.height}</Count>
              </Row>
            ))}
          </div>

          <div>
            <Heading title="Cabinets" addLabel="Add cabinet" onAdd={() => openDialog("new-cabinet")} />
            {project.cabinets.map((c) => (
              <Row key={c.id} active={selection.kind === "cabinet" && selection.id === c.id} onClick={() => select({ kind: "cabinet", id: c.id })}>
                <span className="min-w-0 truncate">{c.name}</span>
                <Count>{project.physical.screens.filter((s) => s.cabinetId === c.id).length}</Count>
              </Row>
            ))}
            {project.cabinets.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Added with your first screen.</p>}
          </div>
        </div>
      </ScrollArea>

      <div className="max-h-[38%] min-h-0 border-t border-border" data-testid="checks">
        <ScrollArea className="h-full">
          <div className="p-1.5">
            <h2 className="flex h-7 items-center gap-2 px-2 text-xs font-semibold">
              Checks
              <span className={cn("font-normal", errors ? "text-destructive" : warnings ? "text-warn" : "text-muted-foreground")}>
                {errors === 0 && warnings === 0 ? "No problems" : [errors && `${errors} ${errors === 1 ? "error" : "errors"}`, warnings && `${warnings} ${warnings === 1 ? "warning" : "warnings"}`].filter(Boolean).join(", ")}
              </span>
            </h2>
            <ul className="flex flex-col gap-0.5">
              {issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <button
                    type="button"
                    disabled={issue.screenIds.length === 0}
                    onClick={() => select({ kind: "screens", ids: issue.screenIds })}
                    className="flex w-full gap-2 rounded px-2 py-1 text-left text-xs leading-snug enabled:hover:bg-accent"
                  >
                    {issue.severity === "error" && <AlertCircle className="mt-0.5 size-3 shrink-0 text-destructive" aria-label="Error" />}
                    {issue.severity === "warning" && <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warn" aria-label="Warning" />}
                    {issue.severity === "info" && <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-label="Note" />}
                    <span>{issue.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
