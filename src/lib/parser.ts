import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type {
  ColumnProfile,
  DatasetState,
  InferredType,
  PanelBalanceStatus,
  PanelDetection,
  PanelKeyStatus,
  RawRow,
  SheetPreviewMeta,
  SourceFormat,
  StructureKind,
  TimeCadence,
  VariableRole,
} from '../types/econometrics';
import { DEMO_VARIABLE_LABELS } from './sampleData';

export const STANDARD_MISSING_TOKENS = ['', 'NA', 'N/A', 'na', 'n/a', '.', 'null', 'NULL', 'NaN', 'nan'];

const MISSING_SET = new Set(STANDARD_MISSING_TOKENS.map((t) => t.toLowerCase()));

// Reserved Stata keywords that cannot be used verbatim as variable names
const STATA_RESERVED = new Set([
  '_all', '_b', '_coef', '_cons', '_n', '_N', '_pi', '_pred', '_rc', '_skip',
  'byte', 'double', 'float', 'if', 'in', 'int', 'long', 'strL', 'using', 'with',
]);

export function isMissingCell(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  const trimmed = String(val).trim();
  if (trimmed === '') return true;
  return MISSING_SET.has(trimmed.toLowerCase());
}

/**
 * Normalizes raw CSV/XLSX headers into valid Stata variable identifiers:
 *  - Lowercase ASCII letters, digits, underscores
 *  - Must not start with a digit
 *  - Max 32 characters
 *  - Guaranteed unique via collision suffix (_2, _3, ...)
 */
export function sanitizeStataColumnNames(rawHeaders: string[]): Array<{
  rawName: string;
  stataName: string;
  wasRenamed: boolean;
}> {
  const used = new Set<string>();
  return rawHeaders.map((raw, idx) => {
    const trimmedRaw = (raw ?? '').trim() || `var_${idx + 1}`;
    let candidate = trimmedRaw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!candidate) {
      candidate = `var_${idx + 1}`;
    }
    if (/^[0-9]/.test(candidate)) {
      candidate = `v_${candidate}`;
    }
    if (STATA_RESERVED.has(candidate)) {
      candidate = `${candidate}_var`;
    }
    if (candidate.length > 32) {
      candidate = candidate.slice(0, 32).replace(/_+$/g, '');
    }

    let finalName = candidate;
    let suffix = 2;
    while (used.has(finalName)) {
      const tag = `_${suffix}`;
      finalName = `${candidate.slice(0, 32 - tag.length)}${tag}`;
      suffix++;
    }
    used.add(finalName);

    return {
      rawName: trimmedRaw,
      stataName: finalName,
      wasRenamed: finalName !== trimmedRaw,
    };
  });
}

function toHumanLabel(rawName: string, stataName: string, isDemo: boolean): string {
  if (isDemo && DEMO_VARIABLE_LABELS[stataName]) {
    return DEMO_VARIABLE_LABELS[stataName];
  }
  return rawName
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

const LEADING_ZERO_ID_REGEX = /^0[0-9]{1,}$/;
const LONG_INTEGER_ID_REGEX = /^\d{15,}$/;
const STRICT_NUMBER_REGEX = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?$/;
const SLASH_DATE_REGEX = /^\d{4}\/\d{1,2}\/\d{1,2}$/;
const US_DATE_REGEX = /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/;
const MONTHLY_REGEX = /^\d{4}[-/](?:0?[1-9]|1[0-2])$|^\d{4}[mM](?:0?[1-9]|1[0-2])$/;
const QUARTERLY_REGEX = /^\d{4}[-/\s]?[Qq][1-4]$/;
const ZERO_PAD_EXCEL_FORMAT_REGEX = /^0{2,}$/;

export function parseStrictNumeric(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed || MISSING_SET.has(trimmed.toLowerCase())) return null;
  const cleaned = trimmed.replace(/,/g, '');
  if (!STRICT_NUMBER_REGEX.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function getXlsxSsf(): typeof XLSX.SSF | undefined {
  const mod = XLSX as unknown as {
    SSF?: typeof XLSX.SSF;
    default?: { SSF?: typeof XLSX.SSF };
  };
  return mod.SSF ?? mod.default?.SSF;
}

/**
 * Converts an Excel serial date number into a canonical, unambiguous ISO date string
 * (YYYY-MM-DD), respecting the workbook's 1900 vs. 1904 date system.
 */
export function excelSerialToIsoDate(serial: number, isDate1904: boolean): string | null {
  if (!Number.isFinite(serial)) return null;
  const ssf = getXlsxSsf();
  if (ssf && typeof ssf.parse_date_code === 'function') {
    const parsed = ssf.parse_date_code(serial, { date1904: isDate1904 });
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, '0')}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
    }
  }
  // Pure-JS deterministic fallback for 1900 (with Lotus 1-2-3 leap-day adjustment) and 1904 systems
  const wholeDays = Math.floor(serial);
  let epochMs: number;
  if (isDate1904) {
    epochMs = Date.UTC(1904, 0, 1) + wholeDays * 86_400_000;
  } else {
    // Serial 1 = 1900-01-01; serial 60 is the non-existent 1900-02-29; serial >= 61 aligns with 1899-12-30 + serial
    const adjusted = wholeDays < 60 ? wholeDays - 1 : wholeDays - 2;
    epochMs = Date.UTC(1900, 0, 1) + adjusted * 86_400_000;
  }
  const dt = new Date(epochMs);
  if (Number.isNaN(dt.getTime())) return null;
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function normalizeDateString(raw: string): { canonical: string; cadenceHint: TimeCadence } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (QUARTERLY_REGEX.test(trimmed)) {
    const m = trimmed.match(/^(\d{4})[-/\s]?[Qq]([1-4])$/);
    if (m) return { canonical: `${m[1]}Q${m[2]}`, cadenceHint: 'quarterly' };
  }

  if (MONTHLY_REGEX.test(trimmed)) {
    const m = trimmed.match(/^(\d{4})[-/mM](0?[1-9]|1[0-2])$/);
    if (m) return { canonical: `${m[1]}-${pad2(Number(m[2]))}`, cadenceHint: 'monthly' };
  }

  if (ISO_DATE_REGEX.test(trimmed)) {
    return { canonical: trimmed.slice(0, 10), cadenceHint: 'daily' };
  }

  if (SLASH_DATE_REGEX.test(trimmed)) {
    const [y, mo, d] = trimmed.split('/').map(Number);
    if (y >= 1800 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return { canonical: `${String(y).padStart(4, '0')}-${pad2(mo)}-${pad2(d)}`, cadenceHint: 'daily' };
    }
  }

  if (US_DATE_REGEX.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      const dt = new Date(parsed);
      return {
        canonical: `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`,
        cadenceHint: 'daily',
      };
    }
  }

  return null;
}

