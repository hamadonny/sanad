/**
 * Detect a file's real type from its first bytes. Uploads are trusted only if the bytes match
 * the declared type, so a script renamed to .png or .pdf is rejected (security review, Phase 6).
 */
export type Sniffed =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'application/pdf' | 'application/zip';

export function sniff(buf: Buffer): Sniffed | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  if (
    buf.subarray(4, 8).toString('latin1') === 'ftyp' &&
    /^(heic|heix|mif1|msf1|hevc)/.test(buf.subarray(8, 12).toString('latin1'))
  )
    return 'image/heic';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)
    return 'application/zip'; // .docx
  return null;
}

/** Does the content match the declared MIME type? (.docx files are ZIP containers.) */
export function matchesDeclared(buf: Buffer, declared: string): boolean {
  const s = sniff(buf);
  if (!s) return false;
  if (declared === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return s === 'application/zip';
  if (declared === 'image/jpg') return s === 'image/jpeg';
  return s === declared;
}
