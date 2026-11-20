/**
 * Comprehensive regression suite for Folio Econometrics.
 * Covers Requirements 1–6 plus all non-regression checks.
 * Run with: npx tsx tests/regression.ts
 */
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  parseCsvText,
  parseExcelSheet,
  readExcelWorkbook,
} from '../src/lib/parser';
import {
  buildCleanedRowsAndImpact,
  computeCorrelationMatrix,
  computeDiagnostics,
  computeNumericSummary,
} from '../src/lib/statistics';
import {
  createInitialModelSpec,
  getDiagnosticCompatibility,
  validateProposalAgainstDataset,
} from '../src/lib/specValidator';
import { generateStataDoFile, getOriginalSourceLimitations } from '../src/lib/stataGenerator';
import { describePanelForSample, generateLatexTable } from '../src/lib/latexGenerator';
import { formatPanelStatusHeadline } from '../src/lib/panelStatus';
import { serializeNormalizedCsv, verifyAndParseZipBytes } from '../src/lib/zipBundle';
import {
  buildHousingDemoVerificationBundle,
  buildPrecisionKeysFixtureBundle,
} from '../src/lib/verificationFixtures';
import { generateDemoHousingCsv } from '../src/lib/sampleData';
import type { LatexConfig, ModelSpec } from '../src/types/econometrics';

let passed = 0;
const failures: Array<{ name: string; error: string }> = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push({ name, error: msg });
    console.error(`  FAIL  ${name}\n        ${msg}`);
  }
}

function wbToArrayBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array | number[];
  if (bytes instanceof ArrayBuffer) return bytes;
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out.buffer;
}

console.log('\nFolio Econometrics — Regression & Parity Verification Suite\n');