function isExcelDateFormatString(fmt: string | undefined): boolean {
  if (!fmt) return false;
  const trimmed = fmt.trim();
  if (!trimmed || trimmed === 'General') return false;
  if (ZERO_PAD_EXCEL_FORMAT_REGEX.test(trimmed)) return false;
  // Exclude ordinary numeric/currency/percentage formats
  if (/^[0#.,\s$%+-]+$/.test(trimmed)) return false;
  const ssf = getXlsxSsf();
  if (ssf && typeof ssf.is_date === 'function') {
    try {
      return ssf.is_date(trimmed);
    } catch {
      // fall through to deterministic regex check
    }
  }
  const stripped = trimmed.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').toLowerCase();
  return /[ymd]/.test(stripped);
}

function inferCadenceFromExcelFormat(fmt: string | undefined): TimeCadence | null {
  if (!fmt) return null;
  const lower = fmt.toLowerCase().replace(/"[^"]*"/g, '');
  if (lower.includes('q')) return 'quarterly';
  if ((lower.includes('m') && lower.includes('y')) && !lower.includes('d')) return 'monthly';
  if (lower.includes('d')) return 'daily';
  return null;
}

interface ExcelColumnMeta {
  zeroPadWidth: number | null;
  isExcelDateColumn: boolean;
  excelDateCadenceHint: TimeCadence | null;
  excelPrecisionDiffCount: number;
  excelPrecisionExample: string | null;
}

function inferTimeCadenceFromValues(
  values: string[],
  type: InferredType,
  stataName: string,
  excelHint?: TimeCadence | null
): TimeCadence {
  if (values.length === 0) return 'none';
  if (type === 'date') {
    if (excelHint && excelHint !== 'none') return excelHint;
    let qCount = 0;
    let mCount = 0;
    let dCount = 0;
    let firstOfMonthCount = 0;
    let quarterStartCount = 0;

    for (const v of values) {
      if (QUARTERLY_REGEX.test(v)) {
        qCount++;
      } else if (MONTHLY_REGEX.test(v)) {
        mCount++;
      } else if (ISO_DATE_REGEX.test(v)) {
        dCount++;
        const mo = Number(v.slice(5, 7));
        const day = Number(v.slice(8, 10));
        if (day === 1) {
          firstOfMonthCount++;
          if (mo === 1 || mo === 4 || mo === 7 || mo === 10) {
            quarterStartCount++;
          }
        }
      }
    }

    if (qCount >= values.length * 0.8) return 'quarterly';
    if (mCount >= values.length * 0.8) return 'monthly';
    if (dCount >= values.length * 0.8) {
      const lower = stataName.toLowerCase();
      if (lower.includes('quarter') || lower === 'qtr') return 'quarterly';
      if (lower.includes('month') || lower === 'ym') return 'monthly';
      if (dCount >= 3 && quarterStartCount === dCount) return 'quarterly';
      if (dCount >= 3 && firstOfMonthCount === dCount) return 'monthly';
      return 'daily';
    }
    return 'daily';
  }

  if (type === 'numeric') {
    const nums = values.map(parseStrictNumeric).filter((n): n is number => n !== null);
    if (
      nums.length > 0 &&
      nums.every((n) => Number.isInteger(n) && n >= 1850 && n <= 2100) &&
      /(^|_)(year|yr|fy|period|time)($|_)/.test(stataName.toLowerCase())
    ) {
      return 'annual';
    }
  }

  return 'none';
}

function inferVariableRole(
  stataName: string,
  type: InferredType,
  inferredTimeCadence: TimeCadence,
  preserveLeadingZeros: boolean,
  nonMissing: number,
  uniqueCount: number
): VariableRole {
  const lower = stataName.toLowerCase();

  if (
    type === 'date' ||
    inferredTimeCadence !== 'none' ||
    /^(year|yr|date|month|quarter|qtr|period|time|fy|wave)$/.test(lower) ||
    /(^|_)(date|year|month|quarter|period)$/.test(lower)
  ) {
    return 'time';
  }

  if (
    preserveLeadingZeros ||
    /(^|_)(id|fips|code|key|uuid|gvkey|permno|cusip|isin|ein|ssn|zip|postal|msa|cbsa|iso)$/.test(
      lower
    ) ||
    /^(loan_id|record_id|obs_id|firm_id|entity_id|person_id|metro_id|metro_name|district|county|state_code)$/.test(
      lower
    )
  ) {
    return 'identifier';
  }

  // High-uniqueness non-numeric name/ID column (e.g., 95%+ unique strings)
  if (type === 'string' && nonMissing >= 5 && uniqueCount / nonMissing >= 0.9) {
    return 'identifier';
  }

  return 'covariate';
}

function inferColumnProfile(
  rawName: string,
  stataName: string,
  wasRenamed: boolean,
  columnIndex: number,
  values: string[],
  isDemo: boolean,
  excelMeta?: ExcelColumnMeta
): ColumnProfile {
  const total = values.length;
  const nonEmpty: string[] = [];
  for (const v of values) {
    if (!isMissingCell(v)) {
      nonEmpty.push(v.trim());
    }
  }

  const nonMissing = nonEmpty.length;
  const missingCount = total - nonMissing;
  const missingPct = total > 0 ? (missingCount / total) * 100 : 0;
  const uniqueSet = new Set(nonEmpty);
  const uniqueCount = uniqueSet.size;

  const isAllMissing = nonMissing === 0;
  const isConstant = nonMissing > 0 && uniqueCount <= 1;

  let leadingZeroCount = 0;
  let longIntegerIdCount = 0;
  let numericCount = 0;
  let dateCount = 0;
  let nonPositiveCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;
  let leqNegOneCount = 0;

  for (const v of nonEmpty) {
    if (LEADING_ZERO_ID_REGEX.test(v)) {
      leadingZeroCount++;
    }
    if (LONG_INTEGER_ID_REGEX.test(v)) {
      longIntegerIdCount++;
    }
    const num = parseStrictNumeric(v);
    if (num !== null) {
      numericCount++;
      if (num <= 0) nonPositiveCount++;
      if (num === 0) zeroCount++;
      if (num < 0) negativeCount++;
      if (num <= -1) leqNegOneCount++;
    } else if (normalizeDateString(v) !== null) {
      dateCount++;
    }
  }

  const hasExplicitExcelZeroPad = Boolean(excelMeta?.zeroPadWidth && excelMeta.zeroPadWidth >= 2);
  const preserveLeadingZeros =
    hasExplicitExcelZeroPad ||
    (nonMissing > 0 && leadingZeroCount >= 1 && numericCount / nonMissing >= 0.9);
  const preserveLongId = nonMissing > 0 && longIntegerIdCount >= 1;

  const avgTextLen =
    nonMissing > 0
      ? nonEmpty.reduce((acc, s) => acc + s.length, 0) / nonMissing
      : 0;

  let type: InferredType = 'string';
  if (nonMissing === 0) {
    type = 'string';
  } else if (preserveLeadingZeros || preserveLongId) {
    type = 'string';
    nonPositiveCount = 0;
    zeroCount = 0;
    negativeCount = 0;
    leqNegOneCount = 0;
  } else if (excelMeta?.isExcelDateColumn || dateCount / nonMissing >= 0.85) {
    type = 'date';
    nonPositiveCount = 0;
    zeroCount = 0;
    negativeCount = 0;
    leqNegOneCount = 0;
  } else if (numericCount / nonMissing >= 0.92) {
    type = 'numeric';
  } else {
    // Preserve categorical status for repeating group/sector/region fields even on compact reshaped tables
    // (e.g., district x sector with 3 districts x 3 sectors = 9 rows, uniqueCount = 3)
    const lower = stataName.toLowerCase();
    const looksLikeCategoryName =
      /(^|_)(sector|industry|region|category|group|type|class|tier|status|gender|sex|grade|band|segment|product|branch|country|state|province)$/.test(
        lower
      );
    const repeatsMeaningfully =
      uniqueCount <= 30 &&
      nonMissing >= 2 &&
      (uniqueCount === 1 || uniqueCount <= Math.floor(nonMissing * 0.5) || (looksLikeCategoryName && uniqueCount < nonMissing));

    if (repeatsMeaningfully && avgTextLen <= 48) {
      type = 'categorical';
    } else {
      type = 'string';
    }
  }

  const inferredTimeCadence = inferTimeCadenceFromValues(
    nonEmpty,
    type,
    stataName,
    excelMeta?.excelDateCadenceHint
  );

  const role = inferVariableRole(
    stataName,
    type,
    inferredTimeCadence,
    preserveLeadingZeros || preserveLongId,
    nonMissing,
    uniqueCount
  );

  return {
    rawName,
    stataName,
    wasRenamed,
    label: toHumanLabel(rawName, stataName, isDemo),
    type,
    role,
    inferredTimeCadence,
    confirmedTimeCadence: inferredTimeCadence,
    preserveLeadingZeros,
    preserveLongId,
    zeroPadWidth: excelMeta?.zeroPadWidth ?? null,
    isExcelDateColumn: Boolean(excelMeta?.isExcelDateColumn),
    excelPrecisionDiffCount: excelMeta?.excelPrecisionDiffCount ?? 0,
    excelPrecisionExample: excelMeta?.excelPrecisionExample ?? null,
    columnIndex,
    nonMissing,
    missingCount,
    missingPct,
    uniqueCount,
    isAllMissing,
    isConstant,
    nonPositiveCount,
    zeroCount,
    negativeCount,
    leqNegOneCount,
    sampleValues: Array.from(uniqueSet).slice(0, 4),
  };
}

function countExactDuplicatesInSlice(rows: RawRow[], columns: ColumnProfile[]): number {
  const names = columns.map((c) => c.stataName);
  const seen = new Set<string>();
  let exactDups = 0;
  for (const row of rows) {
    const key = names.map((c) => row[c] ?? '').join('\u0001');
    if (seen.has(key)) exactDups++;
    else seen.add(key);
  }
  return exactDups;
}

function detectUniqueRecordIdColumn(rows: RawRow[], columns: ColumnProfile[]): string | null {
  if (rows.length < 3) return null;
  const candidates = columns
    .filter((c) => {
      if (c.type === 'date') return false;
      if (c.nonMissing !== rows.length || c.uniqueCount !== rows.length) return false;
      const lower = c.stataName.toLowerCase();
      if (/(^|_)(id|loan|record|obs|tx|transaction|account|case|application|contract|key|uuid)/.test(lower)) {
        return true;
      }
      if (c.preserveLeadingZeros) return true;
      return false;
    })
    .sort((a, b) => {
      const score = (col: ColumnProfile) => {
        const lower = col.stataName.toLowerCase();
        if (/(loan_id|record_id|obs_id|transaction_id|case_id)/.test(lower)) return 100;
        if (/(^|_)id$/.test(lower)) return 80;
        return 50;
      };
      return score(b) - score(a);
    });

  return candidates[0]?.stataName ?? null;
}

/**
 * Evaluates a candidate (entityVar, timeVar) pair on a specific row slice for panel
 * balance, missing keys, repeated key groups, excess rows, exact duplicates vs.
 * distinct records sharing a key.
 */
export function evaluatePanelStructure(
  rows: RawRow[],
  columns: ColumnProfile[],
  entityVar: string | null,
  timeVar: string | null,
  detectionReason: string,
  userConfirmed: boolean,
  overrideStructureKind?: StructureKind,
  candidateEntityVar?: string | null,
  candidateTimeVar?: string | null
): PanelDetection {
  const uniqueRecordIdVar = detectUniqueRecordIdColumn(rows, columns);
  const exactDuplicateRows = countExactDuplicatesInSlice(rows, columns);

  const evalEntity = entityVar ?? candidateEntityVar ?? null;
  const evalTime = timeVar ?? candidateTimeVar ?? null;

  if (!evalEntity || !evalTime || evalEntity === evalTime) {
    return {
      structureKind: overrideStructureKind ?? 'cross_section',
      uniqueRecordIdVar,
      isPanel: false,
      entityVar: entityVar || null,
      timeVar: timeVar || null,
      candidateEntityVar: candidateEntityVar ?? null,
      candidateTimeVar: candidateTimeVar ?? null,
      entityIsString: false,
      detectionReason: detectionReason || 'No panel entity and time key pair selected.',
      panelKeyStatus: 'not_panel',
      balanceStatus: 'not_applicable',
      isBalanced: false,
      numEntities: 0,
      numPeriods: 0,
      minPeriodsPerEntity: 0,
      maxPeriodsPerEntity: 0,
      missingEntityRows: 0,
      missingTimeRows: 0,
      missingKeyRows: 0,
      repeatedKeyGroups: 0,
      duplicateKeyPairs: 0,
      exactDuplicateRows,
      distinctKeyConflictRows: 0,
      userConfirmed,
    };
  }

  const entityCol = columns.find((c) => c.stataName === evalEntity);
  const entityIsString = entityCol ? entityCol.type !== 'numeric' : true;

  const entityPeriods = new Map<string, Set<string>>();
  const allPeriods = new Set<string>();
  const keyCounts = new Map<string, number>();

  // Also track deduplicated rows to separate exact duplicate rows from distinct records sharing a key
  const colNames = columns.map((c) => c.stataName);
  const seenExactRows = new Set<string>();
  const dedupKeyCounts = new Map<string, number>();

  let missingEntityRows = 0;
  let missingTimeRows = 0;
  let missingKeyRows = 0;

  for (const row of rows) {
    const eVal = (row[evalEntity] ?? '').trim();
    const tVal = (row[evalTime] ?? '').trim();

    if (!eVal) missingEntityRows++;
    if (!tVal) missingTimeRows++;
    if (!eVal || !tVal) {
      missingKeyRows++;
      continue;
    }

    allPeriods.add(tVal);
    if (!entityPeriods.has(eVal)) {
      entityPeriods.set(eVal, new Set());
    }
    entityPeriods.get(eVal)!.add(tVal);
    const pairKey = `${eVal}\u0000${tVal}`;
    keyCounts.set(pairKey, (keyCounts.get(pairKey) ?? 0) + 1);

    const exactSig = colNames.map((c) => row[c] ?? '').join('\u0001');
    if (!seenExactRows.has(exactSig)) {
      seenExactRows.add(exactSig);
      dedupKeyCounts.set(pairKey, (dedupKeyCounts.get(pairKey) ?? 0) + 1);
    }
  }

  let repeatedKeyGroups = 0;
  let duplicateKeyPairs = 0;
  for (const count of keyCounts.values()) {
    if (count > 1) {
      repeatedKeyGroups++;
      duplicateKeyPairs += count - 1;
    }
  }

  let distinctKeyConflictRows = 0;
  for (const count of dedupKeyCounts.values()) {
    if (count > 1) {
      distinctKeyConflictRows += count - 1;
    }
  }

  const periodCounts = Array.from(entityPeriods.values()).map((s) => s.size);
  const numEntities = entityPeriods.size;
  const numPeriods = allPeriods.size;
  const minPeriodsPerEntity = periodCounts.length > 0 ? Math.min(...periodCounts) : 0;
  const maxPeriodsPerEntity = periodCounts.length > 0 ? Math.max(...periodCounts) : 0;

  const isActivePanel = Boolean(entityVar && timeVar) && numEntities >= 2 && numPeriods >= 2;

  let panelKeyStatus: PanelKeyStatus = 'not_panel';
  if (isActivePanel) {
    if (missingKeyRows > 0 && duplicateKeyPairs > 0) {
      panelKeyStatus = 'invalid_missing_and_repeated';
    } else if (missingKeyRows > 0) {
      panelKeyStatus = 'invalid_missing_keys';
    } else if (duplicateKeyPairs > 0) {
      panelKeyStatus = 'invalid_repeated_keys';
    } else {
      panelKeyStatus = 'valid';
    }
  }

  // Panel balance is ONLY defined when keys are valid (unique and non-missing).
  // Distinguish strongly balanced (all entities share identical full period set)
  // from weakly balanced (equal period counts per entity, but different periods)
  // and unbalanced (varying period counts across entities).
  let balanceStatus: PanelBalanceStatus = 'not_applicable';
  if (isActivePanel) {
    if (panelKeyStatus !== 'valid') {
      balanceStatus = 'undefined_invalid_keys';
    } else if (minPeriodsPerEntity === maxPeriodsPerEntity && minPeriodsPerEntity === numPeriods) {
      balanceStatus = 'strongly_balanced';
    } else if (minPeriodsPerEntity === maxPeriodsPerEntity && minPeriodsPerEntity < numPeriods) {
      balanceStatus = 'weakly_balanced';
    } else {
      balanceStatus = 'unbalanced';
    }
  }

  const isBalanced = balanceStatus === 'strongly_balanced';

  const resolvedKind: StructureKind =
    overrideStructureKind ?? (isActivePanel ? 'panel' : 'dated_cross_section');

  return {
    structureKind: resolvedKind,
    uniqueRecordIdVar,
    isPanel: isActivePanel,
    entityVar: entityVar || null,
    timeVar: timeVar || null,
    candidateEntityVar: candidateEntityVar ?? evalEntity,
    candidateTimeVar: candidateTimeVar ?? evalTime,
    entityIsString,
    detectionReason,
    panelKeyStatus,
    balanceStatus,
    isBalanced,
    numEntities,
    numPeriods,
    minPeriodsPerEntity,
    maxPeriodsPerEntity,
    missingEntityRows,
    missingTimeRows,
    missingKeyRows,
    repeatedKeyGroups,
    duplicateKeyPairs,
    exactDuplicateRows,
    distinctKeyConflictRows,
    userConfirmed,
  };
}

/**
 * Validates the observation unit and candidate entity-time keys before recommending a panel.
 * If a dated dataset has unique record IDs (e.g., loan_id) and distinct records sharing
 * location-year or location-month keys, reports a dated cross-section instead of forcing a panel.
 */
export function detectPanelKeys(rows: RawRow[], columns: ColumnProfile[]): PanelDetection {
  const uniqueRecordIdVar = detectUniqueRecordIdColumn(rows, columns);

  if (rows.length < 4 || columns.length < 2) {
    return evaluatePanelStructure(
      rows,
      columns,
      null,
      null,
      'Dataset has too few observations or columns for panel detection.',
      false,
      'cross_section'
    );
  }

  // Score candidate time columns
  const timeCandidates = columns
    .map((col) => {
      let score = 0;
      const reasons: string[] = [];
      const name = col.stataName.toLowerCase();
      if (/^(year|yr|period|quarter|qtr|month|ym|time|date|t|fy|wave)$/.test(name)) {
        score += 50;
        reasons.push(`name "${col.stataName}" matches temporal convention`);
      } else if (/(year|date|period|quarter|month|time)/.test(name)) {
        score += 28;
        reasons.push(`name "${col.stataName}" indicates time index`);
      }
      if (col.type === 'date' || col.inferredTimeCadence !== 'none') {
        score += 25;
        reasons.push(`cadence: ${col.inferredTimeCadence}`);
      }
      if (col.type === 'numeric') {
        const sampleNums = rows
          .slice(0, 60)
          .map((r) => parseStrictNumeric(r[col.stataName] ?? ''))
          .filter((n): n is number => n !== null);
        if (
          sampleNums.length > 0 &&
          sampleNums.every((n) => Number.isInteger(n) && n >= 1850 && n <= 2100)
        ) {
          score += 35;
          reasons.push('4-digit integer calendar years');
        }
      }
      if (col.uniqueCount >= 2 && col.uniqueCount <= Math.min(365, Math.floor(rows.length * 0.85))) {
        score += 15;
        reasons.push(`${col.uniqueCount} repeating periods`);
      } else {
        score -= 40;
      }
      return { col, score, reasons };
    })
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);

  const bestTime = timeCandidates[0];
  if (!bestTime) {
    const idNote = uniqueRecordIdVar
      ? `Unique record identifier "${uniqueRecordIdVar}" detected with no repeating temporal column; treating as cross-section.`
      : 'No repeating temporal column (such as year, month, quarter, or date) was detected; treating dataset as cross-sectional.';
    return evaluatePanelStructure(rows, columns, null, null, idNote, false, 'cross_section');
  }

  // Score candidate entity columns (excluding time column and excluding unique per-row record IDs)
  const entityCandidates = columns
    .filter((c) => c.stataName !== bestTime.col.stataName && c.stataName !== uniqueRecordIdVar)
    .map((col) => {
      let score = 0;
      const reasons: string[] = [];
      const name = col.stataName.toLowerCase();
      if (
        /(^|_)(id|fips|code|metro|city|state|county|country|district|location|region|firm|company|gvkey|permno|ticker|person|worker|hhid|entity|unit|school|msa|cbsa|iso)/.test(
          name
        )
      ) {
        score += 42;
        reasons.push(`name "${col.stataName}" matches unit identifier`);
      }
      if (/(name|metro|city|firm|country|state|district|location)/.test(name) && col.type !== 'numeric') {
        score += 18;
      }
      const expectedCoverage = col.uniqueCount * bestTime.col.uniqueCount;
      const ratio = expectedCoverage / Math.max(1, rows.length);
      if (col.uniqueCount >= 2 && col.uniqueCount < rows.length * 0.95) {
        if (ratio >= 0.75 && ratio <= 1.6) {
          score += 36;
          reasons.push(
            `${col.uniqueCount} unique units × ${bestTime.col.uniqueCount} periods closely matches N = ${rows.length}`
          );
        } else if (ratio >= 0.2 && ratio <= 2.5) {
          score += 16;
          reasons.push(`${col.uniqueCount} unique units across ${bestTime.col.uniqueCount} periods`);
        }
      } else {
        score -= 30;
      }
      if (col.uniqueCount <= 4 && rows.length > 50 && !/(district|location|region)/.test(name)) {
        score -= 22;
      }
      return { col, score, reasons };
    })
    .filter((c) => c.score >= 38)
    .sort((a, b) => b.score - a.score);

  const bestEntity = entityCandidates[0];
  if (!bestEntity) {
    return evaluatePanelStructure(
      rows,
      columns,
      null,
      null,
      uniqueRecordIdVar
        ? `Dated cross-section: unique record ID "${uniqueRecordIdVar}" with time column "${bestTime.col.stataName}" and no entity panel key.`
        : `Found time column "${bestTime.col.stataName}", but no cross-sectional entity identifier matched.`,
      false,
      'dated_cross_section',
      null,
      bestTime.col.stataName
    );
  }

  // Critically evaluate actual key uniqueness & missingness BEFORE recommending a panel!
  const probe = evaluatePanelStructure(
    rows,
    columns,
    bestEntity.col.stataName,
    bestTime.col.stataName,
    '',
    false
  );

  // If distinct records share the same (entity, time) key — especially when a unique record ID like loan_id exists —
  // classify as a dated cross-section and do NOT recommend a panel!
  if (probe.distinctKeyConflictRows > 0) {
    const reason = uniqueRecordIdVar
      ? `Dated cross-section: unique record ID "${uniqueRecordIdVar}" detected, while candidate key (${bestEntity.col.stataName}, ${bestTime.col.stataName}) has ${probe.repeatedKeyGroups} repeated group(s) and ${probe.distinctKeyConflictRows} excess distinct record(s). Leaving panel unconfirmed; OLS and grouped comparisons remain available.`
      : `Structure unconfirmed (dated cross-section): candidate key (${bestEntity.col.stataName}, ${bestTime.col.stataName}) has ${probe.repeatedKeyGroups} repeated group(s) with ${probe.distinctKeyConflictRows} excess distinct record(s) beyond exact duplicates. Check whether the true observational unit includes an additional dimension.`;

    return evaluatePanelStructure(
      rows,
      columns,
      null,
      null,
      reason,
      false,
      'dated_cross_section',
      bestEntity.col.stataName,
      bestTime.col.stataName
    );
  }

  // If keys are missing on many rows, leave unconfirmed and explain clearly
  if (probe.missingKeyRows > 0) {
    const reason = `Candidate panel (${bestEntity.col.stataName}, ${bestTime.col.stataName}) has ${probe.missingKeyRows} row(s) with missing keys (${probe.missingEntityRows} missing entity, ${probe.missingTimeRows} missing time). Review and confirm keys before using xtset.`;
    return evaluatePanelStructure(
      rows,
      columns,
      bestEntity.col.stataName,
      bestTime.col.stataName,
      reason,
      false,
      'panel',
      bestEntity.col.stataName,
      bestTime.col.stataName
    );
  }

  const dupNote =
    probe.duplicateKeyPairs > 0
      ? ` Note: ${probe.duplicateKeyPairs} repeated pair(s) stem from exact duplicate rows (resolves after duplicates drop).`
      : '';

  const reasonText = `Suggested entity "${bestEntity.col.stataName}" (${bestEntity.reasons.join('; ')}) and time "${bestTime.col.stataName}" (${bestTime.reasons.join('; ')}).${dupNote}`;

  return evaluatePanelStructure(
    rows,
    columns,
    bestEntity.col.stataName,
    bestTime.col.stataName,
    reasonText,
    false,
    'panel',
    bestEntity.col.stataName,
    bestTime.col.stataName
  );
}

function buildDatasetFromMatrix(
  fileName: string,
  sourceFormat: SourceFormat,
  rawHeaders: string[],
  rawRows: string[][],
  isDemo: boolean,
  availableSheets: string[] = [],
  selectedSheet: string | null = null,
  excelDateSystem: '1900' | '1904' | null = null,
  excelColMetas?: ExcelColumnMeta[]
): DatasetState {
  if (rawHeaders.length === 0) {
    throw new Error('The uploaded file contains no header columns.');
  }

  // Filter completely empty trailing rows
  const nonBlankRows = rawRows.filter((r) =>
    r.some((cell) => cell !== undefined && cell !== null && String(cell).trim() !== '')
  );

  if (nonBlankRows.length === 0) {
    throw new Error('The uploaded file contains header names but no data rows.');
  }

  const nameMap = sanitizeStataColumnNames(rawHeaders);

  const columnValues: string[][] = nameMap.map(() => []);
  const parsedRows: RawRow[] = nonBlankRows.map((rowArr) => {
    const obj: RawRow = {};
    nameMap.forEach((col, i) => {
      const rawCell = rowArr[i] === undefined || rowArr[i] === null ? '' : String(rowArr[i]).trim();
      let normalized = isMissingCell(rawCell) ? '' : rawCell;
      // Canonicalize unambiguous date strings in CSVs too (e.g., 2024/03/15 -> 2024-03-15, 2024-Q1 -> 2024Q1)
      if (normalized && !LEADING_ZERO_ID_REGEX.test(normalized) && parseStrictNumeric(normalized) === null) {
        const dtNorm = normalizeDateString(normalized);
        if (dtNorm) normalized = dtNorm.canonical;
      }
      obj[col.stataName] = normalized;
      columnValues[i].push(normalized);
    });
    return obj;
  });

  const columns: ColumnProfile[] = nameMap.map((col, i) =>
    inferColumnProfile(
      col.rawName,
      col.stataName,
      col.wasRenamed,
      i + 1,
      columnValues[i],
      isDemo,
      excelColMetas?.[i]
    )
  );

  // Build explicit user-facing conversion notices (precision overrides, date systems, cadence confirmation)
  const conversionNotices: string[] = [];
  if (sourceFormat === 'xlsx') {
    if (excelDateSystem === '1904') {
      conversionNotices.push(
        'Workbook uses the 1904 (Mac) Excel date system; all Excel date serials were converted using the 1904 epoch.'
      );
    }
    const precisionCols = columns.filter((c) => c.excelPrecisionDiffCount > 0);
    if (precisionCols.length > 0) {
      conversionNotices.push(
        `Full stored numeric precision preserved for ${precisionCols
          .map((c) => `${c.stataName}${c.excelPrecisionExample ? ` (${c.excelPrecisionExample})` : ''}`)
          .join(', ')} rather than rounded Excel display text.`
      );
    }
    const dateCols = columns.filter((c) => c.type === 'date');
    if (dateCols.length > 0) {
      conversionNotices.push(
        `Date column(s) (${dateCols.map((c) => `${c.stataName}: ${c.inferredTimeCadence}`).join(', ')}) parsed to canonical strings. Confirm daily, monthly, or quarterly roles in the Inspector to emit matching Stata %td/%tm/%tq formats.`
      );
    }
  }

  let detectedPanel = detectPanelKeys(parsedRows, columns);
  if (isDemo) {
    const hasMetroName = columns.some((c) => c.stataName === 'metro_name');
    const hasYear = columns.some((c) => c.stataName === 'year');
    if (hasMetroName && hasYear) {
      detectedPanel = evaluatePanelStructure(
        parsedRows,
        columns,
        'metro_name',
        'year',
        'Suggested entity "metro_name" (30 unique metropolitan areas; string ID auto-encoded before xtset) and time "year" (15 calendar years 2010–2024). Raw file includes 3 exact duplicate rows; removing them yields a strongly balanced 30 × 15 panel.',
        true,
        'panel',
        'metro_name',
        'year'
      );
    }
  }

  return {
    id: `ds_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    sourceFormat,
    isDemo,
    availableSheets,
    selectedSheet,
    excelDateSystem,
    conversionNotices,
    missingTokens: ['""', 'NA', 'N/A', '.', 'null', 'NaN'],
    rowCount: parsedRows.length,
    columnCount: columns.length,
    columns,
    rows: parsedRows,
    panel: detectedPanel,
  };
}

export function parseCsvText(
  csvText: string,
  fileName: string,
  isDemo = false
): DatasetState {
  const result = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: 'greedy',
    dynamicTyping: false, // Crucial: keep raw strings to preserve leading-zero IDs
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parsing failed: ${result.errors[0].message}`);
  }

  const data = result.data;
  if (data.length < 2) {
    throw new Error('CSV file must include a header row and at least one observation row.');
  }

  const rawHeaders = data[0].map((h) => String(h ?? ''));
  const rawRows = data.slice(1);

  return buildDatasetFromMatrix(
    fileName,
    isDemo ? 'demo' : 'csv',
    rawHeaders,
    rawRows,
    isDemo
  );
}

