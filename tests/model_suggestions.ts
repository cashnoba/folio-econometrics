import assert from 'node:assert/strict';
import { evaluatePanelStructure, parseCsvText } from '../src/lib/parser';
import { buildCleanedRowsAndImpact } from '../src/lib/statistics';
import { createInitialModelSpec } from '../src/lib/specValidator';
import {
  buildModelSuggestions,
  createInitialResearcherConfirmations,
} from '../src/lib/modelSuggestions';

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('\nFolio Econometrics — Model Suggestions Synthetic Suite (7 Cases)\n');

// ---------------------------------------------------------------------------
// Case 1: Valid panel
// ---------------------------------------------------------------------------
runTest('Case 1: Valid panel suggests OLS, Entity FE, and Two-Way FE as implemented_ready', () => {
  const rows = ['firm_id,year,revenue,rd_spend,employees'];
  for (let f = 1; f <= 5; f++) {
    for (let y = 2019; y <= 2022; y++) {
      const rev = 100 + f * 15 + (y - 2019) * 8 + (f % 2) * (y - 2019) * 3;
      const rd = 10 + f * 2 + (y - 2019) * 1.5 + (f === 2 && y === 2021 ? 4 : 0);
      const emp = 50 + f * 5 + (y - 2019) * 2 + (f === 3 ? y - 2019 : 0);
      rows.push(`F${f},${y},${rev},${rd},${emp}`);
    }
  }
  const ds = parseCsvText(rows.join('\n'), 'valid_panel.csv');
  ds.panel = evaluatePanelStructure(
    ds.rows,
    ds.columns,
    'firm_id',
    'year',
    'Confirmed valid panel',
    true,
    'panel',
    'firm_id',
    'year'
  );
  const spec = createInitialModelSpec(ds);
  const { cleanedRows, impact } = buildCleanedRowsAndImpact(ds, spec);

  const confirmations = {
    ...createInitialResearcherConfirmations(ds, cleanedRows, impact.cleanedPanel, spec),
    outcomeVar: 'revenue',
    confirmedOutcomeType: 'continuous' as const,
    selectedRegressors: ['rd_spend', 'employees'],
  };

  const report = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, confirmations);
  assert.equal(report.structureAudit.structure, 'candidate_panel');
  assert.equal(report.outcomeRequiresConfirmation, false);

  const ols = report.recommendations.find((r) => r.id === 'ols_baseline');
  const fe = report.recommendations.find((r) => r.id === 'panel_entity_fe');
  const twfe = report.recommendations.find((r) => r.id === 'panel_twoway_fe');

  assert.ok(ols && ols.implementationStatus === 'implemented_ready' && ols.builderSpecDraft?.estimator === 'ols');
  assert.ok(fe && fe.implementationStatus === 'implemented_ready' && fe.builderSpecDraft?.estimator === 'fe_xtreg');
  assert.ok(twfe && twfe.implementationStatus === 'implemented_ready' && twfe.builderSpecDraft?.estimator === 'fe_reghdfe');
  assert.equal(report.feVariationChecks.every((c) => !c.absorbedByEntityFe && !c.absorbedByTimeFe), true);
});

// ---------------------------------------------------------------------------
// Case 2: Invalid repeated-key panel
// ---------------------------------------------------------------------------
runTest('Case 2: Invalid repeated-key panel blocks xtreg/TWFE while keeping OLS implemented_ready', () => {
  const csv = [
    'city,year,wage,education,experience',
    'A,2020,45.2,12,5',
    'A,2020,52.8,16,9', // Distinct record sharing (A, 2020)
    'A,2021,48.1,13,6',
    'B,2020,41.0,11,4',
    'B,2021,43.5,14,7',
    'C,2020,55.0,16,10',
    'C,2021,57.2,17,11',
  ].join('\n');
  const ds = parseCsvText(csv, 'repeated_key_panel.csv');
  // Researcher forces panel keys (city, year) despite repeated keys
  ds.panel = evaluatePanelStructure(
    ds.rows,
    ds.columns,
    'city',
    'year',
    'Researcher selected repeated panel keys',
    true,
    'panel',
    'city',
    'year'
  );
  const spec = createInitialModelSpec(ds);
  const { cleanedRows, impact } = buildCleanedRowsAndImpact(ds, spec);

  const confirmations = {
    ...createInitialResearcherConfirmations(ds, cleanedRows, impact.cleanedPanel, spec),
    outcomeVar: 'wage',
    confirmedOutcomeType: 'continuous' as const,
    selectedRegressors: ['education', 'experience'],
  };

  const report = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, confirmations);
  assert.equal(report.structureAudit.structure, 'candidate_panel');
  assert.equal(impact.cleanedPanel.panelKeyStatus, 'invalid_repeated_keys');

  const ols = report.recommendations.find((r) => r.id === 'ols_baseline');
  const fe = report.recommendations.find((r) => r.id === 'panel_entity_fe');
  const twfe = report.recommendations.find((r) => r.id === 'panel_twoway_fe');

  assert.equal(ols?.implementationStatus, 'implemented_ready');
  assert.equal(ols?.builderSpecDraft?.estimator, 'ols');
  assert.equal(fe?.implementationStatus, 'implemented_blocked');
  assert.equal(fe?.builderSpecDraft, undefined);
  assert.match(fe?.blockedReason ?? '', /invalid|repeated/i);
  assert.equal(twfe?.implementationStatus, 'implemented_blocked');
  assert.equal(twfe?.builderSpecDraft, undefined);
});

