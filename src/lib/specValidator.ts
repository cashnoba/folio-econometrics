import type {
  DatasetState,
  DiagnosticCompatibility,
  DiagnosticsReport,
  EstimatorType,
  LogTransformMode,
  ModelSpec,
  PostDedupPanelCheck,
  SpecDiffItem,
  SpecProposalPatch,
  StandardErrorType,
  ValidatedProposal,
} from '../types/econometrics';

export function createInitialModelSpec(dataset: DatasetState): ModelSpec {
  // Built-in US Metropolitan Housing Panel ships preconfigured so users immediately see the complete workflow.
  if (dataset.isDemo) {
    const colSet = new Set(dataset.columns.map((c) => c.stataName));
    const indep = ['median_income', 'sqft', 'mortgage_rate', 'unemployment_rate', 'property_tax_rate', 'school_rating'].filter(
      (v) => colSet.has(v)
    );
    return {
      importMode: 'normalized_bundle',
      dropExactDuplicates: true,
      winsorizeVars: colSet.has('house_price') ? ['house_price'] : [],
      winsorizeLevel: 1,
      logTransforms: colSet.has('house_price') ? { house_price: 'ln' } : {},
      estimator: 'fe_reghdfe',
      depVar: colSet.has('house_price') ? 'house_price' : null,
      indepVars: indep,
      absorbVars: [dataset.panel.entityVar, dataset.panel.timeVar].filter((v): v is string => Boolean(v)),
      seType: 'cluster_entity',
      diagnostics: {
        vif: true,
        breuschPagan: false,
        hausman: true,
        esttab: true,
      },
    };
  }

  // On user-uploaded files, leave modeling choices explicitly to the researcher.
  return {
    importMode: 'normalized_bundle',
    dropExactDuplicates: false,
    winsorizeVars: [],
    winsorizeLevel: 1,
    logTransforms: {},
    estimator: 'ols',
    depVar: null,
    indepVars: [],
    absorbVars: [],
    seType: 'robust',
    diagnostics: {
      vif: false,
      breuschPagan: false,
      hausman: false,
      esttab: true,
    },
  };
}

/**
 * Evaluates Stata post-estimation compatibility for VIF, Breusch-Pagan, Hausman,
 * and xtreg given active estimator, VCE, confirmed panel keys, and post-dedup uniqueness.
 */
