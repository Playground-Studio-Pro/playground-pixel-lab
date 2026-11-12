/** Minimal ISO BMFF muxer for AVC, one video track, constant frame rate, no B frames/audio. */
const bytes = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const u32 = (...values: number[]) => {
  const b = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(b.buffer).setUint32(i * 4, v));
  return b;
};
const u16 = (...values: number[]) => {
  const b = new Uint8Array(values.length * 2);
  values.forEach((v, i) => new DataView(b.buffer).setUint16(i * 2, v));
  return b;
};
const str = (s: string) => new TextEncoder().encode(s);
const box = (type: string, ...data: Uint8Array[]) => {
  const body = bytes(...data);
  return bytes(u32(body.length + 8), str(type), body);
};
const full = (type: string, flags: number, ...data: Uint8Array[]) => box(type, u32(flags), ...data);
const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

export interface Mp4Settings { width: number; height: number; fps: number; frames: number }

export function mp4Header(s: Mp4Settings, avcC: Uint8Array): Uint8Array {
  if (avcC.length < 7 || avcC[0] !== 1) throw new Error('Encoder did not provide an AVC configuration record.');
  const avc1 = box('avc1', new Uint8Array(6), u16(1), new Uint8Array(16),
    u16(s.width, s.height), u32(0x480000, 0x480000, 0), u16(1), new Uint8Array(32),
    u16(24, 0xffff), box('avcC', avcC));
  const stbl = box('stbl', full('stsd', 0, u32(1), avc1), full('stts', 0, u32(0)),
    full('stsc', 0, u32(0)), full('stsz', 0, u32(0, 0)), full('stco', 0, u32(0)));
  const minf = box('minf', full('vmhd', 1, u16(0, 0, 0, 0)),
    box('dinf', full('dref', 0, u32(1), full('url ', 1))), stbl);
  const mdia = box('mdia', full('mdhd', 0, u32(0, 0, s.fps, s.frames), u16(0x55c4, 0)),
    full('hdlr', 0, u32(0), str('vide'), new Uint8Array(12), str('Pixel Lab\0')), minf);
  const trak = box('trak', full('tkhd', 7, u32(0, 0, 1, 0, s.frames), new Uint8Array(8),
    u16(0, 0, 0, 0), matrix, u32(s.width * 65536, s.height * 65536)), mdia);
  const moov = box('moov', full('mvhd', 0, u32(0, 0, s.fps, s.frames, 0x10000),
    u16(0x100, 0), new Uint8Array(8), matrix, new Uint8Array(24), u32(2)), trak,
    box('mvex', full('trex', 0, u32(1, 1, 1, 0, 0))));
  return bytes(box('ftyp', str('isom'), u32(512), str('isomiso6avc1mp41')), moov);
}

export function mp4Fragment(index: number, data: Uint8Array, key: boolean): Uint8Array {
  const make = (offset: number) => box('moof', full('mfhd', 0, u32(index + 1)),
    box('traf', full('tfhd', 0x20000, u32(1)), full('tfdt', 0, u32(index)),
      full('trun', 0x701, u32(1, offset, 1, data.length, key ? 0x02000000 : 0x01010000))));
  const moof = make(0);
  return bytes(make(moof.length + 8), box('mdat', data));
}