// ---------------------------------------------------------------------------
// Case 3: Dated loan-level cross-section
// ---------------------------------------------------------------------------
runTest('Case 3: Dated loan-level cross-section retains observation-level OLS & group/period reghdfe without xtset', () => {
  const csv = [
    'loan_id,district,month,interest_rate,loan_amount,credit_score',
    'L001,North,2023-01,6.5,12000,710',
    'L002,North,2023-01,7.1,18500,680',
    'L003,North,2023-02,6.8,15000,700',
    'L004,South,2023-01,7.4,9500,665',
    'L005,South,2023-01,6.2,22000,740',
    'L006,South,2023-02,6.9,14200,695',
    'L007,East,2023-01,6.4,19000,720',
    'L008,East,2023-02,7.0,11300,675',
  ].join('\n');
  const ds = parseCsvText(csv, 'loan_level.csv');
  const spec = createInitialModelSpec(ds);
  const { cleanedRows, impact } = buildCleanedRowsAndImpact(ds, spec);

  const confirmations = {
    ...createInitialResearcherConfirmations(ds, cleanedRows, impact.cleanedPanel, spec),
    outcomeVar: 'interest_rate',
    confirmedOutcomeType: 'continuous' as const,
    selectedRegressors: ['loan_amount', 'credit_score'],
  };

  const report = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, confirmations);
  assert.equal(report.structureAudit.structure, 'dated_cross_section');
  assert.equal(report.structureAudit.uniqueRecordIdVar, 'loan_id');

  const ols = report.recommendations.find((r) => r.id === 'ols_baseline');
  const groupFe = report.recommendations.find((r) => r.id === 'dated_cs_group_fe');
  const xtreg = report.recommendations.find((r) => r.id === 'panel_entity_fe');

  assert.equal(ols?.implementationStatus, 'implemented_ready');
  assert.equal(groupFe?.implementationStatus, 'implemented_ready');
  assert.equal(groupFe?.builderSpecDraft?.estimator, 'fe_reghdfe');
  assert.equal(xtreg, undefined, 'Must not suggest xtreg for dated cross-section');
});

// ---------------------------------------------------------------------------
// Case 4: Confirmed binary outcome
// ---------------------------------------------------------------------------
runTest('Case 4: Confirmed binary outcome recommends Logit/Probit as guidance_only with no builder draft', () => {
  const csv = [
    'person_id,defaulted,income,debt_ratio',
    'P1,0,62000,0.22',
    'P2,1,31000,0.58',
    'P3,0,74000,0.19',
    'P4,1,28000,0.64',
    'P5,0,81000,0.15',
    'P6,1,35000,0.51',
    'P7,0,59000,0.27',
    'P8,0,67000,0.24',
  ].join('\n');
  const ds = parseCsvText(csv, 'binary_defaults.csv');
  const spec = createInitialModelSpec(ds);
  const { cleanedRows, impact } = buildCleanedRowsAndImpact(ds, spec);

  // Initially low-cardinality {0, 1} must require confirmation
  const initial = createInitialResearcherConfirmations(ds, cleanedRows, impact.cleanedPanel, {
    ...spec,
    depVar: 'defaulted',
  });
  assert.equal(initial.confirmedOutcomeType, null, '{0,1} numeric column must not auto-confirm');

  const reportBefore = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, initial);
  assert.equal(reportBefore.outcomeRequiresConfirmation, true);
  assert.equal(reportBefore.recommendations.length, 0);

  // Once confirmed as binary with event value '1'
  const reportAfter = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, {
    ...initial,
    confirmedOutcomeType: 'binary',
    binaryEventValue: '1',
    selectedRegressors: ['income', 'debt_ratio'],
  });
  assert.equal(reportAfter.outcomeRequiresConfirmation, false);
  const logit = reportAfter.recommendations.find((r) => r.id === 'binary_logit_probit');
  assert.ok(logit);
  assert.equal(logit.implementationStatus, 'guidance_only');
  assert.equal(logit.builderSpecDraft, undefined);
  assert.ok(logit.reasons.some((r) => r.includes('"1"')));
});

