"use client";

import { create } from "zustand";
import type { Project } from "@/domain/model";
import type { JsonValue, OutputClock, OutputControlApi, OutputId, OutputStatus } from "@/domain/physical-output";
import type { ResolvedMapping } from "@/engines/mapping";
import type { ValidationIssue } from "@/engines/validation";
import { useApp } from "@/state/store";
import { buildUpdateSession, createLiveSender, updateClock, type LiveSender, type LiveSenderState, type LiveSnapshot } from "./output-control";

/**
 * What the control window has sent to each open output, and Live adjust (D-4). Module state, so it outlives the
 * Output panel: an output keeps its clock and Live keeps sending while another studio is on screen.
 *
 * Others read Live through `useLiveOutputs`, `liveOutputState` and `onLiveSent`. Nothing here is saved.
 */

export type LiveApi = Pick<OutputControlApi, "update" | "onStatus">;

/** What was last sent to an output: by Open, Update output or Live. */
export interface SentSession {
  readonly clock: OutputClock;
  readonly revision: number;
  readonly source: { readonly id: string; readonly settings: JsonValue };
  /** Main paused and resumed it since (disconnect, held, Resume), so it owns a new clock. */
  readonly retimed: boolean;
}

/** Live adjust for one output, as other modules may show it. */
export interface LiveOutputState {
  readonly outputId: OutputId;
  /** The operator turned Live on, and it hasn't turned itself off. */
  readonly on: boolean;
  /** On, but nothing is sent: the mapping has an error. The wall keeps the last good map. */
  readonly paused: string | null;
  /** On, but the output waits for its display or is held: it sends once after Resume. */
  readonly holding: boolean;
  readonly sentRevision: number | null;
  /** Shared clock (`performance.timeOrigin + performance.now()`) of the last update Live sent. */
  readonly sentAt: number | null;
  readonly sends: number;
  readonly error: string | null;
  /** Why Live turned itself off (output failed, another project opened), or null. */
  readonly stopped: string | null;
}

/** Called each time Live sent an update that main accepted. */
export interface LiveSent {
  readonly outputId: OutputId;
  readonly revision: number;
  readonly at: number;
}

interface LiveStore {
  outputs: Readonly<Record<OutputId, LiveOutputState>>;
}

export const useLiveOutputStore = create<LiveStore>(() => ({ outputs: {} }));

/** Live's state for every output it has been used on. */
export function useLiveOutputs(): readonly LiveOutputState[] {
  return Object.values(useLiveOutputStore((s) => s.outputs));
}

export function liveOutputState(outputId: OutputId): LiveOutputState | null {
  return useLiveOutputStore.getState().outputs[outputId] ?? null;
}

const sentListeners = new Set<(event: LiveSent) => void>();

export function onLiveSent(listener: (event: LiveSent) => void): () => void {
  sentListeners.add(listener);
  return () => void sentListeners.delete(listener);
}

// ── Internals ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Payload {
  readonly project: Project;
  readonly mapping: ResolvedMapping;
}

const sent = new Map<OutputId, SentSession>();
const statuses = new Map<OutputId, OutputStatus>();
const senders = new Map<OutputId, LiveSender<Payload>>();
let attached: { api: LiveApi; stop: () => void } | null = null;

const sharedNow = () => performance.timeOrigin + performance.now();

export function liveSnapshot(project: Project, mapping: ResolvedMapping, issues: readonly ValidationIssue[]): LiveSnapshot<Payload> {
  const error = issues.find((i) => i.severity === "error");
  return { payload: { project, mapping }, blocked: error ? error.message : null };
}

function current(): LiveSnapshot<Payload> | null {
  const { project, mapping, issues } = useApp.getState();
  return project && mapping ? liveSnapshot(project, mapping, issues) : null;
}

function publish(outputId: OutputId, state: LiveSenderState) {
  useLiveOutputStore.setState((s) => ({ outputs: { ...s.outputs, [outputId]: { outputId, ...state } } }));
}

function senderFor(outputId: OutputId, api: LiveApi): LiveSender<Payload> {
  let sender = senders.get(outputId);
  if (sender) return sender;
  sender = createLiveSender<Payload>({
    async send({ project, mapping }, revision) {
      const last = sent.get(outputId);
      if (!last) throw new Error("Nothing was sent to this output yet.");
      const status = statuses.get(outputId);
      const clock = updateClock(last.clock, { retimed: last.retimed, reportedFrame: status?.render?.frame ?? null, nowMs: sharedNow() });
      const session = buildUpdateSession({ project, mapping, outputId, source: last.source, clock, previousRevision: revision - 1 });
      const next = await api.update(outputId, session);
      recordSent(outputId, { clock: session.clock, revision: session.revision, source: last.source });
      for (const listener of sentListeners) listener({ outputId, revision: session.revision, at: sharedNow() });
      return next;
    },
    baseRevision: () => Math.max(sent.get(outputId)?.revision ?? 0, statuses.get(outputId)?.sessionRevision ?? 0),
    now: sharedNow,
    setTimer(run, ms) {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    },
    onChange: (state) => publish(outputId, state),
  });
  senders.set(outputId, sender);
  return sender;
}

/** Starts listening to output statuses and project edits. Once per control window; later calls change nothing. */
export function attachLiveOutput(api: LiveApi): void {
  if (attached) return;
  const offStatus = api.onStatus(noteStatus);
  let { project, mapping } = useApp.getState();
  const offApp = useApp.subscribe((state) => {
    if (state.project?.id !== project?.id) {
      project = state.project;
      mapping = state.mapping;
      for (const sender of senders.values()) sender.stop(state.project ? "Another project opened." : "The project closed.");
      return;
    }
    project = state.project;
    // A save changes only the project's metadata; the mapping changes on every edit.
    if (state.mapping === mapping) return;
    mapping = state.mapping;
    const snapshot = current();
    if (snapshot) for (const sender of senders.values()) sender.offer(snapshot);
  });
  attached = {
    api,
    stop: () => {
      offStatus();
      offApp();
    },
  };
}

/** A status from main: keeps the clock bookkeeping and tells Live. */
export function noteStatus(status: OutputStatus): void {
  statuses.set(status.outputId, status);
  const last = sent.get(status.outputId);
  if (last && (status.state === "waiting-display" || status.state === "held")) sent.set(status.outputId, { ...last, retimed: true });
  senders.get(status.outputId)?.status(status);
  if (status.state === "closed") {
    sent.delete(status.outputId);
    statuses.delete(status.outputId);
  }
}

export function recordSent(outputId: OutputId, session: Omit<SentSession, "retimed">): void {
  sent.set(outputId, { ...session, retimed: false });
}

export function lastSent(outputId: OutputId): SentSession | null {
  return sent.get(outputId) ?? null;
}

/** Turns Live on for an open output. Needs `attachLiveOutput` first, and the output live. */
export function startLive(outputId: OutputId, status: OutputStatus): void {
  if (!attached) throw new Error("Live adjust isn't attached to the desktop output API.");
  statuses.set(outputId, status);
  const snapshot = current();
  if (!snapshot || !sent.has(outputId)) return;
  senderFor(outputId, attached.api).start(snapshot, status.state);
}

export function stopLive(outputId: OutputId, reason: string | null = null): void {
  senders.get(outputId)?.stop(reason);
}

/** Tests only: forgets everything. */
export function resetLiveOutput(): void {
  for (const sender of senders.values()) sender.stop(null);
  senders.clear();
  sent.clear();
  statuses.clear();
  sentListeners.clear();
  attached?.stop();
  attached = null;
  useLiveOutputStore.setState({ outputs: {} });
}
