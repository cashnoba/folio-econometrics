import * as XLSX from 'xlsx';
import type { ModelSpec } from '../types/econometrics';
import { generateDemoHousingCsv } from './sampleData';
import { parseCsvText, parseExcelSheet, readExcelWorkbook } from './parser';
import { buildCleanedRowsAndImpact } from './statistics';
import { createInitialModelSpec } from './specValidator';
import { generateStataDoFile, generateStataVerificationDoFile } from './stataGenerator';
import {
  buildBundleReadme,
  buildZipBytes,
  getBundleZipFileName,
  getNormalizedCsvFileName,
  getStataDoFileName,
  getStataVerifyDoFileName,
  serializeNormalizedCsv,
} from './zipBundle';

function workbookToUint8Array(wb: XLSX.WorkBook): Uint8Array<ArrayBuffer> {
  const raw = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array | number[];
  const src =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : new Uint8Array(raw);
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}

export interface BuiltBundleArtifact {
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
  blob: Blob;
  summary: string;
}

/**
 * Builds the reproducible Housing Demo verification ZIP bundle containing:
 *  - us_metro_housing_panel_normalized.csv
 *  - us_metro_housing_panel_analysis.do
 *  - us_metro_housing_panel_verify.do
 *  - README.txt
 */
export function buildHousingDemoVerificationBundle(): BuiltBundleArtifact {
  const demo = parseCsvText(generateDemoHousingCsv(), 'us_metro_housing_panel.csv', true);
  const spec = createInitialModelSpec(demo);
  const { impact } = buildCleanedRowsAndImpact(demo, spec);

  const csvFileName = getNormalizedCsvFileName(demo);
  const doFileName = getStataDoFileName(demo);
  const verifyDoFileName = getStataVerifyDoFileName(demo);
  const zipFileName = getBundleZipFileName(demo);

  const csvText = serializeNormalizedCsv(demo);
  const analysisDo = generateStataDoFile(demo, { ...spec, importMode: 'normalized_bundle' }, impact);
  const verifyDo = generateStataVerificationDoFile(demo, { ...spec, importMode: 'normalized_bundle' }, impact);
  const readmeText = buildBundleReadme(
    demo,
    doFileName,
    verifyDoFileName,
    csvFileName,
    impact.startingN,
    impact.afterExactDuplicatesN,
    impact.previewCompleteCasesN,
    [
      'Expected demo checkpoints: 453 raw rows -> 3 exact duplicates removed -> 450 cleaned rows -> strongly balanced 30 x 15 panel -> 406 pre-estimation complete cases.',
      'Fitted e(N) is printed separately by Stata after reghdfe (equal to 406 if no singletons are dropped, or smaller if any FE group becomes a singleton).',
    ]
  );

  const bytes = buildZipBytes([
    { name: doFileName, content: analysisDo },
    { name: verifyDoFileName, content: verifyDo },
    { name: csvFileName, content: csvText },
    { name: 'README.txt', content: readmeText },
  ]);

  return {
    fileName: zipFileName,
    bytes,
    blob: new Blob([bytes], { type: 'application/zip' }),
    summary: `Demo bundle (${impact.startingN} raw -> ${impact.afterExactDuplicatesN} cleaned -> ${impact.previewCompleteCasesN} pre-estimation complete cases)`,
  };
}

/**
 * Builds a compact synthetic Excel workbook exercising:
 *  - Multi-sheet selection (README notes sheet + Analysis sheet)
 *  - High-significant-digit double precision (123456.789012345 formatted as "0.00")
 *  - Policy rate 13.5 formatted as "0" (displayed as "14")
 *  - Log value 2.302585092994046 formatted as "0" (displayed as "2")
 *  - Zero-padded identifier "00123" (format "00000") & long 16-digit text ID "9007199254740993"
 *  - Header collision ("house-price" & "house price" -> house_price & house_price_2)
 *  - Daily, monthly, and quarterly date columns
 *  - Missing-value tokens ("NA", ".") and 1 exact duplicate row
 */
