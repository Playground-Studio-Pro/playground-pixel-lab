/** Node-only process transport. Import only in Desktop's native process, never in the web bundle. */
import { spawn } from 'node:child_process';
import { abortable, checkAbort } from './contract';
export interface ProcessResult { stdout: string; stderr: string; code: number }
export interface ProcessOptions {
  signal?: AbortSignal;
  input?: AsyncIterable<Uint8Array>;
  onStdout?: (text: string) => void;
  timeoutMs?: number;
}
export type ProcessRunner = (executable: string, args: readonly string[], options?: ProcessOptions) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = async (executable, args, options = {}) => {
  checkAbort(options.signal);
  const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  let failure: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
  };
  const closed = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? -1));
  });
  // Attach now: a missing executable can reject before an async producer finishes.
  void closed.catch(() => {});
  const processEnded = new AbortController();
  void closed.then(() => processEnded.abort(), () => processEnded.abort());
  const ioSignal = options.signal ? AbortSignal.any([options.signal, processEnded.signal]) : processEnded.signal;
  child.stdin.on('error', () => {});
  child.stdout.on('data', (buffer: Buffer) => {
    const text = buffer.toString('utf8');
    stdout += text;
    if (stdout.length > 1024 * 1024) { failure = new Error('Native process exceeded its stdout limit.'); stop(); return; }
    try { options.onStdout?.(text); } catch (error) { failure = error as Error; stop(); }
  });
  child.stderr.on('data', (buffer: Buffer) => { stderr = (stderr + buffer.toString('utf8')).slice(-32768); });
  options.signal?.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(() => { failure = new Error('Native process timed out.'); stop(); }, options.timeoutMs ?? 30 * 60 * 1000);
  const iterator = options.input?.[Symbol.asyncIterator]();
  try {
    if (iterator) {
      while (true) {
        checkAbort(options.signal);
        const item = await abortable(iterator.next(), ioSignal);
        if (item.done) break;
        await abortable(new Promise<void>((resolve, reject) => {
          // Callback resolves only once Node has consumed this chunk; no unbounded writes.
          child.stdin.write(item.value, error => error ? reject(error) : resolve());
        }), ioSignal);
      }
    }
    child.stdin.end();
    const code = await closed;
    checkAbort(options.signal);
    if (failure) throw failure;
    return { stdout, stderr, code };
  } catch (error) {
    stop();
    await closed.catch(() => {});
    checkAbort(options.signal);
    if (failure) throw failure;
    if (processEnded.signal.aborted && error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Encoder closed before input completed: ${stderr}`);
    }
    // Preserve FFmpeg's diagnostic for EPIPE/process failures (including ENOSPC).
    if (stderr && error instanceof Error) error.message += `\n${stderr}`;
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', stop);
    clearTimeout(timeout); clearTimeout(killTimer);
    if (iterator?.return) void iterator.return().catch(() => {});
  }
};
