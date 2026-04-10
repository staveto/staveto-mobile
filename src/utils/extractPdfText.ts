import { inflate, inflateRaw } from "pako";
import { getStorage } from "../firebase";

/**
 * Best-effort text from FlateDecode / literal (Tj, TJ) / hex strings.
 * Does NOT cover: some LZW streams, JBIG2, full CMap/Identity-H for all fonts,
 * object streams without `stream` markers, or PDFs that only expose text via XFA.
 * Empty result often means "parser gap", not "PDF has no text".
 */

/** ISO-8859-1 (byte → char). Hermes often has no TextDecoder("latin1"). */
function bytesToLatin1String(bytes: Uint8Array, start = 0, end?: number): string {
  const e = Math.min(end ?? bytes.length, bytes.length);
  let s = "";
  for (let i = start; i < e; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

async function readPdfBytesViaFetch(uri: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(uri);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8.length < 8) return null;
    const head = bytesToLatin1String(u8, 0, 5);
    return head.startsWith("%PDF") ? u8 : null;
  } catch {
    return null;
  }
}

async function readPdfBytesViaExpoFileSystem(uri: string): Promise<Uint8Array | null> {
  try {
    // Expo SDK 54+: readAsStringAsync lives in expo-file-system/legacy (main export throws).
    const FileSystem = require("expo-file-system/legacy") as typeof import("expo-file-system/legacy");
    if (typeof FileSystem.readAsStringAsync !== "function") return null;
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!b64 || b64.length < 32) return null;
    if (typeof atob !== "function") return null;
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    if (out.length < 8) return null;
    const head = bytesToLatin1String(out, 0, 5);
    return head.startsWith("%PDF") ? out : null;
  } catch (e) {
    console.warn("[extractPdfText] expo-file-system read:", e);
    return null;
  }
}

/** Read PDF bytes: Android content:// often fails with fetch — use expo-file-system. */
export async function readPdfBytesFromUri(uri: string): Promise<Uint8Array | null> {
  if (uri.includes("content://")) {
    const fsFirst = await readPdfBytesViaExpoFileSystem(uri);
    if (fsFirst) return fsFirst;
    return await readPdfBytesViaFetch(uri);
  }
  const fetchFirst = await readPdfBytesViaFetch(uri);
  if (fetchFirst) return fetchFirst;
  return await readPdfBytesViaExpoFileSystem(uri);
}

/** Decode contents of a PDF string literal inside balanced parentheses (after leading "("). */
function decodePdfParenString(inner: string): string {
  let out = "";
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c === "\\" && i + 1 < inner.length) {
      i++;
      const n = inner[i];
      if (n === "n") {
        out += "\n";
      } else if (n === "r") {
        out += "\r";
      } else if (n === "t") {
        out += "\t";
      } else if (n === "b") {
        out += "\b";
      } else if (n === "f") {
        out += "\f";
      } else if (/\d/.test(n)) {
        let oct = n;
        let k = i + 1;
        while (oct.length < 3 && k < inner.length && /\d/.test(inner[k])) {
          oct += inner[k];
          k++;
        }
        const code = parseInt(oct, 8);
        if (!Number.isNaN(code)) out += String.fromCharCode(code);
        i = k - 1;
      } else {
        out += n;
      }
    } else {
      out += c;
    }
    i++;
  }
  return out;
}

