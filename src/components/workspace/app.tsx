"use client";

import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/state/store";
import { useUi } from "@/state/ui-store";
import { Dialogs } from "./dialogs";
import { Explorer } from "./explorer";
import { Inspector } from "./inspector";
import { StartScreen } from "./start-screen";
import { TopBar } from "./top-bar";
import dynamic from "next/dynamic";
import { CanvasArea } from "./canvas-area";
import { StudioBar } from "./studio-bar";
import { useFastMapOpen } from "@/components/shell/fast-map/open-store";
import { isTypingTarget } from "@/components/shell/fast-map/keys";
import { MAPPING_SCOPE, runWorkspaceAction, workspaceAction } from "./workspace-keys";

// Fast map loads on first use, like the studios.
const FastMap = dynamic(() => import("@/components/shell/fast-map/fast-map"), {
  ssr: false,
  loading: () => <main className="h-full bg-stage" aria-busy="true" />,
});

// The other studios and their modules load on first use, so the editor doesn't pay for them.
const StudioHost = dynamic(() => import("./studio-host"), {
  ssr: false,
  loading: () => <main className="col-span-2 min-h-0 bg-stage" aria-busy="true" />,
});

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as Element | null;
      const ui = useUi.getState();
      const action = workspaceAction(e, {
        studio: ui.studio,
        hasProject: !!useApp.getState().project,
        fastMapOpen: useFastMapOpen.getState().open,
        // Typing in a field keeps the browser's own text undo.
        typing: isTypingTarget(target),
        dialogOpen: !!ui.dialog || !!ui.confirm || !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'),
        inMappingScope: !target || target === document.body || target === document.documentElement || !!target.closest(MAPPING_SCOPE),
      });
      if (!action) return;
      e.preventDefault();
      runWorkspaceAction(action);
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
  const studio = useUi((s) => s.studio);
  const fastMap = useFastMapOpen((s) => s.open);

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
      {fastMap ? (
        <FastMap />
      ) : hasProject ? (
        <div className="grid h-full grid-cols-[256px_minmax(0,1fr)_288px] grid-rows-[auto_auto_minmax(0,1fr)]">
          <TopBar />
          <StudioBar />
          <Explorer />
          {studio === "mapping" ? (
            <>
              <CanvasArea />
              <Inspector />
            </>
          ) : (
            <StudioHost studio={studio} />
          )}
        </div>
      ) : (
        <StartScreen />
      )}
      <Dialogs />
      <Toaster position="bottom-center" theme="dark" />
    </TooltipProvider>
  );
}