// =========================================================================
// FIXTURE A: Excel full precision, zero-padded IDs, 1900 & 1904 date systems,
//            daily/monthly/quarterly cadences, and normalized CSV parity
// =========================================================================
test('Fixture A1: Excel stored numeric precision (13.5 formatted "0" -> 14, log value formatted "0"), zero-pad ID "00000", daily/monthly/quarterly dates & Normalized CSV parity', () => {
  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {
    '!ref': 'A1:F5',
    // Headers
    A1: { t: 's', v: 'region_code' },
    B1: { t: 's', v: 'policy_rate' },
    C1: { t: 's', v: 'log_gdp' },
    D1: { t: 's', v: 'obs_date' },
    E1: { t: 's', v: 'obs_month' },
    F1: { t: 's', v: 'obs_quarter' },
    // Row 2: 2023-01-15 = Excel 1900 serial 44941; 2023-01-01 = 44927
    A2: { t: 'n', v: 123, z: '00000', w: '00123' },
    B2: { t: 'n', v: 13.5, z: '0', w: '14' },
    C2: { t: 'n', v: 2.30258509, z: '0', w: '2' },
    D2: { t: 'n', v: 44941, z: 'yyyy-mm-dd' },
    E2: { t: 'n', v: 44927, z: 'yyyy-mm' },
    F2: { t: 's', v: '2023Q1' },
    // Row 3: 2023-04-20 = 45036; 2023-04-01 = 45017
    A3: { t: 'n', v: 45, z: '00000', w: '00045' },
    B3: { t: 'n', v: 12.75, z: '0', w: '13' },
    C3: { t: 'n', v: 2.7080502, z: '0', w: '3' },
    D3: { t: 'n', v: 45036, z: 'yyyy-mm-dd' },
    E3: { t: 'n', v: 45017, z: 'yyyy-mm' },
    F3: { t: 's', v: '2023Q2' },
    // Row 4: 2023-07-10 = 45117; 2023-07-01 = 45108
    A4: { t: 'n', v: 9, z: '00000', w: '00009' },
    B4: { t: 'n', v: 14.25, z: '0', w: '14' },
    C4: { t: 'n', v: 3.14159265, z: '0', w: '3' },
    D4: { t: 'n', v: 45117, z: 'yyyy-mm-dd' },
    E4: { t: 'n', v: 45108, z: 'yyyy-mm' },
    F4: { t: 's', v: '2023Q3' },
    // Row 5: 2023-10-05 = 45204; 2023-10-01 = 45200
    A5: { t: 'n', v: 8012, z: '00000', w: '08012' },
    B5: { t: 'n', v: 11.5, z: '0', w: '12' },
    C5: { t: 'n', v: 1.60943791, z: '0', w: '2' },
    D5: { t: 'n', v: 45204, z: 'yyyy-mm-dd' },
    E5: { t: 'n', v: 45200, z: 'yyyy-mm' },
    F5: { t: 's', v: '2023Q4' },
  };
  XLSX.utils.book_append_sheet(wb, ws, 'Macro');

  const buf = wbToArrayBuffer(wb);
  const handle = readExcelWorkbook(buf, 'macro_precision.xlsx');
  assert.equal(handle.excelDateSystem, '1900');

  const ds = parseExcelSheet(handle, 'Macro');
  assert.equal(ds.rowCount, 4);

  // Stored precision preserved (NOT rounded to 14 or 2)
  assert.equal(ds.rows[0].policy_rate, '13.5');
  assert.equal(ds.rows[0].log_gdp, '2.30258509');
  assert.equal(ds.rows[0].region_code, '00123');
  assert.equal(ds.rows[2].region_code, '00009');

  // Dates parsed canonically & cadences detected
  assert.equal(ds.rows[0].obs_date, '2023-01-15');
  assert.equal(ds.rows[0].obs_month, '2023-01');
  assert.equal(ds.rows[0].obs_quarter, '2023Q1');

  const rateCol = ds.columns.find((c) => c.stataName === 'policy_rate')!;
  const logCol = ds.columns.find((c) => c.stataName === 'log_gdp')!;
  const idCol = ds.columns.find((c) => c.stataName === 'region_code')!;
  const dayCol = ds.columns.find((c) => c.stataName === 'obs_date')!;
  const monCol = ds.columns.find((c) => c.stataName === 'obs_month')!;
  const qtrCol = ds.columns.find((c) => c.stataName === 'obs_quarter')!;

  assert.equal(rateCol.type, 'numeric');
  assert.ok(rateCol.excelPrecisionDiffCount >= 1, 'Expected precision diff flagged on policy_rate');
  assert.ok(logCol.excelPrecisionDiffCount >= 1, 'Expected precision diff flagged on log_gdp');
  assert.equal(idCol.preserveLeadingZeros, true);
  assert.equal(idCol.zeroPadWidth, 5);
  assert.equal(dayCol.confirmedTimeCadence, 'daily');
  assert.equal(monCol.confirmedTimeCadence, 'monthly');
  assert.equal(qtrCol.confirmedTimeCadence, 'quarterly');

  // Summary diagnostics use exact stored values: mean(13.5, 12.75, 14.25, 11.5) = 13.0
  const diag = computeDiagnostics(ds);
  assert.ok(Math.abs(diag.summaryMap.policy_rate.mean - 13.0) < 1e-9);
  const expectedLogMean = (2.30258509 + 2.7080502 + 3.14159265 + 1.60943791) / 4;
  assert.ok(Math.abs(diag.summaryMap.log_gdp.mean - expectedLogMean) < 1e-8);

  // Compare Excel stored values with serialized normalized CSV!
  const normalizedCsv = serializeNormalizedCsv(ds);
  const reparsed = parseCsvText(normalizedCsv, 'macro_precision_normalized.csv', false);
  for (let i = 0; i < ds.rows.length; i++) {
    assert.equal(reparsed.rows[i].policy_rate, ds.rows[i].policy_rate);
    assert.equal(reparsed.rows[i].log_gdp, ds.rows[i].log_gdp);
    assert.equal(reparsed.rows[i].region_code, ds.rows[i].region_code);
    assert.equal(reparsed.rows[i].obs_date, ds.rows[i].obs_date);
    assert.equal(reparsed.rows[i].obs_month, ds.rows[i].obs_month);
    assert.equal(reparsed.rows[i].obs_quarter, ds.rows[i].obs_quarter);
  }

  // Stata exports emit %td, %tm, %tq conversions & Original Source .xlsx avoids allstring rounding
  const spec: ModelSpec = {
    ...createInitialModelSpec(ds),
    depVar: 'log_gdp',
    indepVars: ['policy_rate'],
    estimator: 'ols',
    importMode: 'normalized_bundle',
  };
  const { impact } = buildCleanedRowsAndImpact(ds, spec);
  const doBundle = generateStataDoFile(ds, spec, impact);
  assert.ok(doBundle.includes('format obs_date_dt %td'), 'Expected %td Stata date conversion');
  assert.ok(doBundle.includes('format obs_month_dt %tm'), 'Expected %tm Stata monthly conversion');
  assert.ok(doBundle.includes('format obs_quarter_dt %tq'), 'Expected %tq Stata quarterly conversion');

  const doOriginal = generateStataDoFile(ds, { ...spec, importMode: 'original_source' }, impact);
  assert.ok(doOriginal.includes('import excel using "macro_precision.xlsx", sheet("Macro") firstrow clear'));
  assert.ok(!doOriginal.includes('allstring'), 'Original .xlsx import must not use allstring (which rounds to Excel display strings)');
  assert.ok(doOriginal.includes('format(%05.0f)'), 'Expected zero-pad tostring guard for 00000 ID');
});