function decodeHexPdfString(hexRaw: string): string {
  const clean = hexRaw.replace(/\s/g, "");
  if (clean.length < 4 || clean.length % 2 !== 0) return "";
  const bytes = new Uint8Array(clean.length / 2);
  for (let j = 0; j < clean.length; j += 2) {
    bytes[j / 2] = parseInt(clean.slice(j, j + 2), 16);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return new TextDecoder("utf-16be").decode(bytes.slice(2));
    } catch {
      return "";
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

/** Pull human-readable fragments from decoded PDF content stream (operators Tj, ', ", TJ). */
function extractTextFromContentStream(dec: string): string {
  const pieces: string[] = [];

  const parenTj = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")/g;
  let m: RegExpExecArray | null;
  while ((m = parenTj.exec(dec)) !== null) {
    const s = decodePdfParenString(m[1]).trim();
    if (s.length >= 1) pieces.push(s);
  }

  const hexTj = /<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")/g;
  while ((m = hexTj.exec(dec)) !== null) {
    const s = decodeHexPdfString(m[1]).trim();
    if (s.length >= 1) pieces.push(s);
  }

  const tjBlock = /\[[^\]]{0,8000}\]\s*TJ/g;
  while ((m = tjBlock.exec(dec)) !== null) {
    const inner = m[0];
    const sub = /\(((?:\\.|[^\\()])*)\)/g;
    let sm: RegExpExecArray | null;
    while ((sm = sub.exec(inner)) !== null) {
      const s = decodePdfParenString(sm[1]).trim();
      if (s.length >= 1) pieces.push(s);
    }
    const hx = /<([0-9A-Fa-f\s]+)>/g;
    while ((sm = hx.exec(inner)) !== null) {
      const s = decodeHexPdfString(sm[1]).trim();
      if (s.length >= 1) pieces.push(s);
    }
  }

  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

function paeth(left: number, up: number, ul: number): number {
  const p = left + up - ul;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - ul);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return ul;
}

/** Undo PNG row filters (PDF Predictor 10–15) after zlib; bpp = bytes per pixel row. */
function unfilterPngRows(data: Uint8Array, columnBytes: number, bpp: number): Uint8Array {
  const rowSize = columnBytes + 1;
  if (rowSize < 2 || columnBytes < 1 || bpp < 1) return data;
  const numRows = Math.floor(data.length / rowSize);
  if (numRows < 1) return data;
  const out = new Uint8Array(columnBytes * numRows);
  const prev = new Uint8Array(columnBytes);
  for (let y = 0; y < numRows; y++) {
    const rowStart = y * rowSize;
    const filterType = data[rowStart];
    const o = out.subarray(y * columnBytes, (y + 1) * columnBytes);
    o.set(data.subarray(rowStart + 1, rowStart + 1 + columnBytes));
    if (filterType === 1) {
      for (let i = bpp; i < columnBytes; i++) o[i] = (o[i] + o[i - bpp]) & 0xff;
    } else if (filterType === 2) {
      for (let i = 0; i < columnBytes; i++) o[i] = (o[i] + prev[i]) & 0xff;
    } else if (filterType === 3) {
      for (let i = 0; i < columnBytes; i++) {
        const left = i >= bpp ? o[i - bpp] : 0;
        const up = prev[i];
        o[i] = (o[i] + ((left + up) >> 1)) & 0xff;
      }
    } else if (filterType === 4) {
      for (let i = 0; i < columnBytes; i++) {
        const left = i >= bpp ? o[i - bpp] : 0;
        const up = prev[i];
        const ul = i >= bpp ? prev[i - bpp] : 0;
        o[i] = (o[i] + paeth(left, up, ul)) & 0xff;
      }
    }
    prev.set(o);
  }
  return out;
}

function parsePredictorHint(dictHint: string): {
  predictor: number;
  columns: number;
  colors: number;
  bitsPerComponent: number;
} | null {
  const preds = [...dictHint.matchAll(/\/Predictor\s+(\d+)/g)];
  const cols = [...dictHint.matchAll(/\/Columns\s+(\d+)/g)];
  if (!preds.length || !cols.length) return null;
  const predictor = parseInt(preds[preds.length - 1][1], 10);
  const columns = parseInt(cols[cols.length - 1][1], 10);
  const colM = dictHint.match(/\/Colors\s+(\d+)/);
  const bitsM = dictHint.match(/\/BitsPerComponent\s+(\d+)/);
  const colors = colM ? parseInt(colM[1], 10) : 1;
  const bitsPerComponent = bitsM ? parseInt(bitsM[1], 10) : 8;
  if (!Number.isFinite(predictor) || !Number.isFinite(columns) || columns <= 0) return null;
  if (!Number.isFinite(colors) || !Number.isFinite(bitsPerComponent)) return null;
  return { predictor, columns, colors, bitsPerComponent };
}

/** PDF ASCII85 (optional `<~` … `~>`). */
function decodeAscii85PdfStream(data: Uint8Array): Uint8Array | null {
  let s = bytesToLatin1String(data).replace(/\s/g, "");
  if (s.length < 2) return null;
  if (s.startsWith("<~")) s = s.slice(2);
  const end = s.indexOf("~>");
  if (end >= 0) s = s.slice(0, end);
  if (s.length < 1) return null;
  const out: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "z") {
      out.push(0, 0, 0, 0);
      i++;
      continue;
    }
    let group = s.slice(i, i + 5);
    i += group.length;
    if (group.length < 5) {
      group = group.padEnd(5, "u");
    }
    let t = 0;
    for (let j = 0; j < 5; j++) t = t * 85 + (group.charCodeAt(j) - 33);
    for (let j = 3; j >= 0; j--) {
      out.push(t & 0xff);
      t >>= 8;
    }
  }
  return out.length > 0 ? new Uint8Array(out) : null;
}