export function buildPrecisionKeysFixtureWorkbookBytes(): Uint8Array<ArrayBuffer> {
  const wb = XLSX.utils.book_new();

  const wsReadme = XLSX.utils.aoa_to_sheet([
    ['Folio Econometrics — Synthetic Precision & Keys Fixture'],
    ['Select the "Analysis" sheet to verify stored numeric precision, IDs, dates, and keys.'],
  ]);

  const wsAnalysis: XLSX.WorkSheet = {
    '!ref': 'A1:K7',
    A1: { t: 's', v: 'region_code' },
    B1: { t: 's', v: 'long_text_id' },
    C1: { t: 's', v: 'policy_rate' },
    D1: { t: 's', v: 'high_precision_val' },
    E1: { t: 's', v: 'log_gdp' },
    F1: { t: 's', v: 'house-price' },
    G1: { t: 's', v: 'house price' },
    H1: { t: 's', v: 'obs_date' },
    I1: { t: 's', v: 'obs_month' },
    J1: { t: 's', v: 'obs_quarter' },
    K1: { t: 's', v: 'year' },

    // Row 2: 2023-01-15 = Excel 1900 serial 44941; 2023-01-01 = 44927
    A2: { t: 'n', v: 123, z: '00000', w: '00123' },
    B2: { t: 's', v: '9007199254740993' },
    C2: { t: 'n', v: 13.5, z: '0', w: '14' },
    D2: { t: 'n', v: 123456.789012345, z: '0.00', w: '123456.79' },
    E2: { t: 'n', v: 2.302585092994046, z: '0', w: '2' },
    F2: { t: 'n', v: 420000.125, z: '#,##0' },
    G2: { t: 'n', v: 418500.5, z: '#,##0' },
    H2: { t: 'n', v: 44941, z: 'yyyy-mm-dd' },
    I2: { t: 'n', v: 44927, z: 'yyyy-mm' },
    J2: { t: 's', v: '2023Q1' },
    K2: { t: 'n', v: 2023 },

    // Row 3: 2023-04-20 = 45036; 2023-04-01 = 45017
    A3: { t: 'n', v: 123, z: '00000', w: '00123' },
    B3: { t: 's', v: '9007199254740994' },
    C3: { t: 'n', v: 12.75, z: '0', w: '13' },
    D3: { t: 'n', v: 234567.890123456, z: '0.00', w: '234567.89' },
    E3: { t: 'n', v: 2.70805020110221, z: '0', w: '3' },
    F3: { t: 'n', v: 435000.25, z: '#,##0' },
    G3: { t: 's', v: 'NA' }, // text missing token
    H3: { t: 'n', v: 45036, z: 'yyyy-mm-dd' },
    I3: { t: 'n', v: 45017, z: 'yyyy-mm' },
    J3: { t: 's', v: '2023Q2' },
    K3: { t: 'n', v: 2024 },

    // Row 4: 2023-07-10 = 45117; 2023-07-01 = 45108
    A4: { t: 'n', v: 45, z: '00000', w: '00045' },
    B4: { t: 's', v: '9007199254740995' },
    C4: { t: 'n', v: 14.25, z: '0', w: '14' },
    D4: { t: 'n', v: 345678.901234567, z: '0.00', w: '345678.90' },
    E4: { t: 'n', v: 3.14159265358979, z: '0', w: '3' },
    F4: { t: 'n', v: 390000.75, z: '#,##0' },
    G4: { t: 'n', v: 389100.25, z: '#,##0' },
    H4: { t: 'n', v: 45117, z: 'yyyy-mm-dd' },
    I4: { t: 'n', v: 45108, z: 'yyyy-mm' },
    J4: { t: 's', v: '2023Q3' },
    K4: { t: 'n', v: 2023 },

    // Row 5: 2023-10-05 = 45204; 2023-10-01 = 45200
    A5: { t: 'n', v: 45, z: '00000', w: '00045' },
    B5: { t: 's', v: '9007199254740996' },
    C5: { t: 'n', v: 11.5, z: '0', w: '12' },
    D5: { t: 'n', v: 456789.012345678, z: '0.00', w: '456789.01' },
    E5: { t: 'n', v: 1.6094379124341, z: '0', w: '2' },
    F5: { t: 'n', v: 405000.0, z: '#,##0' },
    G5: { t: 'n', v: 404250.5, z: '#,##0' },
    H5: { t: 'n', v: 45204, z: 'yyyy-mm-dd' },
    I5: { t: 'n', v: 45200, z: 'yyyy-mm' },
    J5: { t: 's', v: '2023Q4' },
    K5: { t: 'n', v: 2024 },

    // Row 6: Exact duplicate of Row 2 to verify duplicate detection & removal
    A6: { t: 'n', v: 123, z: '00000', w: '00123' },
    B6: { t: 's', v: '9007199254740993' },
    C6: { t: 'n', v: 13.5, z: '0', w: '14' },
    D6: { t: 'n', v: 123456.789012345, z: '0.00', w: '123456.79' },
    E6: { t: 'n', v: 2.302585092994046, z: '0', w: '2' },
    F6: { t: 'n', v: 420000.125, z: '#,##0' },
    G6: { t: 'n', v: 418500.5, z: '#,##0' },
    H6: { t: 'n', v: 44941, z: 'yyyy-mm-dd' },
    I6: { t: 'n', v: 44927, z: 'yyyy-mm' },
    J6: { t: 's', v: '2023Q1' },
    K6: { t: 'n', v: 2023 },

    // Row 7: Extra unit 00009 (year 2023) with "." missing token in policy_rate
    A7: { t: 'n', v: 9, z: '00000', w: '00009' },
    B7: { t: 's', v: '9007199254740997' },
    C7: { t: 's', v: '.' },
    D7: { t: 'n', v: 567890.123456789, z: '0.00', w: '567890.12' },
    E7: { t: 'n', v: 2.07944154167984, z: '0', w: '2' },
    F7: { t: 'n', v: 360000.5, z: '#,##0' },
    G7: { t: 'n', v: 359500.0, z: '#,##0' },
    H7: { t: 'n', v: 44941, z: 'yyyy-mm-dd' },
    I7: { t: 'n', v: 44927, z: 'yyyy-mm' },
    J7: { t: 's', v: '2023Q1' },
    K7: { t: 'n', v: 2023 },
  };

  XLSX.utils.book_append_sheet(wb, wsReadme, 'README');
  XLSX.utils.book_append_sheet(wb, wsAnalysis, 'Analysis');
  return workbookToUint8Array(wb);
}