export function getDiagnosticCompatibility(
  dataset: DatasetState,
  spec: ModelSpec,
  postDedupCheck?: PostDedupPanelCheck
): DiagnosticCompatibility {
  const hasModel = Boolean(spec.depVar && spec.indepVars.length > 0);
  const hasMultipleRegressors = spec.indepVars.length >= 2;

  const panelConfirmed = Boolean(
    dataset.panel.userConfirmed &&
      dataset.panel.isPanel &&
      dataset.panel.entityVar &&
      dataset.panel.timeVar
  );
  const dupPairsAfterDedup = postDedupCheck?.checked
    ? postDedupCheck.duplicateKeyPairs
    : dataset.panel.duplicateKeyPairs;
  const repeatedGroupsAfterDedup = postDedupCheck?.checked
    ? postDedupCheck.repeatedKeyGroups
    : dataset.panel.repeatedKeyGroups;
  const missingKeysAfterDedup = postDedupCheck?.checked
    ? postDedupCheck.missingKeyRows
    : dataset.panel.missingKeyRows;

  let xtregAllowed = true;
  let xtregBlockReason: string | null = null;
  if (!dataset.panel.isPanel || !dataset.panel.entityVar || !dataset.panel.timeVar) {
    xtregAllowed = false;
    xtregBlockReason =
      dataset.panel.structureKind === 'dated_cross_section'
        ? 'Detected as a dated cross-section (distinct records share entity-time keys). OLS remains available without xtset.'
        : 'Requires confirmed panel entity and time keys. OLS remains available without xtset.';
  } else if (!dataset.panel.userConfirmed) {
    xtregAllowed = false;
    xtregBlockReason =
      'Confirm panel keys in Inspector before enabling xtset / xtreg. OLS remains available.';
  } else if (missingKeysAfterDedup > 0) {
    xtregAllowed = false;
    xtregBlockReason = `${missingKeysAfterDedup} row(s) have missing (${dataset.panel.entityVar}, ${dataset.panel.timeVar}) keys.`;
  } else if (dupPairsAfterDedup > 0) {
    xtregAllowed = false;
    xtregBlockReason = `${repeatedGroupsAfterDedup} repeated key group(s) (${dupPairsAfterDedup} excess rows) remain after deduplication; Stata xtset rejects repeated time values (r(451)). OLS remains exportable without xtset.`;
  }

  // VIF (estat vif)
  let vifMode: DiagnosticCompatibility['vifMode'] = 'unavailable';
  let vifNote = 'Select a dependent variable and at least 2 regressors to compute VIF.';
  if (hasModel && hasMultipleRegressors) {
    if (spec.estimator === 'ols') {
      vifMode = 'direct';
      vifNote = 'Runs directly after OLS (estat vif).';
    } else {
      vifMode = 'auxiliary_ols';
      vifNote =
        'Stata estat vif only runs after regress. The .do script emits an auxiliary quietly reg block for collinearity screening.';
    }
  } else if (hasModel && !hasMultipleRegressors) {
    vifNote = 'VIF requires at least 2 independent regressors.';
  }

  // Breusch-Pagan / Cook-Weisberg (estat hettest)
  let bpMode: DiagnosticCompatibility['bpMode'] = 'unavailable';
  let bpNote = 'Select a dependent variable and at least 1 regressor.';
  if (hasModel) {
    if (spec.estimator === 'ols' && spec.seType === 'default') {
      bpMode = 'direct';
      bpNote = 'Runs directly after homoskedastic OLS (estat hettest).';
    } else {
      bpMode = 'auxiliary_ols';
      bpNote =
        spec.estimator !== 'ols'
          ? 'Stata estat hettest requires non-robust OLS. The .do script emits an auxiliary quietly reg block without vce() for the test.'
          : 'Stata estat hettest is not permitted after vce(robust) or vce(cluster). The .do script runs an auxiliary unweighted reg block.';
    }
  }

  // Classical Hausman test (hausman fe re)
  let hausmanMode: DiagnosticCompatibility['hausmanMode'] = 'unavailable';
  let hausmanNote = 'Requires confirmed, unique non-missing panel keys and a specified model.';
  if (hasModel) {
    if (!panelConfirmed) {
      hausmanNote =
        'Confirm panel entity and time keys in the Inspector to enable Hausman FE vs. RE testing.';
    } else if (missingKeysAfterDedup > 0) {
      hausmanNote = `Blocked: ${missingKeysAfterDedup} row(s) have missing panel keys.`;
    } else if (dupPairsAfterDedup > 0) {
      hausmanNote = `Blocked: ${repeatedGroupsAfterDedup} repeated key group(s) (${dupPairsAfterDedup} excess rows) remain after deduplication (xtset r(451)).`;
    } else if (
      (spec.estimator === 'fe_xtreg' || spec.estimator === 're_xtreg') &&
      spec.seType === 'default'
    ) {
      hausmanMode = 'direct';
      hausmanNote = 'Runs classical FE vs. RE Hausman test (hausman fe_hausman re_hausman, sigmamore).';
    } else {
      hausmanMode = 'classical_block';
      hausmanNote =
        'Classical hausman requires non-robust xtreg FE and RE models. The .do script emits a dedicated quietly xtreg FE/RE block (with Mundlak / clustered-SE caution).';
    }
  }

  return {
    vifMode,
    vifNote,
    bpMode,
    bpNote,
    hausmanMode,
    hausmanNote,
    xtregAllowed,
    xtregBlockReason,
  };
}

export function formatEstimatorLabel(e: EstimatorType): string {
  switch (e) {
    case 'ols':
      return 'OLS (regress)';
    case 'fe_xtreg':
      return 'Panel Fixed Effects (xtreg, fe)';
    case 'fe_reghdfe':
      return 'High-Dimensional FE (reghdfe)';
    case 're_xtreg':
      return 'Panel Random Effects (xtreg, re)';
  }
}