test('Fixture A2: Excel 1904 date system workbook respects 1904 epoch accurately', () => {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { WBProps: { date1904: true } };
  // In 1904 date system, serial 0 = 1904-01-01; 2023-01-15 is 44941 - 1462 = 43479
  const ws: XLSX.WorkSheet = {
    '!ref': 'A1:B3',
    A1: { t: 's', v: 'obs_date' },
    B1: { t: 's', v: 'val' },
    A2: { t: 'n', v: 43479, z: 'yyyy-mm-dd' },
    B2: { t: 'n', v: 10.25 },
    A3: { t: 'n', v: 43510, z: 'yyyy-mm-dd' },
    B3: { t: 'n', v: 11.75 },
  };
  XLSX.utils.book_append_sheet(wb, ws, 'MacData');
  const handle = readExcelWorkbook(wbToArrayBuffer(wb), 'mac_1904.xlsx');
  assert.equal(handle.excelDateSystem, '1904');
  const ds = parseExcelSheet(handle, 'MacData');
  assert.equal(ds.rows[0].obs_date, '2023-01-15');
  assert.equal(ds.rows[1].obs_date, '2023-02-15');
});

// =========================================================================
// FIXTURE B: Multi-sheet Excel workbook (README, Analysis, Roster)
// =========================================================================
test('Fixture B: Multi-sheet Excel preview reports exact row/column counts & detects README notes sheet', () => {
  const wb = XLSX.utils.book_new();
  const wsReadme = XLSX.utils.aoa_to_sheet([
    ['Workbook Documentation'],
    ['Generated for econometric audit.'],
  ]);
  const wsAnalysis = XLSX.utils.aoa_to_sheet([
    ['district', 'year', 'wage'],
    ['North', 2021, 51.2],
    ['North', 2022, 53.4],
    ['South', 2021, 48.1],
    ['South', 2022, 49.9],
  ]);
  const wsRoster = XLSX.utils.aoa_to_sheet([
    ['staff_id', 'name'],
    ['S01', 'Ada'],
    ['S02', 'Grace'],
  ]);
  XLSX.utils.book_append_sheet(wb, wsReadme, 'README');
  XLSX.utils.book_append_sheet(wb, wsAnalysis, 'Analysis');
  XLSX.utils.book_append_sheet(wb, wsRoster, 'Roster');

  const handle = readExcelWorkbook(wbToArrayBuffer(wb), 'multisheet_study.xlsx');
  assert.deepEqual(handle.sheetNames, ['README', 'Analysis', 'Roster']);
  const readmeMeta = handle.sheetPreviews.find((s) => s.name === 'README')!;
  const analysisMeta = handle.sheetPreviews.find((s) => s.name === 'Analysis')!;
  const rosterMeta = handle.sheetPreviews.find((s) => s.name === 'Roster')!;

  assert.equal(readmeMeta.looksLikeNotes, true);
  assert.equal(analysisMeta.looksLikeNotes, false);
  assert.equal(analysisMeta.rowCount, 4);
  assert.equal(analysisMeta.columnCount, 3);
  assert.equal(rosterMeta.rowCount, 2);
  assert.equal(rosterMeta.columnCount, 2);
});

// =========================================================================
// FIXTURE C: Dated cross-section with unique loan_id & repeated (location, month)
// =========================================================================
test('Fixture C: Dated loan cross-section (unique loan_id, repeated location-month) avoids false panel recommendation & allows OLS without xtset', () => {
  const csv = [
    'loan_id,location,month,loan_amount,interest_rate',
    'L1001,Boston,2023-01,250000,6.25',
    'L1002,Boston,2023-01,310000,6.40',
    'L1003,Boston,2023-02,280000,6.30',
    'L1004,Chicago,2023-01,195000,6.10',
    'L1005,Chicago,2023-01,215000,6.15',
    'L1006,Chicago,2023-02,225000,6.20',
  ].join('\n');

  const ds = parseCsvText(csv, 'loan_originations.csv', false);
  assert.equal(ds.panel.uniqueRecordIdVar, 'loan_id');
  assert.equal(ds.panel.structureKind, 'dated_cross_section');
  assert.equal(ds.panel.isPanel, false);
  assert.equal(ds.panel.repeatedKeyGroups, 2);
  assert.equal(ds.panel.duplicateKeyPairs, 2);
  assert.equal(ds.panel.exactDuplicateRows, 0);
  assert.equal(ds.panel.distinctKeyConflictRows, 2);

  const spec: ModelSpec = {
    ...createInitialModelSpec(ds),
    depVar: 'interest_rate',
    indepVars: ['loan_amount'],
    estimator: 'ols',
  };
  const { impact } = buildCleanedRowsAndImpact(ds, spec);
  const compat = getDiagnosticCompatibility(ds, spec, impact.postDedupPanelCheck);
  assert.equal(compat.xtregAllowed, false);

  const doCode = generateStataDoFile(ds, spec, impact);
  assert.ok(!/^\s*xtset\b/m.test(doCode), 'OLS on dated cross-section must not emit xtset');
  assert.ok(doCode.includes('regress interest_rate loan_amount'));
});

