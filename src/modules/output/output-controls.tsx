"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Section, SelectField } from "@/components/workspace/fields";
import type { ContentFps } from "@/domain/motion";
import type { DisplayInfo, OutputControlApi, OutputSourceId, OutputStatus } from "@/domain/physical-output";
import { useApp } from "@/state/store";
import { buildOutputSession, codeOfRejection, displayLabel, openBlocker, outputView, playingFromStart, type OutputView } from "./output-control";
import { frozenSettings } from "./output-sources";

/**
 * Send to a monitor (task O12): the control window's output controls, in the Output studio. It lists the monitors,
 * opens the chosen output full screen on one of them through `window.pixelLabDesktop.output`, and shows its state.
 * The monitor that shows Pixel Lab needs an explicit tick every time. In a plain browser there is no desktop API:
 * the section says so and nothing else happens.
 */

type ControlApi = Pick<OutputControlApi, "listDisplays" | "onDisplays" | "open" | "close" | "status" | "onStatus" | "retry" | "resume">;

const desktopOutput = (): ControlApi | null => (typeof window !== "undefined" && (window as { pixelLabDesktop?: { output?: ControlApi } }).pixelLabDesktop?.output) || null;

const TONE: Record<OutputView["tone"], string> = {
  idle: "bg-muted text-muted-foreground",
  busy: "bg-primary/15 text-primary",
  ok: "bg-emerald-500/15 text-emerald-400",
  warn: "bg-amber-500/15 text-amber-400",
  error: "bg-destructive/15 text-destructive",
};

export function OutputControls({ sourceId, fps }: { sourceId: OutputSourceId | null; fps: ContentFps }) {
  const [api] = useState(desktopOutput);
  if (!api) {
    return (
      <Section title="Send to a monitor">
        <p className="text-xs text-muted-foreground" data-testid="output-controls-unavailable">
          Sending an output full screen to a monitor needs the Pixel Lab desktop app.
        </p>
      </Section>
    );
  }
  return <DesktopOutputControls api={api} sourceId={sourceId} fps={fps} />;
}