// ---------------------------------------------------------------------------
// Case 5: Count outcome with differing exposure
// ---------------------------------------------------------------------------
runTest('Case 5: Count outcome verifies non-negative integers and incorporates exposure guidance', () => {
  const csv = [
    'clinic_id,er_visits,patient_years,median_age,staff_ratio',
    'C1,0,120,38.5,1.2',
    'C2,3,240,42.1,1.1',
    'C3,7,500,49.3,0.9',
    'C4,2,180,36.8,1.4',
    'C5,11,620,53.2,0.8',
    'C6,5,310,44.0,1.0',
    'C7,1,150,35.2,1.5',
    'C8,9,480,50.7,0.95',
    'C9,4,290,41.6,1.15',
    'C10,6,375,46.4,1.05',
  ].join('\n');
  const ds = parseCsvText(csv, 'clinic_counts.csv');
  const spec = createInitialModelSpec(ds);
  const { cleanedRows, impact } = buildCleanedRowsAndImpact(ds, spec);

  const report = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, {
    structureConfirmed: false,
    outcomeVar: 'er_visits',
    confirmedOutcomeType: 'count',
    binaryEventValue: null,
    countHasDifferingExposure: 'yes',
    countExposureVar: 'patient_years',
    researchAim: 'description',
    selectedRegressors: ['median_age', 'staff_ratio'],
  });

  assert.equal(report.countNonNegativeIntegerCheck.checked, true);
  assert.equal(report.countNonNegativeIntegerCheck.passed, true);
  const poisson = report.recommendations.find((r) => r.id === 'count_poisson_ppml');
  assert.ok(poisson);
  assert.equal(poisson.implementationStatus, 'guidance_only');
  assert.equal(poisson.builderSpecDraft, undefined);
  assert.ok(poisson.reasons.some((r) => r.includes('exposure(patient_years)')));
});

// ---------------------------------------------------------------------------
// Case 6: Low-cardinality numeric category (1/2/3/4)
// ---------------------------------------------------------------------------
runTest('Case 6: Low-cardinality numeric category stays ambiguous until confirmed as nominal/ordinal', () => {
  const csv = [
    'resp_id,satisfaction_code,age,income',
    'R1,1,24,32000',
    'R2,2,31,45000',
    'R3,3,44,61000',
    'R4,4,52,79000',
    'R5,2,29,39000',
    'R6,3,38,54000',
    'R7,4,60,88000',
    'R8,1,22,29000',
  ].join('\n');
  const ds = parseCsvText(csv, 'likert_codes.csv');
  const spec = createInitialModelSpec(ds);
  const { cleanedRows, impact } = buildCleanedRowsAndImpact(ds, spec);

  const initial = createInitialResearcherConfirmations(ds, cleanedRows, impact.cleanedPanel, {
    ...spec,
    depVar: 'satisfaction_code',
  });
  assert.equal(initial.confirmedOutcomeType, null);

  const unconfirmedReport = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, initial);
  assert.equal(unconfirmedReport.activeOutcomeAudit?.inferredOutcomeType, 'ambiguous_low_cardinality_numeric');
  assert.equal(unconfirmedReport.activeOutcomeAudit?.isLowCardinalityNumeric, true);
  assert.equal(unconfirmedReport.outcomeRequiresConfirmation, true);
  assert.equal(unconfirmedReport.recommendations.length, 0);

  // Confirm as ordinal
  const ordinalReport = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, {
    ...initial,
    confirmedOutcomeType: 'ordinal',
    selectedRegressors: ['age', 'income'],
  });
  assert.equal(ordinalReport.outcomeRequiresConfirmation, false);
  const ologit = ordinalReport.recommendations.find((r) => r.id === 'ordinal_ologit');
  assert.ok(ologit && ologit.implementationStatus === 'guidance_only' && !ologit.builderSpecDraft);

  // Confirm as nominal
  const nominalReport = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, {
    ...initial,
    confirmedOutcomeType: 'nominal',
    selectedRegressors: ['age', 'income'],
  });
  const mlogit = nominalReport.recommendations.find((r) => r.id === 'nominal_mlogit');
  assert.ok(mlogit && mlogit.implementationStatus === 'guidance_only' && !mlogit.builderSpecDraft);
});