// =========================================================================
// FIXTURE D: District–sector reshape keeps sector categorical
// =========================================================================
test('Fixture D: District-sector panel reshape keeps sector categorical (not misclassified as string)', () => {
  const csv = [
    'district,sector,year,employment,output',
    'D01,Agriculture,2020,120,450',
    'D01,Manufacturing,2020,340,980',
    'D01,Services,2020,510,1210',
    'D01,Agriculture,2021,125,465',
    'D01,Manufacturing,2021,355,1020',
    'D01,Services,2021,540,1290',
    'D02,Agriculture,2020,90,320',
    'D02,Manufacturing,2020,280,820',
    'D02,Services,2020,400,990',
    'D02,Agriculture,2021,95,335',
    'D02,Manufacturing,2021,290,850',
    'D02,Services,2021,420,1040',
  ].join('\n');

  const ds = parseCsvText(csv, 'district_sector_panel.csv', false);
  const sectorCol = ds.columns.find((c) => c.stataName === 'sector')!;
  assert.equal(sectorCol.type, 'categorical', `Expected sector to be categorical, got ${sectorCol.type}`);
});

// =========================================================================
// FIXTURE E: Built-in Demo unified sample logic (Raw 453 unbalanced vs Cleaned 450 strongly balanced)
// =========================================================================
test('Fixture E: Built-in demo unified sample logic — cleaned preview & LaTeX report strongly balanced 30x15; toggling duplicates off keeps OLS valid without xtset', () => {
  const demo = parseCsvText(generateDemoHousingCsv(), 'us_metro_housing_panel.csv', true);
  assert.equal(demo.rowCount, 453);
  assert.equal(demo.panel.isBalanced, false);
  assert.equal(demo.panel.repeatedKeyGroups, 3);
  assert.equal(demo.panel.exactDuplicateRows, 3);
  assert.equal(demo.panel.distinctKeyConflictRows, 0);

  const specCleaned = createInitialModelSpec(demo);
  assert.equal(specCleaned.dropExactDuplicates, true);
  const { cleanedRows, impact: impactCleaned } = buildCleanedRowsAndImpact(demo, specCleaned);

  assert.equal(impactCleaned.afterExactDuplicatesN, 450);
  assert.equal(impactCleaned.cleanedPanel.isBalanced, true);
  assert.equal(impactCleaned.cleanedPanel.numEntities, 30);
  assert.equal(impactCleaned.cleanedPanel.numPeriods, 15);
  assert.equal(impactCleaned.cleanedPanel.duplicateKeyPairs, 0);
  assert.ok(describePanelForSample(impactCleaned.cleanedPanel).includes('strongly balanced'));

  const cleanedSummaries = demo.columns
    .filter((c) => c.type === 'numeric')
    .map((c) => computeNumericSummary(cleanedRows, c.stataName, c.label));
  const cleanedCorr = computeCorrelationMatrix(
    cleanedRows,
    cleanedSummaries.map((s) => s.stataName)
  );
  const latexConfig: LatexConfig = {
    tableType: 'summary',
    sampleScope: 'cleaned',
    pageFitPreset: 'compact_article',
    useResizeBox: false,
    decimals: 2,
    selectedVars: ['house_price', 'median_income'],
    caption: 'Descriptive Summary Statistics',
    label: 'tab:summary',
    highlightThreshold: 0.7,
    boldHighCorrelations: true,
  };
  const texCleaned = generateLatexTable(demo, cleanedSummaries, cleanedCorr, latexConfig, specCleaned, impactCleaned);
  assert.ok(texCleaned.includes('strongly balanced'), 'Cleaned demo LaTeX must report strongly balanced panel');

  const rawDiag = computeDiagnostics(demo);
  const texRaw = generateLatexTable(
    demo,
    rawDiag.summaries,
    rawDiag.correlation,
    { ...latexConfig, sampleScope: 'raw' },
    specCleaned,
    impactCleaned
  );
  assert.equal(demo.panel.panelKeyStatus, 'invalid_repeated_keys');
  assert.equal(demo.panel.balanceStatus, 'undefined_invalid_keys');
  assert.ok(
    texRaw.includes('invalid on this sample (3 repeated key groups, 3 excess rows'),
    `Raw demo LaTeX should report invalid panel keys rather than unbalanced; got: ${texRaw}`
  );
  assert.ok(
    !texRaw.includes('unbalanced (3 repeated key groups'),
    'Raw demo LaTeX must NEVER conflate invalid repeated keys with an unbalanced panel'
  );

  // Toggle duplicate removal OFF + OLS -> plain OLS must remain exportable WITHOUT xtset
  const specOlsNoDedup: ModelSpec = {
    ...specCleaned,
    dropExactDuplicates: false,
    estimator: 'ols',
    seType: 'robust',
  };
  const { impact: impactNoDedup } = buildCleanedRowsAndImpact(demo, specOlsNoDedup);
  assert.equal(impactNoDedup.postDedupPanelCheck.isSafeForXtset, false);
  const doOls = generateStataDoFile(demo, specOlsNoDedup, impactNoDedup);
  assert.ok(!/^\s*xtset\b/m.test(doOls), 'Plain OLS with repeated keys must NOT emit xtset');
  assert.ok(doOls.includes('regress '), 'Plain OLS must still emit regress command');
});