/**
 * Builds the synthetic precision & keys verification fixture ZIP bundle containing:
 *  - folio_precision_keys_fixture.xlsx
 *  - folio_precision_keys_fixture_normalized.csv
 *  - folio_precision_keys_fixture_analysis.do
 *  - folio_precision_keys_fixture_verify.do
 *  - README.txt
 */
export function buildPrecisionKeysFixtureBundle(): BuiltBundleArtifact {
  const xlsxFileName = 'folio_precision_keys_fixture.xlsx';
  const xlsxBytes = buildPrecisionKeysFixtureWorkbookBytes();
  const handle = readExcelWorkbook(xlsxBytes.buffer, xlsxFileName);
  const dataset = parseExcelSheet(handle, 'Analysis');

  // Confirm panel keys (region_code, year) so the fixture exercises panel + OLS + precision assertions
  const spec: ModelSpec = {
    ...createInitialModelSpec(dataset),
    importMode: 'normalized_bundle',
    dropExactDuplicates: true,
    estimator: 'ols',
    depVar: 'log_gdp',
    indepVars: ['policy_rate', 'high_precision_val'],
    seType: 'robust',
    diagnostics: {
      vif: true,
      breuschPagan: true,
      hausman: false,
      esttab: false,
    },
  };

  const { impact } = buildCleanedRowsAndImpact(dataset, spec);

  const csvFileName = getNormalizedCsvFileName(dataset);
  const doFileName = getStataDoFileName(dataset);
  const verifyDoFileName = getStataVerifyDoFileName(dataset);
  const zipFileName = 'folio_precision_keys_fixture.zip';

  const csvText = serializeNormalizedCsv(dataset);
  const analysisDo = generateStataDoFile(dataset, spec, impact);
  const verifyDo = generateStataVerificationDoFile(dataset, spec, impact);
  const readmeText = buildBundleReadme(
    dataset,
    doFileName,
    verifyDoFileName,
    csvFileName,
    impact.startingN,
    impact.afterExactDuplicatesN,
    impact.previewCompleteCasesN,
    [
      'Also includes the original synthetic Excel workbook (folio_precision_keys_fixture.xlsx, sheets: README and Analysis) so you can inspect stored values vs. Excel display formats directly.',
      'Key assertions in verify .do: double precision (123456.789012345, 13.5, 2.302585092994046), leading-zero ID ("00123"), 16-digit text ID ("9007199254740993"), header collisions (house_price & house_price_2), %td/%tm/%tq date conversions, missing tokens (NA, .), 6 raw rows -> 5 cleaned rows -> 4 pre-estimation complete cases.',
    ]
  );

  const bytes = buildZipBytes([
    { name: xlsxFileName, content: xlsxBytes },
    { name: doFileName, content: analysisDo },
    { name: verifyDoFileName, content: verifyDo },
    { name: csvFileName, content: csvText },
    { name: 'README.txt', content: readmeText },
  ]);

  return {
    fileName: zipFileName,
    bytes,
    blob: new Blob([bytes], { type: 'application/zip' }),
    summary: `Synthetic precision & keys fixture (${impact.startingN} raw -> ${impact.afterExactDuplicatesN} cleaned -> ${impact.previewCompleteCasesN} complete cases)`,
  };
}