/** ASCIIHex: pairs of hex digits; optional EOD `>`. */
function decodeAsciiHexStream(data: Uint8Array): Uint8Array | null {
  const s = bytesToLatin1String(data).replace(/\s/g, "");
  const end = s.indexOf(">");
  const body = (end >= 0 ? s.slice(0, end) : s).replace(/[^0-9A-Fa-f]/g, "");
  if (body.length < 4) return null;
  const even = body.length % 2 === 0 ? body : body.slice(0, -1);
  const out = new Uint8Array(even.length / 2);
  for (let j = 0; j < even.length; j += 2) {
    out[j / 2] = parseInt(even.slice(j, j + 2), 16);
  }
  return out.length > 0 ? out : null;
}

function pushUnique(bufs: Uint8Array[], seen: Set<string>, u: Uint8Array | null | undefined) {
  if (!u || u.length === 0) return;
  const key = `${u.length}:${u[0]}:${u[Math.min(u.length - 1, 64)]}`;
  if (seen.has(key)) return;
  seen.add(key);
  bufs.push(u);
}

/** Try multiple decode paths (ASCII hex/85 + zlib) — filter chains vary by producer. */
function buildStreamDecodeCandidates(raw: Uint8Array, dictHint: string): Uint8Array[] {
  const seen = new Set<string>();
  const list: Uint8Array[] = [];
  pushUnique(list, seen, raw);

  const hint = dictHint.toUpperCase();
  const wantHex = hint.includes("ASCIIHEXDECODE") || hint.includes("ASCIIHEXD");
  const wantA85 = hint.includes("ASCII85DECODE");
  const looksA85 =
    wantA85 ||
    (() => {
      const head = bytesToLatin1String(raw.slice(0, Math.min(24, raw.length))).replace(/\s/g, "");
      return head.startsWith("<~");
    })();

  let step = raw;
  if (wantHex) {
    const h = decodeAsciiHexStream(step);
    if (h) pushUnique(list, seen, h);
    step = h ?? step;
  }
  if (looksA85) {
    const a85 = decodeAscii85PdfStream(step);
    if (a85) pushUnique(list, seen, a85);
    step = a85 ?? step;
  }

  const round1 = [...list];
  for (const b of round1) {
    try {
      const z = inflate(b);
      if (z.length > 0) pushUnique(list, seen, z);
    } catch {
      /* */
    }
    try {
      const r = inflateRaw(b);
      if (r.length > 0) pushUnique(list, seen, r);
    } catch {
      /* */
    }
  }
  return list.slice(0, 16);
}

function maybeUndoPdfPngPredictor(decoded: Uint8Array, dictHint: string): Uint8Array {
  const p = parsePredictorHint(dictHint);
  if (!p || p.predictor < 10 || p.predictor > 15) return decoded;
  const bpp = Math.max(1, Math.ceil((p.colors * p.bitsPerComponent) / 8));
  const columnBytes = bpp * p.columns;
  if (columnBytes <= 0 || columnBytes > 200_000) return decoded;
  if (decoded.length < columnBytes + 1) return decoded;
  return unfilterPngRows(decoded, columnBytes, bpp);
}

type PdfStreamSlice = { raw: Uint8Array; dictHint: string };

function extractStreamsFromPdfBytes(data: Uint8Array): PdfStreamSlice[] {
  const streams: PdfStreamSlice[] = [];
  const marker = new TextEncoder().encode("stream");
  const endMarker = new TextEncoder().encode("endstream");
  let pos = 0;
  while (pos < data.length) {
    const idx = indexOfBytes(data, marker, pos);
    if (idx < 0) break;
    const dictStart = Math.max(0, idx - 900);
    const dictHint = bytesToLatin1String(data.slice(dictStart, idx));
    let start = idx + marker.length;
    if (start < data.length && data[start] === 0x0d) start++;
    if (start < data.length && data[start] === 0x0a) start++;
    const end = indexOfBytes(data, endMarker, start);
    if (end < 0) break;
    streams.push({ raw: data.slice(start, end), dictHint });
    pos = end + endMarker.length;
  }
  return streams;
}