// =========================================================================
// FIXTURE F: Variable suitability (constant categorical, all-missing,
//            and numeric regressor that becomes constant after sample selection)
// =========================================================================
test('Fixture F: Variable suitability flags constant categorical, all-missing, and becomes-constant-after-listwise regressor while keeping descriptive exports valid', () => {
  const csv = [
    'id,country,empty_col,y,x_good,x_const_in_sample',
    '1,UK,,10,2,1',
    '2,UK,,12,4,1',
    '3,UK,,15,6,1',
    '4,UK,,,8,99', // y is missing -> row 4 dropped by listwise deletion, making x_const_in_sample constant (all 1s)
  ].join('\n');

  const ds = parseCsvText(csv, 'suitability_test.csv', false);
  const countryCol = ds.columns.find((c) => c.stataName === 'country')!;
  const emptyCol = ds.columns.find((c) => c.stataName === 'empty_col')!;
  const xConstCol = ds.columns.find((c) => c.stataName === 'x_const_in_sample')!;

  assert.equal(countryCol.isConstant, true);
  assert.equal(emptyCol.isAllMissing, true);
  assert.equal(xConstCol.isConstant, false, 'Overall x_const_in_sample varies (1 and 99)');

  const spec: ModelSpec = {
    ...createInitialModelSpec(ds),
    depVar: 'y',
    indepVars: ['x_good', 'x_const_in_sample'],
    estimator: 'ols',
  };
  const { impact } = buildCleanedRowsAndImpact(ds, spec);

  assert.equal(impact.previewCompleteCasesN, 3);
  assert.ok(impact.suitability.datasetIssues.country, 'Constant categorical country should be flagged');
  assert.ok(impact.suitability.datasetIssues.empty_col, 'All-missing empty_col should be flagged');
  assert.ok(
    impact.suitability.estimationIssues.x_const_in_sample,
    'x_const_in_sample must be flagged as constant on the complete-case sample'
  );
  assert.equal(impact.suitability.modelBlocked, true);

  // Blocked Stata script should pause estimation but preserve descriptive commands
  const doBlocked = generateStataDoFile(ds, spec, impact);
  assert.ok(doBlocked.includes('MODEL EXPORT BLOCKED'));
  assert.ok(doBlocked.includes('tabstat '));
  assert.ok(!/^\s*regress\b/m.test(doBlocked));

  // Descriptive LaTeX remains completely exportable
  const diag = computeDiagnostics(ds);
  const tex = generateLatexTable(
    ds,
    diag.summaries,
    diag.correlation,
    {
      tableType: 'summary',
      sampleScope: 'raw',
      pageFitPreset: 'compact_article',
      useResizeBox: false,
      decimals: 2,
      selectedVars: ['y', 'x_good'],
      caption: 'Summary',
      label: 'tab:s',
      highlightThreshold: 0.7,
      boldHighCorrelations: true,
    },
    spec,
    impact
  );
  assert.ok(tex.includes('\\begin{tabular}'));
});

// =========================================================================
// FIXTURE G: Non-regression checks (header collisions, ln(1+x) at -0.5,
//            stale AI proposal guard, compact LaTeX presets)
// =========================================================================
test('Fixture G1: Header collisions (house-price & house price) map to house_price & house_price_2 with positional Stata rename', () => {
  const csv = [
    'house-price,house price,zip_code',
    '420000,415000,02138',
    '510000,505000,02139',
    '390000,388000,01970',
  ].join('\n');
  const ds = parseCsvText(csv, 'headers.csv', false);
  assert.deepEqual(
    ds.columns.map((c) => c.stataName),
    ['house_price', 'house_price_2', 'zip_code']
  );
  assert.equal(ds.columns[2].preserveLeadingZeros, true);

  const spec: ModelSpec = {
    ...createInitialModelSpec(ds),
    importMode: 'original_source',
    depVar: 'house_price',
    indepVars: ['house_price_2'],
  };
  const { impact } = buildCleanedRowsAndImpact(ds, spec);
  const doOrig = generateStataDoFile(ds, spec, impact);
  assert.ok(doOrig.includes('rename __folio_c1 house_price'));
  assert.ok(doOrig.includes('rename __folio_c2 house_price_2'));
});