function DesktopOutputControls({ api, sourceId, fps }: { api: ControlApi; sourceId: OutputSourceId | null; fps: ContentFps }) {
  const project = useApp((s) => s.project);
  const mapping = useApp((s) => s.mapping);
  const mappingErrors = useApp((s) => s.issues.filter((i) => i.severity === "error").length);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [statuses, setStatuses] = useState<Record<string, OutputStatus>>({});
  const [outputId, setOutputId] = useState<string | null>(null);
  const [displayKey, setDisplayKey] = useState<string | null>(null);
  // Never remembered: cleared whenever the monitor changes and after every open.
  const [coverControl, setCoverControl] = useState(false);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.listDisplays().then((d) => live && setDisplays(d)).catch(() => undefined);
    api.status().then((list) => live && setStatuses(Object.fromEntries(list.map((s) => [s.outputId, s])))).catch(() => undefined);
    const offDisplays = api.onDisplays((d) => setDisplays(d));
    const offStatus = api.onStatus((s) => setStatuses((prev) => ({ ...prev, [s.outputId]: s })));
    return () => {
      live = false;
      offDisplays();
      offStatus();
    };
  }, [api]);

  const outputs = mapping?.outputs ?? [];
  const output = outputs.find((o) => o.outputId === outputId) ?? outputs[0] ?? null;
  const keyOf = (d: DisplayInfo) => `${d.key.electronId}:${d.key.label}`;
  // Default: the first monitor that doesn't show Pixel Lab. The control window's own monitor is never the default.
  const display = displays.find((d) => keyOf(d) === displayKey) ?? displays.find((d) => !d.hostsControlWindow && !d.hostsOutput) ?? null;
  const status = output ? statuses[output.outputId] ?? null : null;
  const outputLabel = output ? `OUT ${outputs.indexOf(output) + 1}` : "The output";
  // While an output is open, the monitor shown is the one it is on, whatever was chosen before.
  const onDisplay = status && status.state !== "closed" && status.display ? displays.find((d) => keyOf(d) === keyOf(status.display!)) ?? status.display : null;
  const shown = onDisplay ?? display;
  const view = outputView(status, { output: outputLabel, display: shown?.label });
  const otherOpen = Object.values(statuses).some((s) => s.outputId !== output?.outputId && s.state !== "closed");
  const blocker = openBlocker(display, { coverControlDisplay: coverControl, mappingErrors, outputExists: !!output, busyElsewhere: otherOpen });
  const displayItems = useMemo(() => displays.map((d) => ({ value: keyOf(d), label: displayLabel(d) })), [displays]);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setRequestError(null);
    try {
      await action();
    } catch (error) {
      setRequestError(codeOfRejection(error).text);
    } finally {
      setPending(false);
    }
  }

  function open() {
    if (!project || !mapping || !output || !display || !sourceId || blocker) return;
    const allowControlDisplay = display.hostsControlWindow && coverControl;
    setCoverControl(false);
    void run(async () => {
      const session = buildOutputSession({
        project,
        mapping,
        outputId: output.outputId,
        source: { id: sourceId, settings: frozenSettings(sourceId) },
        clock: playingFromStart(fps, performance.timeOrigin + performance.now()),
      });
      const next = await api.open({ outputId: output.outputId, display: display.key, ...(allowControlDisplay ? { allowControlDisplay: true } : {}), session });
      setStatuses((prev) => ({ ...prev, [next.outputId]: next }));
    });
  }

  return (
    <Section title="Send to a monitor">
      <div className="flex flex-col gap-2" data-testid="output-controls">
        {outputs.length > 1 && (
          <SelectField label="Output" value={output?.outputId ?? ""} items={outputs.map((o, i) => ({ value: o.outputId, label: `OUT ${i + 1} · ${o.name} · ${o.width} × ${o.height}` }))} onChange={setOutputId} disabled={view.state !== "closed"} />
        )}
        {outputs.length === 1 && output && <p className="text-xs text-muted-foreground">OUT 1 · {output.name} · {output.width} × {output.height}</p>}
        <SelectField
          label="Monitor"
          value={shown ? keyOf(shown) : ""}
          items={displayItems}
          onChange={(v) => {
            setDisplayKey(v);
            setCoverControl(false);
          }}
          disabled={view.state !== "closed" || displays.length === 0}
        />
        {view.state === "closed" && display?.hostsControlWindow && (
          <Label className="flex items-start gap-2 text-xs font-normal leading-snug" data-testid="cover-control-display">
            <Checkbox checked={coverControl} onCheckedChange={(v) => setCoverControl(v === true)} className="mt-0.5" />
            <span>Cover this screen: it shows Pixel Lab. The output fills it; Esc closes the output.</span>
          </Label>
        )}

        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE[view.tone]}`} data-testid="output-state">{view.badge}</span>
          {view.message && <span className="text-xs text-muted-foreground" data-testid="output-message">{view.message}</span>}
        </div>
        {view.fit && <p className="text-xs text-muted-foreground" data-testid="output-fit">{view.fit}</p>}
        {view.escHint && <p className="text-xs font-medium text-foreground" data-testid="output-esc-hint">Esc closes the output.</p>}
        {requestError && <p className="text-xs text-destructive" data-testid="output-request-error">{requestError}</p>}
        {view.state === "closed" && blocker && <p className="text-xs text-muted-foreground">{blocker}</p>}
        {!sourceId && view.state === "closed" && <p className="text-xs text-muted-foreground">This content can&apos;t be sent to a monitor.</p>}

        <div className="flex gap-2">
          {view.actions.includes("open") && (
            <Button size="sm" className="flex-1 rounded" disabled={pending || !!blocker || !sourceId} onClick={open} data-testid="output-open">
              Open on monitor
            </Button>
          )}
          {view.actions.includes("resume") && output && (
            <Button size="sm" className="flex-1 rounded" disabled={pending} onClick={() => void run(() => api.resume(output.outputId))} data-testid="output-resume">
              Resume
            </Button>
          )}
          {view.actions.includes("retry") && output && (
            <Button size="sm" className="flex-1 rounded" disabled={pending} onClick={() => void run(() => api.retry(output.outputId))} data-testid="output-retry">
              Retry
            </Button>
          )}
          {view.actions.includes("close") && output && (
            <Button size="sm" variant="outline" className="flex-1 rounded" disabled={pending} onClick={() => void run(() => api.close(output.outputId))} data-testid="output-close">
              Close
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">Plays the content above from frame 0 at {fps} fps. Edits reach the monitor when you close and open it again.</p>
      </div>
    </Section>
  );
}
