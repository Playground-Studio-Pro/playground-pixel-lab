import type { ContentFps } from "@/domain/motion";
import type { ResolvedMapping, UnresolvedScreen } from "@/engines/mapping";
import { videoTargets, type VideoTarget } from "@/engines/video-targets";
import { slugify } from "@/exports/gate";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { StoredZip, ZipTooLargeError } from "./stored-zip";
import { targetSource } from "./target-source";
import { exportMp4, h264Bitrate } from "./video-export";

/**
 * Every screen as its own MP4, in one ZIP. The files share one frame clock: frame N of each is its screen's part
 * of the same master frame, copied 1:1. Encoded one after another, so one encoder and one master canvas are alive
 * at a time. A screen H.264 can't take is named with its reason and left out; nothing is scaled or padded.
 */

export interface BatchFile {
  readonly target: VideoTarget;
  readonly filename: string;
}

export interface BatchSkip {
  readonly id: string;
  readonly name: string;
  /** Null when the mapping has no size for it. */
  readonly size: { readonly width: number; readonly height: number } | null;
  readonly reason: string;
}

export interface ScreenBatch {
  readonly zipName: string;
  readonly files: readonly BatchFile[];
  readonly skipped: readonly BatchSkip[];
  readonly fps: ContentFps;
  readonly seconds: number;
  readonly frames: number;
  /** What the encoder is asked for, at most. Real files are usually smaller. */
  readonly targetBytes: number;
}

const UNRESOLVED: Readonly<Record<UnresolvedScreen["reason"], string>> = {
  "missing-cabinet": "Its cabinet isn't in this project, so it has no size.",
  "missing-region": "It has no place in the content layout.",
  "missing-canvas": "Its canvas isn't in this project.",
  "missing-slice": "It has no place in the output layout.",
  "missing-output": "Its output isn't in this project.",
};

/** The master's and outputs' advice to export each screen doesn't help a screen. */
const screenReason = (problem: string) => problem.replace(" Export each output or screen instead.", " It is never scaled or split.");

/** File systems take 255 bytes a name, and these names have several parts. */
const part = (name: string) => slugify(name).slice(0, 60).replace(/-+$/, "");

/** One distinct slug per name. A name that is alone with its slug keeps it, whatever comes before it. */
export function distinctSlugs(names: readonly string[]): string[] {
  const slugs = names.map(part);
  const taken = new Set(slugs);
  const used = new Set<string>();
  return slugs.map((slug) => {
    let candidate = slug;
    for (let n = 2; used.has(candidate) || (candidate !== slug && taken.has(candidate)); n++) candidate = `${slug}-${n}`;
    used.add(candidate);
    return candidate;
  });
}

export function planScreenBatch(mapping: ResolvedMapping, options: { projectName: string; sourceLabel: string; fps: ContentFps; seconds: number }): ScreenBatch {
  const { projectName, sourceLabel, fps, seconds } = options;
  const screens = videoTargets(mapping).filter((t) => t.kind === "screen");
  const slugs = distinctSlugs(screens.map((t) => t.label));
  const base = `${part(projectName)}-${sourceLabel}`;
  const files: BatchFile[] = [];
  const skipped: BatchSkip[] = [];
  screens.forEach((target, i) => {
    if (target.problem) skipped.push({ id: target.id, name: target.label, size: { width: target.width, height: target.height }, reason: screenReason(target.problem) });
    else files.push({ target, filename: `${base}-${slugs[i]}-${target.width}x${target.height}-${fps}fps-${seconds}s.mp4` });
  });
  for (const u of mapping.unresolved) skipped.push({ id: `screen:${u.screenId}`, name: u.name, size: null, reason: UNRESOLVED[u.reason] });
  return {
    zipName: `${base}-screens-${fps}fps-${seconds}s.zip`,
    files,
    skipped,
    fps,
    seconds,
    frames: fps * seconds,
    targetBytes: files.reduce((sum, f) => sum + (h264Bitrate(f.target.width, f.target.height, fps) * seconds) / 8, 0),
  };
}

export interface BatchProgress {
  /** The screen being encoded, from 1. */
  readonly screen: number;
  readonly screens: number;
  readonly name: string;
  readonly done: number;
  readonly frames: number;
  readonly totalDone: number;
  readonly totalFrames: number;
}

export interface RunBatchOptions {
  readonly batch: ScreenBatch;
  /** Settings already fixed. */
  readonly source: FrameSource;
  readonly master: Omit<FrameInput, "frame" | "fps">;
  readonly modified: Date;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BatchProgress) => void;
  /** Tests replace the encoder. */
  readonly encode?: typeof exportMp4;
}

/** Resolves with the whole ZIP, or rejects. A cancelled or failed batch never yields a file. */
export async function exportScreenBatch({ batch, source, master, modified, signal, onProgress, encode = exportMp4 }: RunBatchOptions): Promise<Blob> {
  if (!batch.files.length) throw new Error("No screen can be exported as H.264 at its own size.");
  const { files, frames, fps } = batch;
  const zip = new StoredZip(modified);
  const canvas = document.createElement("canvas");
  try {
    for (const [i, { target, filename }] of files.entries()) {
      signal?.throwIfAborted();
      const report = (done: number) => onProgress?.({ screen: i + 1, screens: files.length, name: target.label, done, frames, totalDone: i * frames + done, totalFrames: files.length * frames });
      report(0);
      let blob: Blob;
      try {
        blob = await encode({
          source: targetSource(source, target, master, canvas),
          input: { screens: master.screens, context: master.context },
          width: target.width,
          height: target.height,
          fps,
          frames,
          signal,
          onProgress: report,
        });
        await zip.add(filename, blob, signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ZipTooLargeError) throw error;
        throw new Error(`${target.label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
    signal?.throwIfAborted();
    return zip.finish();
  } finally {
    canvas.width = canvas.height = 0;
  }
}