test('Fixture G2: ln(1 + x) retains -0.5 across all 5 rows (only excludes x <= -1)', () => {
  const csv = [
    'id,y,x',
    '1,10,-0.5',
    '2,12,0',
    '3,14,1.5',
    '4,16,2.0',
    '5,18,3.0',
  ].join('\n');
  const ds = parseCsvText(csv, 'ln1p_fixture.csv', false);
  const spec: ModelSpec = {
    ...createInitialModelSpec(ds),
    depVar: 'y',
    indepVars: ['x'],
    logTransforms: { x: 'ln1p' },
  };
  const { impact } = buildCleanedRowsAndImpact(ds, spec);
  assert.equal(impact.previewCompleteCasesN, 5, 'ln(1 + (-0.5)) = ln(0.5) is valid and must retain all 5 rows');
  assert.equal(impact.logDomainNewMissing.length, 0);
});

test('Fixture G3: Stale AI proposal guard rejects unknown/foreign variables on a different dataset', () => {
  const ds = parseCsvText('id,wage,edu\n1,20,12\n2,25,16\n3,30,18', 'wages.csv', false);
  const spec = createInitialModelSpec(ds);
  const { impact } = buildCleanedRowsAndImpact(ds, spec);
  const validated = validateProposalAgainstDataset(
    ds,
    spec,
    {
      summaryTitle: 'Stale housing demo proposal',
      depVar: 'house_price',
      indepVars: ['median_income', 'unemployment_rate'],
      estimator: 'fe_reghdfe',
    },
    impact.postDedupPanelCheck
  );
  assert.equal(validated.nextSpec.depVar, null);
  assert.deepEqual(validated.nextSpec.indepVars, []);
  assert.ok(validated.validationNotes.some((n) => n.includes('house_price')));
});

test('Fixture G4: Compact LaTeX presets emit \\footnotesize and \\setlength{\\tabcolsep}', () => {
  const demo = parseCsvText(generateDemoHousingCsv(), 'us_metro_housing_panel.csv', true);
  const diag = computeDiagnostics(demo);
  const spec = createInitialModelSpec(demo);
  const { impact } = buildCleanedRowsAndImpact(demo, spec);

  const texArticle = generateLatexTable(
    demo,
    diag.summaries,
    diag.correlation,
    {
      tableType: 'summary',
      sampleScope: 'cleaned',
      pageFitPreset: 'compact_article',
      useResizeBox: false,
      decimals: 2,
      selectedVars: ['house_price', 'median_income'],
      caption: 'Summary',
      label: 'tab:art',
      highlightThreshold: 0.7,
      boldHighCorrelations: true,
    },
    spec,
    impact
  );
  assert.ok(texArticle.includes('\\footnotesize'));
  assert.ok(texArticle.includes('\\setlength{\\tabcolsep}{3pt}'));

  const tex6 = generateLatexTable(
    demo,
    diag.summaries,
    diag.correlation,
    {
      tableType: 'summary',
      sampleScope: 'cleaned',
      pageFitPreset: 'compact_6col',
      useResizeBox: false,
      decimals: 2,
      selectedVars: ['house_price', 'median_income'],
      caption: 'Summary 6-Col',
      label: 'tab:six',
      highlightThreshold: 0.7,
      boldHighCorrelations: true,
    },
    spec,
    impact
  );
  assert.ok(tex6.includes('\\footnotesize'));
  assert.ok(!tex6.includes('p25'), 'Compact 6-col summary omits p25/p75');
});

