/**
 * A ZIP with nothing compressed (video doesn't compress again), built from Blobs. Contents are only read in chunks,
 * to check them, and are never copied into memory whole: the result is a Blob that refers to them.
 * No ZIP64, so 4 GB in all: an archive that needs it is refused, never truncated.
 */

export const MAX_ZIP_BYTES = 0xffffffff;
const MAX_ENTRIES = 0xffff;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;

export class ZipTooLargeError extends Error {
  constructor() {
    super("These files pass 4 GB together, the limit of one ZIP. Nothing was saved. Choose a shorter duration or a lower frame rate, or export the screens one at a time.");
    this.name = "ZipTooLargeError";
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 over several pieces: pass the previous result to continue. */
export function crc32(data: Uint8Array, previous = 0): number {
  let c = ~previous;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

async function checksum(blob: Blob, signal?: AbortSignal): Promise<number> {
  const reader = blob.stream().getReader();
  let crc = 0;
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      crc = crc32(value, crc);
      size += value.length;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  if (size !== blob.size) throw new Error(`Only ${size} of ${blob.size} bytes of a finished file could be read back.`);
  return crc;
}

interface Entry {
  readonly name: Uint8Array;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
}

/** Fields local and central headers share, from "version needed" on. */
function common(view: DataView, at: number, e: Entry, time: number, date: number) {
  view.setUint16(at, 20, true);
  view.setUint16(at + 2, 0x0800, true); // UTF-8 names
  view.setUint16(at + 4, 0, true); // stored
  view.setUint16(at + 6, time, true);
  view.setUint16(at + 8, date, true);
  view.setUint32(at + 10, e.crc, true);
  view.setUint32(at + 14, e.size, true);
  view.setUint32(at + 18, e.size, true);
  view.setUint16(at + 22, e.name.length, true);
}

export class StoredZip {
  private readonly parts: BlobPart[] = [];
  private readonly entries: Entry[] = [];
  private readonly names = new Set<string>();
  private offset = 0;
  private directory = 0;
  private finished = false;
  private readonly time: number;
  private readonly date: number;

  constructor(modified: Date) {
    this.time = (modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1);
    this.date = (Math.min(127, Math.max(0, modified.getFullYear() - 1980)) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate();
  }

  async add(name: string, blob: Blob, signal?: AbortSignal): Promise<void> {
    if (this.finished) throw new Error("This ZIP is already finished.");
    if (this.names.has(name)) throw new Error(`Two files are called "${name}".`);
    const bytes = new TextEncoder().encode(name);
    const directory = this.directory + CENTRAL_HEADER + bytes.length;
    const end = this.offset + LOCAL_HEADER + bytes.length + blob.size;
    if (this.entries.length >= MAX_ENTRIES || end + directory + END_RECORD > MAX_ZIP_BYTES) throw new ZipTooLargeError();
    const entry: Entry = { name: bytes, crc: await checksum(blob, signal), size: blob.size, offset: this.offset };
    const header = new Uint8Array(LOCAL_HEADER + bytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    common(view, 4, entry, this.time, this.date);
    header.set(bytes, LOCAL_HEADER);
    this.parts.push(header, blob);
    this.entries.push(entry);
    this.names.add(name);
    this.offset = end;
    this.directory = directory;
  }

  finish(): Blob {
    this.finished = true;
    const tail = new Uint8Array(this.directory + END_RECORD);
    const view = new DataView(tail.buffer);
    let at = 0;
    for (const e of this.entries) {
      view.setUint32(at, 0x02014b50, true);
      view.setUint16(at + 4, 20, true);
      common(view, at + 6, e, this.time, this.date);
      view.setUint32(at + 42, e.offset, true);
      tail.set(e.name, at + CENTRAL_HEADER);
      at += CENTRAL_HEADER + e.name.length;
    }
    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 8, this.entries.length, true);
    view.setUint16(at + 10, this.entries.length, true);
    view.setUint32(at + 12, this.directory, true);
    view.setUint32(at + 16, this.offset, true);
    return new Blob([...this.parts, tail], { type: "application/zip" });
  }
}
