"use client";

import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { deleteSelection, duplicateSelection, nudgeSelection } from "@/state/actions";
import { historyShortcut } from "@/state/shortcuts";
import { useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { Dialogs } from "./dialogs";
import { Explorer } from "./explorer";
import { Inspector } from "./inspector";
import { StartScreen } from "./start-screen";
import { TopBar } from "./top-bar";
import { CanvasArea } from "./canvas-area";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const app = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void app.save();
        return;
      }
      // Typing in a field keeps the browser's own text undo.
      if (!app.project || isTyping(e.target) || useUi.getState().dialog || useUi.getState().confirm) return;
      const step = historyShortcut(e);
      if (step) {
        e.preventDefault();
        if (step === "undo") app.undo();
        else app.redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape") {
        app.select({ kind: "none" });
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        nudgeSelection(dx, dy);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  const status = useApp((s) => s.status);
  const startupError = useApp((s) => s.startupError);
  const hasProject = useApp((s) => s.project !== null);
  const init = useApp((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const { saveStatus, save } = useApp.getState();
      if (saveStatus !== "saved") {
        void save();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  useShortcuts();

  if (status === "loading") return null;
  if (status === "failed") {
    return (
      <main className="flex h-full items-center justify-center p-6">
        <div className="max-w-md">
          <h1 className="mb-2 text-base font-semibold">Local storage isn’t available</h1>
          <p className="mb-2 text-muted-foreground">Pixel Lab saves projects in this browser’s storage and couldn’t open it. Leave private browsing or allow site data, then reload.</p>
          <p className="text-xs text-muted-foreground">{startupError}</p>
        </div>
      </main>
    );
  }

  return (
    <TooltipProvider delay={400}>
      {hasProject ? (
        <div className="grid h-full grid-cols-[256px_minmax(0,1fr)_288px] grid-rows-[auto_minmax(0,1fr)]">
          <TopBar />
          <Explorer />
          <CanvasArea />
          <Inspector />
        </div>
      ) : (
        <StartScreen />
      )}
      <Dialogs />
      <Toaster position="bottom-center" theme="dark" />
    </TooltipProvider>
  );
}