export function formatSeLabel(se: StandardErrorType): string {
  switch (se) {
    case 'default':
      return 'Classical (Homoskedastic)';
    case 'robust':
      return 'Heteroskedasticity-Robust (HC1)';
    case 'cluster_entity':
      return 'Clustered by Entity';
    case 'cluster_twoway':
      return 'Two-Way Clustered (Entity & Time)';
  }
}

export function getTransformedVarName(varName: string, mode?: LogTransformMode): string {
  if (!mode) return varName;
  if (mode === 'ln') return `ln_${varName}`;
  if (mode === 'ln1p') return `ln1p_${varName}`;
  return `asinh_${varName}`;
}

/**
 * Validates an AI-proposed ModelSpec patch against the active dataset and the exact
 * same rules as manual edits, returning a safe nextSpec and field-by-field diff.
 */
export function validateProposalAgainstDataset(
  dataset: DatasetState,
  currentSpec: ModelSpec,
  patch: SpecProposalPatch,
  postDedupCheck?: PostDedupPanelCheck
): ValidatedProposal {
  const numericCols = new Set(dataset.columns.filter((c) => c.type === 'numeric').map((c) => c.stataName));
  const allCols = new Set(dataset.columns.map((c) => c.stataName));
  const colByName = new Map(dataset.columns.map((c) => [c.stataName, c]));

  const nextSpec: ModelSpec = {
    ...currentSpec,
    winsorizeVars: [...currentSpec.winsorizeVars],
    logTransforms: { ...currentSpec.logTransforms },
    indepVars: [...currentSpec.indepVars],
    absorbVars: [...currentSpec.absorbVars],
    diagnostics: { ...currentSpec.diagnostics },
  };

  const validationNotes: string[] = [];

  if (typeof patch.dropExactDuplicates === 'boolean') {
    nextSpec.dropExactDuplicates = patch.dropExactDuplicates;
  }

  if (patch.winsorizeLevel === 1 || patch.winsorizeLevel === 5) {
    nextSpec.winsorizeLevel = patch.winsorizeLevel;
  }

  if (Array.isArray(patch.winsorizeVars)) {
    const valid = patch.winsorizeVars.filter((v) => {
      const col = colByName.get(v);
      return numericCols.has(v) && col && !col.isAllMissing && !col.isConstant;
    });
    const invalid = patch.winsorizeVars.filter((v) => !valid.includes(v));
    if (invalid.length > 0) {
      validationNotes.push(`Ignored unsuitable/unknown winsorize variable(s): ${invalid.join(', ')}.`);
    }
    nextSpec.winsorizeVars = Array.from(new Set(valid));
  }

  if (Array.isArray(patch.logTransforms)) {
    const updatedLogs: Record<string, LogTransformMode> = { ...nextSpec.logTransforms };
    for (const item of patch.logTransforms) {
      const col = colByName.get(item.variable);
      if (!numericCols.has(item.variable) || !col || col.isAllMissing) {
        validationNotes.push(`Ignored unknown/non-numeric log variable "${item.variable}".`);
        continue;
      }
      let mode: LogTransformMode =
        item.mode === 'ln1p' || item.mode === 'asinh' ? item.mode : 'ln';

      // Exact Stata log domain checks:
      // ln(x) requires x > 0; ln(x + 1) requires x > -1; asinh(x) accepts all real x.
      if (col.leqNegOneCount > 0 && mode !== 'asinh') {
        validationNotes.push(
          `"${item.variable}" contains ${col.leqNegOneCount} value(s) ≤ -1; switched transform to asinh() to preserve observations.`
        );
        mode = 'asinh';
      } else if (col.nonPositiveCount > 0 && col.leqNegOneCount === 0 && mode === 'ln') {
        validationNotes.push(
          `"${item.variable}" contains ${col.nonPositiveCount} value(s) in (-1, 0]; switched from ln(x) to ln(x + 1) to avoid missing values.`
        );
        mode = 'ln1p';
      }
      updatedLogs[item.variable] = mode;
    }
    nextSpec.logTransforms = updatedLogs;
  }

  const panelSafeForXtset = Boolean(
    postDedupCheck?.checked
      ? postDedupCheck.isSafeForXtset
      : dataset.panel.userConfirmed &&
          dataset.panel.isPanel &&
          dataset.panel.duplicateKeyPairs === 0 &&
          dataset.panel.missingKeyRows === 0
  );

  if (patch.estimator) {
    const allowed: EstimatorType[] = ['ols', 'fe_xtreg', 'fe_reghdfe', 're_xtreg'];
    if (allowed.includes(patch.estimator)) {
      if ((patch.estimator === 'fe_xtreg' || patch.estimator === 're_xtreg') && !panelSafeForXtset) {
        validationNotes.push(
          `Requested ${patch.estimator}, but panel keys must be confirmed, non-missing, and unique first; kept ${formatEstimatorLabel(currentSpec.estimator)}.`
        );
      } else {
        nextSpec.estimator = patch.estimator;
      }
    }
  }

  if (typeof patch.depVar === 'string' && patch.depVar.trim()) {
    const col = colByName.get(patch.depVar);
    if (numericCols.has(patch.depVar) && col && !col.isAllMissing && !col.isConstant) {
      nextSpec.depVar = patch.depVar;
    } else {
      validationNotes.push(
        `Ignored unsuitable dependent variable "${patch.depVar}" (must exist, be numeric, and vary).`
      );
    }
  }

  if (Array.isArray(patch.indepVars)) {
    const validX = patch.indepVars.filter((v) => {
      const col = colByName.get(v);
      return numericCols.has(v) && v !== nextSpec.depVar && col && !col.isAllMissing && !col.isConstant;
    });
    const invalidX = patch.indepVars.filter((v) => !validX.includes(v));
    if (invalidX.length > 0) {
      validationNotes.push(`Ignored unsuitable/unknown regressor(s): ${invalidX.join(', ')}.`);
    }
    if (validX.length > 0) {
      nextSpec.indepVars = Array.from(new Set(validX));
    }
  }

  // Ensure depVar is never also inside indepVars
  if (nextSpec.depVar) {
    nextSpec.indepVars = nextSpec.indepVars.filter((x) => x !== nextSpec.depVar);
  }

  if (Array.isArray(patch.absorbVars)) {
    const validFe = patch.absorbVars.filter((v) => {
      const col = colByName.get(v);
      return allCols.has(v) && col && !col.isAllMissing && !col.isConstant;
    });
    nextSpec.absorbVars = Array.from(new Set(validFe));
  } else if (nextSpec.estimator === 'fe_reghdfe' && nextSpec.absorbVars.length === 0) {
    nextSpec.absorbVars = [dataset.panel.entityVar, dataset.panel.timeVar].filter(
      (v): v is string => Boolean(v)
    );
  }

  if (patch.seType) {
    const allowedSe: StandardErrorType[] = ['default', 'robust', 'cluster_entity', 'cluster_twoway'];
    if (allowedSe.includes(patch.seType)) {
      if (
        (patch.seType === 'cluster_entity' || patch.seType === 'cluster_twoway') &&
        !dataset.panel.entityVar
      ) {
        validationNotes.push('Clustered SE requested without an entity key; fell back to robust SE.');
        nextSpec.seType = 'robust';
      } else if (patch.seType === 'cluster_twoway' && nextSpec.estimator !== 'fe_reghdfe') {
        validationNotes.push(
          'Two-way clustering in Stata is supported natively via reghdfe; switched SE to entity clustering.'
        );
        nextSpec.seType = 'cluster_entity';
      } else {
        nextSpec.seType = patch.seType;
      }
    }
  }

  if (patch.diagnostics) {
    if (typeof patch.diagnostics.vif === 'boolean') {
      nextSpec.diagnostics.vif = patch.diagnostics.vif;
    }
    if (typeof patch.diagnostics.breuschPagan === 'boolean') {
      nextSpec.diagnostics.breuschPagan = patch.diagnostics.breuschPagan;
    }
    if (typeof patch.diagnostics.hausman === 'boolean') {
      if (patch.diagnostics.hausman && !panelSafeForXtset) {
        validationNotes.push('Skipped Hausman test because confirmed unique panel keys are required for xtset.');
      } else {
        nextSpec.diagnostics.hausman = patch.diagnostics.hausman;
      }
    }
    if (typeof patch.diagnostics.esttab === 'boolean') {
      nextSpec.diagnostics.esttab = patch.diagnostics.esttab;
    }
  }

  // Build explicit human-readable diff against currentSpec
  const diffs: SpecDiffItem[] = [];
  if (currentSpec.estimator !== nextSpec.estimator) {
    diffs.push({
      field: 'Estimator',
      before: formatEstimatorLabel(currentSpec.estimator),
      after: formatEstimatorLabel(nextSpec.estimator),
    });
  }
  if (currentSpec.depVar !== nextSpec.depVar) {
    diffs.push({
      field: 'Dependent (Y)',
      before: currentSpec.depVar ?? 'None',
      after: nextSpec.depVar ?? 'None',
    });
  }
  if (currentSpec.indepVars.join(',') !== nextSpec.indepVars.join(',')) {
    diffs.push({
      field: 'Regressors (X)',
      before: currentSpec.indepVars.length ? currentSpec.indepVars.join(', ') : 'None',
      after: nextSpec.indepVars.length ? nextSpec.indepVars.join(', ') : 'None',
    });
  }
  if (currentSpec.absorbVars.join(',') !== nextSpec.absorbVars.join(',')) {
    diffs.push({
      field: 'Absorbed FEs',
      before: currentSpec.absorbVars.length ? currentSpec.absorbVars.join(', ') : 'None',
      after: nextSpec.absorbVars.length ? nextSpec.absorbVars.join(', ') : 'None',
    });
  }
  if (currentSpec.seType !== nextSpec.seType) {
    diffs.push({
      field: 'Standard Errors',
      before: formatSeLabel(currentSpec.seType),
      after: formatSeLabel(nextSpec.seType),
    });
  }
  if (currentSpec.dropExactDuplicates !== nextSpec.dropExactDuplicates) {
    diffs.push({
      field: 'Drop Exact Duplicates',
      before: currentSpec.dropExactDuplicates ? 'Enabled' : 'Disabled',
      after: nextSpec.dropExactDuplicates ? 'Enabled' : 'Disabled',
    });
  }
  const prevWin = currentSpec.winsorizeVars.length
    ? `${currentSpec.winsorizeVars.join(', ')} (${currentSpec.winsorizeLevel}%/${100 - currentSpec.winsorizeLevel}%)`
    : 'None';
  const nextWin = nextSpec.winsorizeVars.length
    ? `${nextSpec.winsorizeVars.join(', ')} (${nextSpec.winsorizeLevel}%/${100 - nextSpec.winsorizeLevel}%)`
    : 'None';
  if (prevWin !== nextWin) {
    diffs.push({ field: 'Winsorization', before: prevWin, after: nextWin });
  }
  const formatLogs = (m: Record<string, LogTransformMode>) => {
    const entries = Object.entries(m);
    return entries.length ? entries.map(([v, mode]) => `${mode}(${v})`).join(', ') : 'None';
  };
  if (formatLogs(currentSpec.logTransforms) !== formatLogs(nextSpec.logTransforms)) {
    diffs.push({
      field: 'Log Transforms',
      before: formatLogs(currentSpec.logTransforms),
      after: formatLogs(nextSpec.logTransforms),
    });
  }
  const formatDiag = (d: ModelSpec['diagnostics']) => {
    const active = [
      d.vif && 'VIF',
      d.breuschPagan && 'Breusch-Pagan',
      d.hausman && 'Hausman',
      d.esttab && 'esttab',
    ].filter(Boolean);
    return active.length ? active.join(', ') : 'None';
  };
  if (formatDiag(currentSpec.diagnostics) !== formatDiag(nextSpec.diagnostics)) {
    diffs.push({
      field: 'Stata Diagnostics',
      before: formatDiag(currentSpec.diagnostics),
      after: formatDiag(nextSpec.diagnostics),
    });
  }

  return {
    rawTitle: patch.summaryTitle || 'Proposed Econometric Specification Update',
    nextSpec,
    diffs,
    validationNotes,
    isValid: diffs.length > 0,
  };
}