function extractTextFromPdfBytes(data: Uint8Array): string {
  const streams = extractStreamsFromPdfBytes(data);
  const chunks: string[] = [];

  const tryExtract = (buf: Uint8Array): string => {
    const decLatin = bytesToLatin1String(buf);
    let extracted = extractTextFromContentStream(decLatin);
    if (extracted.length < 3) {
      try {
        const decUtf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
        extracted = extractTextFromContentStream(decUtf8);
      } catch {
        extracted = "";
      }
    }
    return extracted;
  };

  for (const { raw, dictHint } of streams) {
    const candidates = buildStreamDecodeCandidates(raw, dictHint);
    let best = "";
    for (const buf of candidates) {
      const withPred = maybeUndoPdfPngPredictor(buf, dictHint);
      const t1 = tryExtract(withPred);
      const t2 = tryExtract(buf);
      const t = t1.length >= t2.length ? t1 : t2;
      if (t.length > best.length) best = t;
    }
    if (best.length >= 3) chunks.push(best);
  }

  let joined = chunks.join("\n").trim();
  if (joined.length < 5) {
    const wholeLatin = bytesToLatin1String(data);
    joined = extractTextFromContentStream(wholeLatin);
  }
  if (__DEV__ && joined.length < 5) {
    const head5 = bytesToLatin1String(data, 0, Math.min(5, data.length));
    console.warn("[extractPdfText] little or no extracted text (parser may not support this PDF encoding/filters)", {
      streamMarkers: streams.length,
      pdfBytes: data.length,
      pdfHeaderOk: head5.startsWith("%PDF"),
      headHex24: bytesHeadHex(data, 24),
      hint: "File may still contain selectable text in a desktop reader; try server-side extraction or OCR.",
    });
  }
  return joined;
}

function bytesHeadHex(data: Uint8Array, n = 24): string {
  const k = Math.min(n, data.length);
  const parts: string[] = [];
  for (let i = 0; i < k; i++) parts.push(data[i].toString(16).padStart(2, "0"));
  return parts.join(" ");
}

/** Dev-only: size + PDF header + first bytes (no file path / PII). */
function devLogPdfRead(context: string, uriHint: string, data: Uint8Array | null): void {
  if (!__DEV__) return;
  if (!data) {
    console.warn(`[extractPdfText] ${context}: no bytes (read failed or not a PDF)`, { uriHint });
    return;
  }
  const head5 = bytesToLatin1String(data, 0, Math.min(5, data.length));
  console.log(`[extractPdfText] ${context}`, {
    uriHint,
    byteLength: data.length,
    headerOk: head5.startsWith("%PDF"),
    headAscii: head5,
    headHex24: bytesHeadHex(data, 24),
  });
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function uriKindHint(uri: string): string {
  if (uri.startsWith("content://")) return "content://";
  if (uri.startsWith("file://")) return "file://";
  if (uri.startsWith("ph://") || uri.startsWith("asset://")) return "ph/asset";
  return "other";
}

/**
 * Best-effort text from a local PDF URI (content:// / file://).
 */
export async function extractPdfTextFromUri(uri: string): Promise<string | null> {
  try {
    const data = await readPdfBytesFromUri(uri);
    devLogPdfRead("fromUri after read", uriKindHint(uri), data);
    if (!data) return null;
    const joined = extractTextFromPdfBytes(data);
    if (__DEV__ && joined.length > 0) {
      console.log("[extractPdfText] fromUri extracted chars:", joined.length);
    }
    return joined.length > 0 ? joined : null;
  } catch (e) {
    console.warn("[extractPdfText] failed:", e);
    return null;
  }
}

/**
 * Download PDF from Firebase Storage (same path as after upload) and extract text.
 * Fallback when content:// read fails but file is already in Storage.
 */
export async function extractPdfTextFromStorageFullPath(storageFullPath: string): Promise<string | null> {
  try {
    const storage = getStorage();
    if (!storage) return null;
    const normalized = storageFullPath.trim();
    if (!normalized || normalized.startsWith("file://") || normalized.startsWith("content://")) {
      return null;
    }
    const ref = storage.ref(normalized);
    const url = await ref.getDownloadURL();
    const res = await fetch(url);
    if (!res.ok) {
      if (__DEV__) console.warn("[extractPdfText] storage fetch not ok:", res.status);
      return null;
    }
    const buf = await res.arrayBuffer();
    const data = new Uint8Array(buf);
    devLogPdfRead("fromStorage after download", "gs/ref", data);
    if (data.length < 8) return null;
    const head = bytesToLatin1String(data, 0, 5);
    if (!head.startsWith("%PDF")) return null;
    const joined = extractTextFromPdfBytes(data);
    if (__DEV__ && joined.length > 0) {
      console.log("[extractPdfText] fromStorage extracted chars:", joined.length);
    }
    return joined.length > 0 ? joined : null;
  } catch (e) {
    console.warn("[extractPdfText] storage fullPath extract failed:", e);
    return null;
  }
}