// =========================================================================
// FIXTURE H: High-precision double (123456.789012345), 16-digit text ID,
//            asdouble + full stringcols(), capture-guarded diagnostics,
//            and Original Source limitations audit
// =========================================================================
test('Fixture H: High-precision double, 16-digit text ID, asdouble + full stringcols, and capture-guarded optional diagnostics', () => {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { WBProps: { date1904: true } };
  const ws: XLSX.WorkSheet = {
    '!ref': 'A1:E4',
    A1: { t: 's', v: 'region_code' },
    B1: { t: 's', v: 'long_text_id' },
    C1: { t: 's', v: 'high_precision_val' },
    D1: { t: 's', v: 'obs_date' },
    E1: { t: 's', v: 'y_val' },
    A2: { t: 'n', v: 123, z: '00000', w: '00123' },
    B2: { t: 's', v: '9007199254740993' },
    C2: { t: 'n', v: 123456.789012345, z: '0.00', w: '123456.79' },
    D2: { t: 'n', v: 43479, z: 'yyyy-mm-dd' },
    E2: { t: 'n', v: 10.5 },
    A3: { t: 'n', v: 45, z: '00000', w: '00045' },
    B3: { t: 's', v: '9007199254740994' },
    C3: { t: 'n', v: 234567.890123456, z: '0.00', w: '234567.89' },
    D3: { t: 'n', v: 43510, z: 'yyyy-mm-dd' },
    E3: { t: 'n', v: 12.25 },
    A4: { t: 'n', v: 9, z: '00000', w: '00009' },
    B4: { t: 's', v: '9007199254740995' },
    C4: { t: 'n', v: 345678.901234567, z: '0.00', w: '345678.90' },
    D4: { t: 'n', v: 43540, z: 'yyyy-mm-dd' },
    E4: { t: 'n', v: 14.75 },
  };
  XLSX.utils.book_append_sheet(wb, ws, 'Data');

  const handle = readExcelWorkbook(wbToArrayBuffer(wb), 'high_precision_1904.xlsx');
  assert.equal(handle.excelDateSystem, '1904');
  const ds = parseExcelSheet(handle, 'Data');

  assert.equal(ds.rows[0].high_precision_val, '123456.789012345');
  assert.equal(ds.rows[0].long_text_id, '9007199254740993');
  assert.equal(ds.rows[0].region_code, '00123');
  assert.equal(ds.rows[0].obs_date, '2023-01-15');

  const longIdCol = ds.columns.find((c) => c.stataName === 'long_text_id')!;
  assert.equal(longIdCol.type, 'string');
  assert.equal(longIdCol.preserveLongId, true);

  const spec: ModelSpec = {
    ...createInitialModelSpec(ds),
    depVar: 'y_val',
    indepVars: ['high_precision_val'],
    estimator: 'ols',
    seType: 'robust',
    diagnostics: { vif: false, breuschPagan: true, hausman: false, esttab: true },
  };
  const { impact } = buildCleanedRowsAndImpact(ds, spec);
  const doBundle = generateStataDoFile(ds, spec, impact);

  assert.ok(doBundle.includes('set type double'), 'Must set type double');
  assert.ok(doBundle.includes('asdouble'), 'Normalized bundle import must specify asdouble');
  assert.ok(
    doBundle.includes('stringcols(1 2 4)'),
    'Normalized bundle must pass stringcols() for ALL non-numeric columns (region_code, long_text_id, obs_date)'
  );
  assert.ok(doBundle.includes('capture noisily {'), 'Optional diagnostics must be capture-guarded');
  assert.ok(doBundle.includes('estimates restore m_main'), 'Must restore m_main before esttab');

  const limitations = getOriginalSourceLimitations(ds);
  assert.ok(
    limitations.some((l) => l.includes('1904')),
    'Original Source limitations must call out 1904 Excel date system'
  );
  assert.ok(
    limitations.some((l) => l.includes('region_code')),
    'Original Source limitations must call out zero-padded IDs'
  );
});

// =========================================================================
// FIXTURE I: Key validity vs. Strongly Balanced vs. Weakly Balanced vs. Unbalanced
// =========================================================================
test('Fixture I: Strictly distinguishes invalid keys, strongly balanced, weakly balanced, and unbalanced panels', () => {
  // Weakly balanced: 2 units, each observed in exactly 2 periods, across 3 distinct periods (2020, 2021, 2022)
  const weakCsv = [
    'firm_id,year,sales',
    'F1,2020,100',
    'F1,2021,110',
    'F2,2021,200',
    'F2,2022,220',
  ].join('\n');
  const weakDs = parseCsvText(weakCsv, 'weakly_balanced.csv', false);
  assert.equal(weakDs.panel.panelKeyStatus, 'valid');
  assert.equal(weakDs.panel.balanceStatus, 'weakly_balanced');
  assert.equal(weakDs.panel.isBalanced, false);
  assert.ok(formatPanelStatusHeadline(weakDs.panel).includes('Weakly balanced'));
  assert.ok(describePanelForSample(weakDs.panel).includes('weakly balanced'));

  // Unbalanced with valid keys: F1 has 3 periods, F2 has 2 periods
  const unbalCsv = [
    'firm_id,year,sales',
    'F1,2020,100',
    'F1,2021,110',
    'F1,2022,120',
    'F2,2021,200',
    'F2,2022,220',
  ].join('\n');
  const unbalDs = parseCsvText(unbalCsv, 'unbalanced_valid.csv', false);
  assert.equal(unbalDs.panel.panelKeyStatus, 'valid');
  assert.equal(unbalDs.panel.balanceStatus, 'unbalanced');
  assert.ok(describePanelForSample(unbalDs.panel).includes('valid keys, unbalanced'));

  // Confirmed keys that are invalid on current rows (demo with duplicates drop OFF)
  const demo = parseCsvText(generateDemoHousingCsv(), 'us_metro_housing_panel.csv', true);
  assert.equal(demo.panel.userConfirmed, true);
  assert.equal(demo.panel.panelKeyStatus, 'invalid_repeated_keys');
  assert.equal(demo.panel.balanceStatus, 'undefined_invalid_keys');
  const headline = formatPanelStatusHeadline(demo.panel, 'raw rows');
  assert.ok(headline.includes('Keys confirmed, invalid on raw rows'));
  assert.ok(headline.includes('Balance undefined'));
});