/**
 * Builds the transparent, inspectable JSON metadata digest sent to Gemini
 * (never includes raw observation rows).
 */
export function buildDatasetDigestForAI(
  dataset: DatasetState,
  diagnostics: DiagnosticsReport,
  spec: ModelSpec
): Record<string, unknown> {
  const highCorrPairs: Array<{ pair: string; r: number; n: number }> = [];
  const vars = diagnostics.correlation.variables;
  for (let i = 0; i < vars.length; i++) {
    for (let j = i + 1; j < vars.length; j++) {
      const cell = diagnostics.correlation.matrix[vars[i]]?.[vars[j]];
      if (cell && cell.r !== null && Math.abs(cell.r) >= 0.7) {
        highCorrPairs.push({
          pair: `${vars[i]} <-> ${vars[j]}`,
          r: Number(cell.r.toFixed(3)),
          n: cell.n,
        });
      }
    }
  }

  return {
    fileName: dataset.fileName,
    sourceFormat: dataset.sourceFormat,
    selectedSheet: dataset.selectedSheet,
    excelDateSystem: dataset.excelDateSystem,
    rowCount: dataset.rowCount,
    columnCount: dataset.columnCount,
    exactDuplicateRows: diagnostics.exactDuplicateRows,
    completeCaseRows: diagnostics.completeCaseRows,
    panel: {
      structureKind: dataset.panel.structureKind,
      uniqueRecordIdVar: dataset.panel.uniqueRecordIdVar,
      isPanel: dataset.panel.isPanel,
      userConfirmed: dataset.panel.userConfirmed,
      entityVar: dataset.panel.entityVar,
      timeVar: dataset.panel.timeVar,
      entityIsString: dataset.panel.entityIsString,
      isBalanced: dataset.panel.isBalanced,
      numEntities: dataset.panel.numEntities,
      numPeriods: dataset.panel.numPeriods,
      repeatedKeyGroups: dataset.panel.repeatedKeyGroups,
      duplicateKeyPairs: dataset.panel.duplicateKeyPairs,
      distinctKeyConflictRows: dataset.panel.distinctKeyConflictRows,
    },
    schema: dataset.columns.map((c) => ({
      stataName: c.stataName,
      label: c.label,
      type: c.type,
      role: c.role,
      confirmedTimeCadence: c.confirmedTimeCadence,
      missingPct: Number(c.missingPct.toFixed(2)),
      uniqueCount: c.uniqueCount,
      isAllMissing: c.isAllMissing,
      isConstant: c.isConstant,
      preserveLeadingZeros: c.preserveLeadingZeros,
      nonPositiveCount: c.nonPositiveCount,
      leqNegOneCount: c.leqNegOneCount,
    })),
    numericSummaries: diagnostics.summaries.map((s) => ({
      stataName: s.stataName,
      n: s.n,
      mean: Number(s.mean.toFixed(3)),
      sd: Number(s.sd.toFixed(3)),
      min: Number(s.min.toFixed(3)),
      median: Number(s.median.toFixed(3)),
      max: Number(s.max.toFixed(3)),
      skewness: Number(s.skewness.toFixed(3)),
      iqrOutlierCount: s.iqrOutlierCount,
      zOutlierCount: s.zOutlierCount,
      nonPositiveCount: s.nonPositiveCount,
      leqNegOneCount: s.leqNegOneCount,
    })),
    highCorrelationPairs: highCorrPairs,
    currentModelSpec: spec,
  };
}