export interface ParsedWorkbookHandle {
  fileName: string;
  sheetNames: string[];
  sheetPreviews: SheetPreviewMeta[];
  excelDateSystem: '1900' | '1904';
  workbook: XLSX.WorkBook;
}

function extractTypedSheetMatrix(
  sheet: XLSX.WorkSheet,
  isDate1904: boolean
): {
  rawHeaders: string[];
  rawRows: string[][];
  colMetas: ExcelColumnMeta[];
} {
  const ref = sheet['!ref'];
  if (!ref) {
    return { rawHeaders: [], rawRows: [], colMetas: [] };
  }
  const range = XLSX.utils.decode_range(ref);
  const numCols = range.e.c - range.s.c + 1;
  const rawHeaders: string[] = [];

  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = sheet[addr];
    const headerText = cell ? String(cell.w ?? cell.v ?? '').trim() : '';
    rawHeaders.push(headerText || `col_${c - range.s.c + 1}`);
  }

  const colMetas: ExcelColumnMeta[] = Array.from({ length: numCols }, () => ({
    zeroPadWidth: null,
    isExcelDateColumn: false,
    excelDateCadenceHint: null,
    excelPrecisionDiffCount: 0,
    excelPrecisionExample: null,
  }));

  const dateHits = new Array<number>(numCols).fill(0);
  const nonEmptyHits = new Array<number>(numCols).fill(0);
  const rawRows: string[][] = [];

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const rowArr: string[] = new Array<string>(numCols).fill('');
    let rowHasData = false;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const colIdx = c - range.s.c;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || cell.t === 'z' || cell.t === 'e' || cell.v === null || cell.v === undefined) {
        rowArr[colIdx] = '';
        continue;
      }

      const meta = colMetas[colIdx];
      const fmt = typeof cell.z === 'string' ? cell.z : undefined;

      if (cell.t === 's') {
        const text = String(cell.v).trim();
        if (!isMissingCell(text)) {
          rowHasData = true;
          nonEmptyHits[colIdx]++;
          const dtNorm = normalizeDateString(text);
          if (dtNorm) {
            rowArr[colIdx] = dtNorm.canonical;
            dateHits[colIdx]++;
            if (!meta.excelDateCadenceHint) meta.excelDateCadenceHint = dtNorm.cadenceHint;
          } else {
            rowArr[colIdx] = text;
          }
        }
      } else if (cell.t === 'd' && cell.v instanceof Date) {
        rowHasData = true;
        nonEmptyHits[colIdx]++;
        dateHits[colIdx]++;
        const dt = cell.v;
        rowArr[colIdx] = `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
        if (!meta.excelDateCadenceHint) {
          meta.excelDateCadenceHint = inferCadenceFromExcelFormat(fmt) ?? 'daily';
        }
      } else if (cell.t === 'n' && typeof cell.v === 'number') {
        rowHasData = true;
        nonEmptyHits[colIdx]++;

        if (isExcelDateFormatString(fmt)) {
          const iso = excelSerialToIsoDate(cell.v, isDate1904);
          if (iso) {
            dateHits[colIdx]++;
            const cadenceHint = inferCadenceFromExcelFormat(fmt);
            if (!meta.excelDateCadenceHint && cadenceHint) {
              meta.excelDateCadenceHint = cadenceHint;
            }
            if (cadenceHint === 'monthly') {
              rowArr[colIdx] = iso.slice(0, 7);
            } else {
              rowArr[colIdx] = iso;
            }
            continue;
          }
        }

        // Explicitly zero-padded identifier format (e.g., "00000" -> "00123")
        if (fmt && ZERO_PAD_EXCEL_FORMAT_REGEX.test(fmt.trim()) && Number.isInteger(cell.v) && cell.v >= 0) {
          const padLen = fmt.trim().length;
          meta.zeroPadWidth = Math.max(meta.zeroPadWidth ?? 0, padLen);
          rowArr[colIdx] = String(cell.v).padStart(padLen, '0');
          continue;
        }

        // Preserve FULL stored numeric precision — display formats like "0" or "0.00" are presentation-only!
        const storedStr = String(cell.v);
        rowArr[colIdx] = storedStr;

        if (typeof cell.w === 'string') {
          const dispNum = parseStrictNumeric(cell.w);
          if (dispNum !== null && Math.abs(dispNum - cell.v) > 1e-9) {
            meta.excelPrecisionDiffCount++;
            if (!meta.excelPrecisionExample) {
              meta.excelPrecisionExample = `stored ${storedStr} vs. displayed "${cell.w.trim()}"`;
            }
          }
        }
      } else if (cell.t === 'b') {
        rowHasData = true;
        nonEmptyHits[colIdx]++;
        rowArr[colIdx] = cell.v ? 'TRUE' : 'FALSE';
      } else {
        const text = String(cell.v).trim();
        if (!isMissingCell(text)) {
          rowHasData = true;
          nonEmptyHits[colIdx]++;
          rowArr[colIdx] = text;
        }
      }
    }

    if (rowHasData) {
      rawRows.push(rowArr);
    }
  }

  for (let i = 0; i < numCols; i++) {
    if (nonEmptyHits[i] > 0 && dateHits[i] / nonEmptyHits[i] >= 0.8) {
      colMetas[i].isExcelDateColumn = true;
    }
  }

  return { rawHeaders, rawRows, colMetas };
}

export function readExcelWorkbook(buffer: ArrayBuffer, fileName: string): ParsedWorkbookHandle {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: false, // Read numeric serials + cell.z format so we control 1900/1904 epoch accurately
    cellNF: true,
    cellText: true,
  });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('The Excel workbook contains no readable worksheets.');
  }

  const isDate1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const excelDateSystem: '1900' | '1904' = isDate1904 ? '1904' : '1900';

  const sheetPreviews: SheetPreviewMeta[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet['!ref']) {
      return {
        name,
        rowCount: 0,
        columnCount: 0,
        headers: [],
        previewRows: [],
        looksLikeNotes: true,
      };
    }
    const { rawHeaders, rawRows } = extractTypedSheetMatrix(sheet, isDate1904);
    const lowerName = name.toLowerCase();
    const looksLikeNotes =
      /readme|notes|info|dictionary|cover|instructions/.test(lowerName) ||
      rawHeaders.length <= 1 ||
      rawRows.length === 0;

    return {
      name,
      rowCount: rawRows.length,
      columnCount: rawHeaders.length,
      headers: rawHeaders.slice(0, 6),
      previewRows: rawRows.slice(0, 4).map((r) => r.slice(0, 6)),
      looksLikeNotes,
    };
  });

  return {
    fileName,
    sheetNames: workbook.SheetNames,
    sheetPreviews,
    excelDateSystem,
    workbook,
  };
}

export function parseExcelSheet(
  handle: ParsedWorkbookHandle,
  sheetName: string
): DatasetState {
  const sheet = handle.workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Worksheet "${sheetName}" could not be found in ${handle.fileName}.`);
  }

  const isDate1904 = handle.excelDateSystem === '1904';
  const { rawHeaders, rawRows, colMetas } = extractTypedSheetMatrix(sheet, isDate1904);

  if (rawHeaders.length === 0 || rawRows.length === 0) {
    throw new Error(
      `Worksheet "${sheetName}" must contain a header row and at least one data row.`
    );
  }

  return buildDatasetFromMatrix(
    handle.fileName,
    'xlsx',
    rawHeaders,
    rawRows,
    false,
    handle.sheetNames,
    sheetName,
    handle.excelDateSystem,
    colMetas
  );
}