// =========================================================================
// FIXTURE J: Reproducible ZIP Bundle & CRC-32 Integrity Verification
//            (Housing Demo Bundle + Synthetic Precision/Keys Fixture Bundle)
// =========================================================================
test('Fixture J1: Housing Demo Stata verification ZIP passes PKZIP/CRC-32 check and asserts 453 -> 450 -> 30x15 -> 406', () => {
  const bundle = buildHousingDemoVerificationBundle();
  const entries = verifyAndParseZipBytes(bundle.bytes);
  const names = entries.map((e) => e.name).sort();

  assert.deepEqual(names, [
    'README.txt',
    'us_metro_housing_panel_analysis.do',
    'us_metro_housing_panel_normalized.csv',
    'us_metro_housing_panel_verify.do',
  ]);
  for (const e of entries) {
    assert.equal(e.crcValid, true, `CRC-32 mismatch for ${e.name}`);
    assert.ok(e.size > 0, `Empty ZIP entry ${e.name}`);
  }

  const verifyDo = entries.find((e) => e.name === 'us_metro_housing_panel_verify.do')!.text;
  assert.ok(verifyDo.includes('asdouble'), 'Demo verify .do must use asdouble');
  assert.ok(verifyDo.includes('assert _N == 453'), 'Must assert 453 raw rows');
  assert.ok(verifyDo.includes('assert _N == 450'), 'Must assert 450 cleaned rows after 3 duplicates dropped');
  assert.ok(verifyDo.includes('assert r(r) == 30'), 'Must assert 30 metro entities');
  assert.ok(verifyDo.includes('assert r(r) == 15'), 'Must assert 15 years');
  assert.ok(verifyDo.includes('assert _N == 450   // Strongly balanced 30 x 15'));
  assert.ok(verifyDo.includes('assert r(N) == 406'), 'Must assert 406 pre-estimation complete cases');
  assert.ok(verifyDo.includes('Fitted e(N)'), 'Must print fitted e(N) separately');
});

test('Fixture J2: Synthetic Precision & Keys Fixture ZIP passes PKZIP/CRC-32 check and verifies .xlsx + literal double/ID/date assertions', () => {
  const bundle = buildPrecisionKeysFixtureBundle();
  const entries = verifyAndParseZipBytes(bundle.bytes);
  const names = entries.map((e) => e.name).sort();

  assert.deepEqual(names, [
    'README.txt',
    'folio_precision_keys_fixture.xlsx',
    'folio_precision_keys_fixture_analysis.do',
    'folio_precision_keys_fixture_normalized.csv',
    'folio_precision_keys_fixture_verify.do',
  ]);
  for (const e of entries) {
    assert.equal(e.crcValid, true, `CRC-32 mismatch for ${e.name}`);
    assert.ok(e.size > 0, `Empty ZIP entry ${e.name}`);
  }

  // Re-read the bundled .xlsx back through SheetJS 0.20.3!
  const xlsxEntry = entries.find((e) => e.name === 'folio_precision_keys_fixture.xlsx')!;
  const xlsxBuf = new Uint8Array(new ArrayBuffer(xlsxEntry.bytes.byteLength));
  xlsxBuf.set(xlsxEntry.bytes);
  const wbHandle = readExcelWorkbook(xlsxBuf.buffer, xlsxEntry.name);
  assert.deepEqual(wbHandle.sheetNames, ['README', 'Analysis']);
  const reparsedXlsx = parseExcelSheet(wbHandle, 'Analysis');
  assert.equal(reparsedXlsx.rowCount, 6);
  assert.equal(reparsedXlsx.rows[0].high_precision_val, '123456.789012345');
  assert.equal(reparsedXlsx.rows[0].policy_rate, '13.5');
  assert.equal(reparsedXlsx.rows[0].region_code, '00123');
  assert.equal(reparsedXlsx.rows[0].long_text_id, '9007199254740993');

  const verifyDo = entries.find((e) => e.name === 'folio_precision_keys_fixture_verify.do')!.text;
  assert.ok(verifyDo.includes('assert reldif(high_precision_val[1], 123456.789012345) < 1e-12'));
  assert.ok(verifyDo.includes('assert reldif(policy_rate[1], 13.5) < 1e-12'));
  assert.ok(verifyDo.includes('assert region_code[1] == "00123"'));
  assert.ok(verifyDo.includes('assert long_text_id[1] == "9007199254740993"'));
  assert.ok(verifyDo.includes('confirm variable house_price'));
  assert.ok(verifyDo.includes('confirm variable house_price_2'));
  assert.ok(verifyDo.includes('assert obs_date_dt[1] == td(15jan2023)'));
  assert.ok(verifyDo.includes('assert obs_month_dt[1] == tm(2023m1)'));
  assert.ok(verifyDo.includes('assert obs_quarter_dt[1] == tq(2023q1)'));
  assert.ok(verifyDo.includes('assert _N == 6'));
  assert.ok(verifyDo.includes('assert _N == 5'));
  assert.ok(verifyDo.includes('assert r(N) == 4'));
});

console.log(`\nSummary: ${passed} passed, ${failures.length} failed.\n`);
if (failures.length > 0) {
  process.exit(1);
}
