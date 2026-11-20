import type { DatasetState } from '../types/econometrics';

/**
 * Serializes the active dataset into a clean RFC-4180 CSV whose headers are Folio's
 * exact sanitized Stata variable names and whose missing tokens are normalized to "".
 * Preserves full stored numeric precision and leading-zero / long text identifiers.
 */
export function serializeNormalizedCsv(dataset: DatasetState): string {
  const escapeCell = (val: string): string => {
    if (val === '') return '';
    if (/[",\r\n]/.test(val)) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const headers = dataset.columns.map((c) => c.stataName);
  const lines: string[] = [headers.join(',')];

  for (const row of dataset.rows) {
    const cells = headers.map((col) => escapeCell(row[col] ?? ''));
    lines.push(cells.join(','));
  }

  return lines.join('\n') + '\n';
}

export function getFileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

export function getNormalizedCsvFileName(dataset: DatasetState): string {
  return `${getFileStem(dataset.fileName)}_normalized.csv`;
}

export function getStataDoFileName(dataset: DatasetState): string {
  return `${getFileStem(dataset.fileName)}_analysis.do`;
}

export function getStataVerifyDoFileName(dataset: DatasetState): string {
  return `${getFileStem(dataset.fileName)}_verify.do`;
}

export function getBundleZipFileName(dataset: DatasetState): string {
  return `${getFileStem(dataset.fileName)}_stata_bundle.zip`;
}

// IEEE 802.3 CRC-32 table for standard PKZIP archives
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  content: string | Uint8Array;
}

/**
 * Builds a standards-compliant uncompressed (STORE) PKZIP byte buffer in-browser
 * with zero external dependencies, supporting both UTF-8 text and binary entries (e.g., .xlsx).
 */
export function buildZipBytes(entries: ZipEntryInput[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes =
      typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const crc = computeCrc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + name)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // Compression method 0 (STORE)
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central directory file header (46 bytes + name)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 filename flag
    cv.setUint16(10, 0, true); // STORE
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal attributes
    cv.setUint32(38, 0, true); // External attributes
    cv.setUint32(42, offset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralDirSize = centralParts.reduce((acc, part) => acc + part.length, 0);
  const endRecord = new Uint8Array(22);
  const ev = new DataView(endRecord.buffer);
  ev.setUint32(0, 0x06054b50, true); // End of central dir signature
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const allParts = [...localParts, ...centralParts, endRecord];
  const totalBytes = allParts.reduce((acc, part) => acc + part.length, 0);
  const combined = new Uint8Array(new ArrayBuffer(totalBytes));
  let writeOffset = 0;
  for (const part of allParts) {
    combined.set(part, writeOffset);
    writeOffset += part.length;
  }

  return combined;
}

export function buildZipBlob(entries: ZipEntryInput[]): Blob {
  const bytes = buildZipBytes(entries);
  return new Blob([bytes], {
    type: 'application/zip',
  });
}

export interface ParsedZipEntry {
  name: string;
  size: number;
  crc32: number;
  crcValid: boolean;
  bytes: Uint8Array;
  text: string;
}

/**
 * Verifies a STORE PKZIP archive's End-of-Central-Directory, Central Directory,
 * Local File Headers, and CRC-32 checksums on every entry.
 */
export function verifyAndParseZipBytes(zipBytes: Uint8Array): ParsedZipEntry[] {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder('utf-8');

  if (zipBytes.byteLength < 22) {
    throw new Error('ZIP buffer too short for End of Central Directory record.');
  }
  const eocdOffset = zipBytes.byteLength - 22;
  if (view.getUint32(eocdOffset, true) !== 0x06054b50) {
    throw new Error('Invalid ZIP End of Central Directory signature.');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const results: ParsedZipEntry[] = [];
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header signature at entry ${i}.`);
    }
    const method = view.getUint16(cursor + 10, true);
    if (method !== 0) {
      throw new Error(`Unsupported ZIP compression method ${method} at entry ${i}.`);
    }
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compSize = view.getUint32(cursor + 20, true);
    const uncompSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const name = decoder.decode(zipBytes.subarray(cursor + 46, cursor + 46 + nameLen));
    if (compSize !== uncompSize) {
      throw new Error(`Compressed and uncompressed size mismatch for ${name}.`);
    }
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid Local File Header signature for ${name}.`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const entryBytes = zipBytes.slice(dataStart, dataStart + uncompSize);
    const actualCrc = computeCrc32(entryBytes);

    results.push({
      name,
      size: uncompSize,
      crc32: actualCrc,
      crcValid: actualCrc === expectedCrc,
      bytes: entryBytes,
      text: decoder.decode(entryBytes),
    });

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return results;
}

export function buildBundleReadme(
  dataset: DatasetState,
  doFileName: string,
  verifyDoFileName: string,
  csvFileName: string,
  startingN: number,
  afterExactDuplicatesN: number,
  previewCompleteCasesN: number,
  extraNotes: string[] = []
): string {
  const renamed = dataset.columns.filter((c) => c.wasRenamed);
  const lines = [
    'Folio Econometrics — Reproducible Stata 17+ Bundle',
    '==================================================',
    '',
    `Source Dataset:       ${dataset.fileName}${dataset.selectedSheet ? ` (Sheet: ${dataset.selectedSheet})` : ''}`,
    `Normalized CSV:       ${csvFileName}`,
    `Analysis Script:      ${doFileName}`,
    `Verification Script:  ${verifyDoFileName}`,
    '',
    'How to Run in Local Stata 17+:',
    '  1. Extract ALL files from this .zip archive into a single empty folder.',
    '  2. Launch Stata 17+ and set your working directory to that extracted folder:',
    '       cd "/path/to/extracted_folder"',
    '  3. Optional one-time package setup (only needed if not already installed):',
    '       Uncomment the `ssc install` lines in Section 0 of the .do file.',
    '  4. Run the standalone verification script first (checks import precision,',
    '     types, missingness, dates, duplicates, keys, and sample counts):',
    `       do "${verifyDoFileName}"`,
    '  5. Run the main reproducible analysis script:',
    `       do "${doFileName}"`,
    '',
    'Expected Browser-Preview Checkpoints:',
    `  - Raw imported rows:                     ${startingN.toLocaleString('en-US')}`,
    `  - Cleaned rows (post duplicate rule):    ${afterExactDuplicatesN.toLocaleString('en-US')}`,
    `  - Complete cases before estimation:      ${previewCompleteCasesN.toLocaleString('en-US')}`,
    '  - Fitted e(N):                           Printed separately by Stata after fitting',
    '                                           (reghdfe may drop singleton FE groups).',
  ];

  if (extraNotes.length > 0) {
    lines.push('', 'Additional Notes:');
    for (const note of extraNotes) {
      lines.push(`  - ${note}`);
    }
  }

  if (renamed.length > 0) {
    lines.push('', 'Normalized Column Mapping (Raw Header -> Stata Name):');
    for (const c of renamed) {
      lines.push(`  - "${c.rawName}" -> ${c.stataName}`);
    }
  }

  return lines.join('\n') + '\n';
}