// ---------------------------------------------------------------------------
// Case 7: Regressor absorbed by chosen fixed effects (entity FE & time FE)
// ---------------------------------------------------------------------------
runTest('Case 7: Detects time-invariant & time-only regressors absorbed by entity/time FE and excludes them from FE drafts', () => {
  const rows = ['state,year,gdp_growth,coastal_area_km2,national_rate,local_investment'];
  const areas: Record<string, number> = { S1: 120, S2: 340, S3: 210, S4: 480 };
  const natRates: Record<number, number> = { 2020: 1.5, 2021: 2.25, 2022: 4.5 };
  let idx = 0;
  for (const s of ['S1', 'S2', 'S3', 'S4']) {
    for (const y of [2020, 2021, 2022]) {
      idx++;
      const inv = 10 + idx * 1.7 + (s === 'S2' && y === 2022 ? 5 : 0);
      const gdp = 2.0 + 0.1 * inv - 0.3 * natRates[y] + 0.002 * areas[s];
      rows.push(`${s},${y},${gdp.toFixed(3)},${areas[s]},${natRates[y]},${inv.toFixed(2)}`);
    }
  }
  const ds = parseCsvText(rows.join('\n'), 'fe_absorption.csv');
  ds.panel = evaluatePanelStructure(
    ds.rows,
    ds.columns,
    'state',
    'year',
    'Confirmed panel',
    true,
    'panel',
    'state',
    'year'
  );
  const spec = createInitialModelSpec(ds);
  const { cleanedRows, impact } = buildCleanedRowsAndImpact(ds, spec);

  const report = buildModelSuggestions(ds, cleanedRows, impact.cleanedPanel, {
    structureConfirmed: true,
    outcomeVar: 'gdp_growth',
    confirmedOutcomeType: 'continuous',
    binaryEventValue: null,
    countHasDifferingExposure: 'unknown',
    countExposureVar: null,
    researchAim: 'causal',
    selectedRegressors: ['coastal_area_km2', 'national_rate', 'local_investment'],
  });

  const coastalCheck = report.feVariationChecks.find((c) => c.variable === 'coastal_area_km2');
  const natRateCheck = report.feVariationChecks.find((c) => c.variable === 'national_rate');
  const localInvCheck = report.feVariationChecks.find((c) => c.variable === 'local_investment');

  assert.equal(coastalCheck?.absorbedByEntityFe, true);
  assert.equal(coastalCheck?.absorbedByTimeFe, false);
  assert.equal(natRateCheck?.absorbedByEntityFe, false);
  assert.equal(natRateCheck?.absorbedByTimeFe, true);
  assert.equal(localInvCheck?.absorbedByEntityFe, false);
  assert.equal(localInvCheck?.absorbedByTimeFe, false);

  const entityFe = report.recommendations.find((r) => r.id === 'panel_entity_fe');
  const twfe = report.recommendations.find((r) => r.id === 'panel_twoway_fe');

  assert.ok(entityFe && entityFe.absorptionWarnings.some((w) => w.includes('coastal_area_km2')));
  assert.deepEqual(entityFe?.builderSpecDraft?.indepVars, ['national_rate', 'local_investment']);

  assert.ok(twfe && twfe.absorptionWarnings.some((w) => w.includes('coastal_area_km2')));
  assert.ok(twfe && twfe.absorptionWarnings.some((w) => w.includes('national_rate')));
  assert.deepEqual(twfe?.builderSpecDraft?.indepVars, ['local_investment']);
});

console.log(`\nModel Suggestions Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
