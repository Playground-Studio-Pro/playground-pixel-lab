"use client";

import { useRef, type ReactNode } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ChevronDown,
  Grid3x3,
  Magnet,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AlignMode } from "@/engines/align";
import { hasErrors } from "@/engines/validation";
import { cn } from "@/lib/utils";
import { alignSelection, reportError } from "@/state/actions";
import { exportManifest, exportPng, exportProjectFile, exportReport, exportResolumePackage, exportSvg, type MapSource } from "@/state/export-actions";
import { selectedScreenIds, useApp, type SaveStatus } from "@/state/store";
import { useUi } from "@/state/ui-store";
import type { WorkspaceView } from "@/state/view-model";
import { ImportProjectInput } from "./start-screen";

function IconButton({ label, children, onClick, disabled, active }: { label: string; children: ReactNode; onClick(): void; disabled?: boolean; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={cn("rounded", active && "bg-accent text-signal")}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

const saveLabels: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed",
  conflict: "Reload needed",
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const undoKeys = isMac ? "⌘Z" : "Ctrl+Z";
const redoKeys = isMac ? "⇧⌘Z" : "Ctrl+Y";

const alignButtons: { mode: AlignMode; label: string; icon: ReactNode; min: number }[] = [
  { mode: "left", label: "Align left edges", icon: <AlignStartVertical />, min: 2 },
  { mode: "center-x", label: "Align horizontal centers", icon: <AlignCenterVertical />, min: 2 },
  { mode: "right", label: "Align right edges", icon: <AlignEndVertical />, min: 2 },
  { mode: "top", label: "Align top edges", icon: <AlignStartHorizontal />, min: 2 },
  { mode: "center-y", label: "Align vertical centers", icon: <AlignCenterHorizontal />, min: 2 },
  { mode: "bottom", label: "Align bottom edges", icon: <AlignEndHorizontal />, min: 2 },
  { mode: "distribute-x", label: "Distribute horizontally", icon: <AlignHorizontalDistributeCenter />, min: 3 },
  { mode: "distribute-y", label: "Distribute vertically", icon: <AlignVerticalDistributeCenter />, min: 3 },
];

export function TopBar() {
  const project = useApp((s) => s.project)!;
  const mapping = useApp((s) => s.mapping)!;
  const issues = useApp((s) => s.issues);
  const saveStatus = useApp((s) => s.saveStatus);
  const saveError = useApp((s) => s.saveError);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);
  const view = useApp((s) => s.view);
  const selection = useApp((s) => s.selection);
  const activeOutputId = useApp((s) => s.activeOutputId);
  const snapEdges = useApp((s) => s.snapEdges);
  const snapGrid = useApp((s) => s.snapGrid);
  const gridStep = useApp((s) => s.gridStep);
  const scale = useApp((s) => s.viewports[s.view]?.scale ?? 1);
  const app = useApp.getState();
  const { openDialog, askConfirm } = useUi.getState();
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedCount = selectedScreenIds(selection, project).length;
  const blocked = hasErrors(issues);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const source: MapSource = view === "output" && activeOutputId ? { kind: "output", id: activeOutputId } : { kind: "master" };
  const sourceName = source.kind === "master" ? "master canvas" : mapping.outputs.find((o) => o.outputId === source.id)?.name ?? "output";

  return (
    <header className="col-span-3 flex h-11 min-w-0 items-center gap-1.5 border-b border-border bg-panel px-3">
      <span className="mr-1 font-semibold tracking-tight whitespace-nowrap">Pixel Lab</span>
      <ImportProjectInput inputRef={fileRef} />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="max-w-36 min-w-0 rounded" />}>
          <span className="truncate">{project.meta.name}</span>
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => openDialog("new-project")}>New project</DropdownMenuItem>
          <DropdownMenuItem onClick={() => openDialog("open-project")}>Open project</DropdownMenuItem>
          <DropdownMenuItem onClick={() => app.duplicateCurrentProject().catch(reportError)}>Duplicate project</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>Import project file</DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportProjectFile()}>Export project file</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => app.closeProject().catch(reportError)}>Close project</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              askConfirm({
                title: `Delete “${project.meta.name}”?`,
                body: "This permanently removes the project from this browser. Export the project file first if you might need it.",
                action: "Delete project",
                onConfirm: () => app.deleteProject(project.id),
              })
            }
          >
            Delete project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Fixed width, so a changing status never shifts the toolbar. */}
      <button
        type="button"
        title={saveStatus === "conflict" ? "This project changed in another tab. Click to reload it." : (saveError ?? "Projects save automatically")}
        onClick={() => {
          if (saveStatus === "conflict") window.location.reload();
          else void app.save();
        }}
        className={cn(
          "w-28 shrink-0 truncate rounded px-1.5 py-0.5 text-left text-xs whitespace-nowrap hover:bg-accent",
          saveStatus === "saved" || saveStatus === "saving" || saveStatus === "unsaved" ? "text-muted-foreground" : "font-medium text-destructive",
        )}
      >
        {saveLabels[saveStatus]}
      </button>

      <div className="flex shrink-0 items-center" role="group" aria-label="History">
        <IconButton label={`Undo (${undoKeys})`} disabled={!canUndo} onClick={() => app.undo()}><Undo2 /></IconButton>
        <IconButton label={`Redo (${redoKeys})`} disabled={!canRedo} onClick={() => app.redo()}><Redo2 /></IconButton>
      </div>

      <div className="mx-auto flex min-w-0 items-center gap-2">
        <Tabs value={view} onValueChange={(value) => app.setView(value as WorkspaceView)}>
          <TabsList className="h-7 rounded p-0.5">
            <TabsTrigger value="physical" className="rounded-sm px-2.5 text-xs">Physical</TabsTrigger>
            <TabsTrigger value="content" className="rounded-sm px-2.5 text-xs">Content</TabsTrigger>
            <TabsTrigger value="output" className="rounded-sm px-2.5 text-xs">Output</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center">
          <IconButton label="Snap to edges (hold Ctrl to bypass)" active={snapEdges} onClick={() => app.setSnap({ snapEdges: !snapEdges })}><Magnet /></IconButton>
          <IconButton label={`Snap to grid: ${gridStep} ${view === "physical" ? "mm" : "px"}`} active={snapGrid} onClick={() => app.setSnap({ snapGrid: !snapGrid })}><Grid3x3 /></IconButton>
          <Input
            aria-label="Grid size"
            type="number"
            min={1}
            value={gridStep}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 1) app.setSnap({ gridStep: value });
            }}
            className="ml-1 h-6 w-11 rounded px-1.5 text-xs tabular-nums md:text-xs"
          />
        </div>

        {/* Wide windows show every align button. Narrower ones fold them into a menu. */}
        <div className="hidden items-center min-[1440px]:flex" role="group" aria-label="Align selection">
          {alignButtons.map((b) => (
            <IconButton key={b.mode} label={b.label} disabled={selectedCount < b.min} onClick={() => alignSelection(b.mode)}>{b.icon}</IconButton>
          ))}
        </div>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="sm" aria-label="Align selection" disabled={selectedCount < 2} className="gap-0.5 rounded px-1.5 min-[1440px]:hidden" />}
                />
              }
            >
              <AlignStartVertical />
              <ChevronDown />
            </TooltipTrigger>
            <TooltipContent side="bottom">Align selection</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="center" className="w-56">
            {alignButtons.map((b) => (
              <DropdownMenuItem key={b.mode} disabled={selectedCount < b.min} onClick={() => alignSelection(b.mode)}>
                {b.icon}
                {b.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center">
          <IconButton label="Zoom out" onClick={() => app.zoomBy(1 / 1.25)}><Minus /></IconButton>
          <Tooltip>
            <TooltipTrigger
              render={
                <button type="button" onClick={() => app.zoomActual()} className="w-14 rounded py-1 text-center text-xs tabular-nums hover:bg-accent">
                  {view === "physical" ? `${Math.round(1 / (scale * 1000))} mm/px` : `${(scale * 100).toFixed(scale < 0.1 ? 1 : 0)}%`}
                </button>
              }
            />
            <TooltipContent side="bottom">{view === "physical" ? "Fit to view" : "Zoom to 100%: one LED pixel per screen pixel"}</TooltipContent>
          </Tooltip>
          <IconButton label="Zoom in" onClick={() => app.zoomBy(1.25)}><Plus /></IconButton>
          <IconButton label="Fit to view" onClick={() => app.fit()}><Maximize /></IconButton>
        </div>
      </div>

      <div className="text-right text-xs leading-tight whitespace-nowrap tabular-nums" aria-live="polite" data-testid="master-readout">
        <div className="font-semibold">{mapping.master.width} × {mapping.master.height} px</div>
        <div className="text-muted-foreground">Master canvas</div>
      </div>

      <Button variant="outline" size="sm" className="rounded" onClick={() => openDialog("preview")}>Preview</Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" className="rounded" />}>
          Export
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {blocked && (
            <p className="px-2 py-1.5 text-xs text-destructive">
              Fix {errorCount} {errorCount === 1 ? "error" : "errors"} to enable mapping exports.
            </p>
          )}
          <DropdownMenuItem disabled={blocked} onClick={() => exportResolumePackage()}>Resolume package (.zip)</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={blocked} onClick={() => exportPng(source)}>PNG pixel map, {sourceName}</DropdownMenuItem>
          <DropdownMenuItem disabled={blocked} onClick={() => exportSvg(source)}>SVG pixel map, {sourceName}</DropdownMenuItem>
          <DropdownMenuItem disabled={blocked} onClick={() => exportManifest()}>Mapping manifest (.json)</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => exportReport()}>Technical report (.md)</DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportProjectFile()}>Project file (.json)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
