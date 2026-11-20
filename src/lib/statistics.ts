import type {
  BoxplotStats,
  ColumnSuitabilityIssue,
  CorrelationMatrixData,
  DatasetState,
  DiagnosticsReport,
  HistogramBin,
  LogTransformMode,
  ModelSpec,
  ModelSuitabilityReport,
  NumericSummary,
  PostDedupPanelCheck,
  RawRow,
  SampleImpact,
  SampleImpactStep,
} from '../types/econometrics';
import { evaluatePanelStructure, parseStrictNumeric } from './parser';

function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function buildHistogram(
  values: number[],
  domainMin: number,
  domainMax: number,
  numBins = 16
): HistogramBin[] {
  if (values.length === 0) return [];
  if (domainMin === domainMax) {
    return [{ x0: domainMin - 0.5, x1: domainMax + 0.5, count: values.length }];
  }
  const width = (domainMax - domainMin) / numBins;
  const bins: HistogramBin[] = Array.from({ length: numBins }, (_, i) => ({
    x0: domainMin + i * width,
    x1: domainMin + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    const rawIdx = Math.floor((v - domainMin) / width);
    const idx = Math.min(numBins - 1, Math.max(0, rawIdx));
    bins[idx].count++;
  }
  return bins;
}

export function computeNumericSummary(
  rows: RawRow[],
  stataName: string,
  label: string,
  fixedDomain?: { min: number; max: number; numBins?: number }
): NumericSummary {
  const values: number[] = [];
  let missing = 0;
  let nonPositiveCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;
  let leqNegOneCount = 0;

  for (const row of rows) {
    const num = parseStrictNumeric(row[stataName] ?? '');
    if (num === null) {
      missing++;
    } else {
      values.push(num);
      if (num <= 0) nonPositiveCount++;
      if (num === 0) zeroCount++;
      if (num < 0) negativeCount++;
      if (num <= -1) leqNegOneCount++;
    }
  }

  const n = values.length;
  if (n === 0) {
    return {
      stataName,
      label,
      n: 0,
      missing,
      mean: NaN,
      sd: NaN,
      min: NaN,
      p25: NaN,
      median: NaN,
      p75: NaN,
      max: NaN,
      skewness: NaN,
      nonPositiveCount: 0,
      zeroCount: 0,
      negativeCount: 0,
      leqNegOneCount: 0,
      iqrOutlierCount: 0,
      iqrExtremeCount: 0,
      zOutlierCount: 0,
      histogram: [],
      boxplot: {
        min: 0,
        lowerWhisker: 0,
        q1: 0,
        median: 0,
        q3: 0,
        upperWhisker: 0,
        max: 0,
        mean: 0,
        outliersIqr: [],
        outliersZ: [],
      },
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;

  let m2 = 0;
  let m3 = 0;
  for (const v of values) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
  }

  const variance = n > 1 ? m2 / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const popSd = Math.sqrt(m2 / n);
  const skewness = popSd > 0 ? (m3 / n) / Math.pow(popSd, 3) : 0;

  const min = sorted[0];
  const p25 = quantileSorted(sorted, 0.25);
  const median = quantileSorted(sorted, 0.5);
  const p75 = quantileSorted(sorted, 0.75);
  const max = sorted[n - 1];

  const iqr = p75 - p25;
  const fenceLow15 = p25 - 1.5 * iqr;
  const fenceHigh15 = p75 + 1.5 * iqr;
  const fenceLow30 = p25 - 3.0 * iqr;
  const fenceHigh30 = p75 + 3.0 * iqr;

  const outliersIqr: number[] = [];
  const outliersZ: number[] = [];
  let iqrExtremeCount = 0;
  let lowerWhisker = max;
  let upperWhisker = min;

  for (const v of sorted) {
    const isIqrOut = iqr > 0 && (v < fenceLow15 || v > fenceHigh15);
    if (isIqrOut) {
      outliersIqr.push(v);
      if (v < fenceLow30 || v > fenceHigh30) {
        iqrExtremeCount++;
      }
    } else {
      if (v < lowerWhisker) lowerWhisker = v;
      if (v > upperWhisker) upperWhisker = v;
    }

    if (sd > 0 && Math.abs((v - mean) / sd) > 3) {
      outliersZ.push(v);
    }
  }

  if (lowerWhisker > p25) lowerWhisker = min;
  if (upperWhisker < p75) upperWhisker = max;

  const boxplot: BoxplotStats = {
    min,
    lowerWhisker,
    q1: p25,
    median,
    q3: p75,
    upperWhisker,
    max,
    mean,
    outliersIqr,
    outliersZ,
  };

  const histMin = fixedDomain ? fixedDomain.min : min;
  const histMax = fixedDomain ? fixedDomain.max : max;
  const binCount =
    fixedDomain?.numBins ?? Math.min(18, Math.max(8, Math.round(Math.sqrt(n))));

  return {
    stataName,
    label,
    n,
    missing,
    mean,
    sd,
    min,
    p25,
    median,
    p75,
    max,
    skewness,
    nonPositiveCount,
    zeroCount,
    negativeCount,
    leqNegOneCount,
    iqrOutlierCount: outliersIqr.length,
    iqrExtremeCount,
    zOutlierCount: outliersZ.length,
    histogram: buildHistogram(values, histMin, histMax, binCount),
    boxplot,
  };
}

export function countExactDuplicateRows(rows: RawRow[], columnNames: string[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = columnNames.map((c) => row[c] ?? '').join('\u0001');
    if (seen.has(key)) {
      duplicates++;
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

export function deduplicateExactRows(rows: RawRow[], columnNames: string[]): RawRow[] {
  const seen = new Set<string>();
  const kept: RawRow[] = [];
  for (const row of rows) {
    const key = columnNames.map((c) => row[c] ?? '').join('\u0001');
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(row);
    }
  }
  return kept;
}

export function computeCorrelationMatrix(
  rows: RawRow[],
  numericCols: string[]
): CorrelationMatrixData {
  const parsedCols: Record<string, Array<number | null>> = {};
  for (const col of numericCols) {
    parsedCols[col] = rows.map((r) => parseStrictNumeric(r[col] ?? ''));
  }

  const matrix: Record<string, Record<string, { r: number | null; n: number }>> = {};
  let minPairwiseN = Infinity;
  let maxPairwiseN = 0;

  for (const colA of numericCols) {
    matrix[colA] = {};
    for (const colB of numericCols) {
      const arrA = parsedCols[colA];
      const arrB = parsedCols[colB];
      let n = 0;
      let sumA = 0;
      let sumB = 0;

      for (let i = 0; i < rows.length; i++) {
        const a = arrA[i];
        const b = arrB[i];
        if (a !== null && b !== null) {
          n++;
          sumA += a;
          sumB += b;
        }
      }

      if (colA !== colB) {
        if (n < minPairwiseN) minPairwiseN = n;
        if (n > maxPairwiseN) maxPairwiseN = n;
      }

      if (colA === colB) {
        matrix[colA][colB] = { r: n > 1 ? 1 : null, n };
        continue;
      }

      if (n < 3) {
        matrix[colA][colB] = { r: null, n };
        continue;
      }

      const meanA = sumA / n;
      const meanB = sumB / n;
      let cov = 0;
      let varA = 0;
      let varB = 0;

      for (let i = 0; i < rows.length; i++) {
        const a = arrA[i];
        const b = arrB[i];
        if (a !== null && b !== null) {
          const da = a - meanA;
          const db = b - meanB;
          cov += da * db;
          varA += da * da;
          varB += db * db;
        }
      }

      const denom = Math.sqrt(varA * varB);
      matrix[colA][colB] = {
        r: denom > 0 ? cov / denom : null,
        n,
      };
    }
  }

  return {
    variables: numericCols,
    matrix,
    minPairwiseN: Number.isFinite(minPairwiseN) ? minPairwiseN : 0,
    maxPairwiseN,
  };
}

export function computeDiagnostics(dataset: DatasetState): DiagnosticsReport {
  const numericCols = dataset.columns.filter((c) => c.type === 'numeric');
  const summaries = numericCols.map((c) => computeNumericSummary(dataset.rows, c.stataName, c.label));
  const summaryMap: Record<string, NumericSummary> = {};
  for (const s of summaries) {
    summaryMap[s.stataName] = s;
  }

  const allColNames = dataset.columns.map((c) => c.stataName);
  const numericColNames = numericCols.map((c) => c.stataName);
  const exactDuplicateRows = countExactDuplicateRows(dataset.rows, allColNames);

  let completeCaseRows = 0;
  let completeCaseNumericRows = 0;
  for (const row of dataset.rows) {
    let allPresent = true;
    for (const c of allColNames) {
      if (!row[c] || row[c].trim() === '') {
        allPresent = false;
        break;
      }
    }
    if (allPresent) completeCaseRows++;

    let allNumericPresent = numericColNames.length > 0;
    for (const c of numericColNames) {
      if (parseStrictNumeric(row[c] ?? '') === null) {
        allNumericPresent = false;
        break;
      }
    }
    if (allNumericPresent) completeCaseNumericRows++;
  }

  const correlation = computeCorrelationMatrix(dataset.rows, numericColNames);

  return {
    summaries,
    summaryMap,
    exactDuplicateRows,
    completeCaseRows,
    completeCaseNumericRows,
    correlation,
  };
}

/**
 * Produces a cleaned row array reflecting exact duplicate removal, winsorization,
 * and log transformations (matching Stata domain rules) and computes:
 *  - Unified cleanedPanel structure (recomputed on cleanedRows so balance matches)
 *  - Complete-case estimation sample variation & suitability audit
 *  - Complete cases before estimation preview
 */
export function buildCleanedRowsAndImpact(
  dataset: DatasetState,
  spec: ModelSpec
): { cleanedRows: RawRow[]; impact: SampleImpact } {
  const allColNames = dataset.columns.map((c) => c.stataName);
  const startingN = dataset.rows.length;

  let workingRows: RawRow[] = dataset.rows.map((r) => ({ ...r }));
  let exactDuplicatesRemoved = 0;

  if (spec.dropExactDuplicates) {
    const deduped = deduplicateExactRows(workingRows, allColNames);
    exactDuplicatesRemoved = workingRows.length - deduped.length;
    workingRows = deduped;
  }
  const afterExactDuplicatesN = workingRows.length;

  // Unified panel recomputation on the cleaned rows (Req 3: demo cleaned panel = balanced 30 x 15!)
  const cleanedPanel = evaluatePanelStructure(
    workingRows,
    dataset.columns,
    dataset.panel.entityVar,
    dataset.panel.timeVar,
    dataset.panel.detectionReason,
    dataset.panel.userConfirmed,
    dataset.panel.structureKind,
    dataset.panel.candidateEntityVar,
    dataset.panel.candidateTimeVar
  );

  const postDedupPanelCheck: PostDedupPanelCheck = {
    checked: Boolean(dataset.panel.entityVar && dataset.panel.timeVar),
    panelKeyStatus: cleanedPanel.panelKeyStatus,
    balanceStatus: cleanedPanel.balanceStatus,
    duplicateKeyPairs: cleanedPanel.duplicateKeyPairs,
    repeatedKeyGroups: cleanedPanel.repeatedKeyGroups,
    distinctKeyConflictRows: cleanedPanel.distinctKeyConflictRows,
    missingEntityRows: cleanedPanel.missingEntityRows,
    missingTimeRows: cleanedPanel.missingTimeRows,
    missingKeyRows: cleanedPanel.missingKeyRows,
    isBalanced: cleanedPanel.isBalanced,
    isSafeForXtset:
      dataset.panel.userConfirmed &&
      cleanedPanel.isPanel &&
      cleanedPanel.panelKeyStatus === 'valid',
  };

  // Step 2: Winsorization (modifies extreme tails in-place, preserves N)
  const winsorizedValueCounts: Array<{ variable: string; count: number }> = [];
  const lowPct = spec.winsorizeLevel / 100;
  const highPct = 1 - lowPct;

  for (const varName of spec.winsorizeVars) {
    const nums = workingRows
      .map((r) => parseStrictNumeric(r[varName] ?? ''))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    if (nums.length < 4) continue;
    const lo = quantileSorted(nums, lowPct);
    const hi = quantileSorted(nums, highPct);
    let clipped = 0;

    for (const row of workingRows) {
      const val = parseStrictNumeric(row[varName] ?? '');
      if (val !== null) {
        if (val < lo) {
          row[varName] = String(lo);
          clipped++;
        } else if (val > hi) {
          row[varName] = String(hi);
          clipped++;
        }
      }
    }
    winsorizedValueCounts.push({ variable: varName, count: clipped });
  }

  // Step 3: Log / IHS transformations with exact Stata domain rules:
  //   - ln(x):      defined for x > 0   (missing when x <= 0)
  //   - ln(x + 1):  defined for x > -1  (missing when x <= -1; -0.5 is valid!)
  //   - asinh(x):   defined for all real x
  const logDomainNewMissing: Array<{ variable: string; mode: LogTransformMode; count: number }> = [];
  const transformedValuesByRow: Record<string, Array<number | null>> = {};

  for (const [varName, mode] of Object.entries(spec.logTransforms)) {
    let newlyMissing = 0;
    const arr: Array<number | null> = [];
    for (const row of workingRows) {
      const val = parseStrictNumeric(row[varName] ?? '');
      if (val === null) {
        arr.push(null);
      } else if (mode === 'ln') {
        if (val <= 0) {
          newlyMissing++;
          arr.push(null);
        } else {
          arr.push(Math.log(val));
        }
      } else if (mode === 'ln1p') {
        if (val <= -1) {
          newlyMissing++;
          arr.push(null);
        } else {
          arr.push(Math.log1p(val));
        }
      } else {
        arr.push(Math.asinh(val));
      }
    }
    transformedValuesByRow[varName] = arr;
    if (newlyMissing > 0) {
      logDomainNewMissing.push({ variable: varName, mode, count: newlyMissing });
    }
  }

  // Step 4: Identify complete-case row indices before estimation
  const modelVars = new Set<string>();
  if (spec.depVar) modelVars.add(spec.depVar);
  for (const x of spec.indepVars) modelVars.add(x);

  const categoricalOrIdVars = new Set<string>();
  if (spec.estimator === 'fe_xtreg' || spec.estimator === 're_xtreg') {
    if (dataset.panel.entityVar) categoricalOrIdVars.add(dataset.panel.entityVar);
    if (dataset.panel.timeVar) categoricalOrIdVars.add(dataset.panel.timeVar);
  }
  if (spec.estimator === 'fe_reghdfe') {
    for (const fe of spec.absorbVars) categoricalOrIdVars.add(fe);
  }
  if (spec.seType === 'cluster_entity' && dataset.panel.entityVar) {
    categoricalOrIdVars.add(dataset.panel.entityVar);
  }
  if (spec.seType === 'cluster_twoway') {
    if (dataset.panel.entityVar) categoricalOrIdVars.add(dataset.panel.entityVar);
    if (dataset.panel.timeVar) categoricalOrIdVars.add(dataset.panel.timeVar);
  }

  const completeCaseIndices: number[] = [];

  if (spec.depVar) {
    for (let i = 0; i < workingRows.length; i++) {
      const row = workingRows[i];
      let rowOk = true;
      for (const v of modelVars) {
        if (transformedValuesByRow[v]) {
          if (transformedValuesByRow[v][i] === null) {
            rowOk = false;
            break;
          }
        } else if (parseStrictNumeric(row[v] ?? '') === null) {
          rowOk = false;
          break;
        }
      }
      if (rowOk) {
        for (const idVar of categoricalOrIdVars) {
          if (!row[idVar] || row[idVar].trim() === '') {
            rowOk = false;
            break;
          }
        }
      }
      if (rowOk) completeCaseIndices.push(i);
    }
  }

  const previewCompleteCasesN = spec.depVar ? completeCaseIndices.length : afterExactDuplicatesN;
  const listwiseMissingDropped = spec.depVar ? afterExactDuplicatesN - previewCompleteCasesN : 0;

  // Step 5: Variable Suitability Audit (dataset-level + complete-case estimation-sample recheck)
  const datasetIssues: Record<string, ColumnSuitabilityIssue> = {};
  const estimationIssues: Record<string, ColumnSuitabilityIssue> = {};
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  for (const col of dataset.columns) {
    if (col.isAllMissing) {
      datasetIssues[col.stataName] = {
        stataName: col.stataName,
        severity: 'error',
        scope: 'dataset',
        reason: 'All observations are missing (0 non-missing values).',
      };
    } else if (col.isConstant) {
      const onlyVal = col.sampleValues[0] ?? '';
      datasetIssues[col.stataName] = {
        stataName: col.stataName,
        severity: 'error',
        scope: 'dataset',
        reason: `Constant across the entire dataset (only observed value: "${onlyVal}").`,
      };
    }
  }

  // Recheck variation of every active model variable on the complete-case sample
  if (spec.depVar) {
    const checkNumericOnEstimationSample = (varName: string, roleLabel: string) => {
      if (datasetIssues[varName]) {
        estimationIssues[varName] = datasetIssues[varName];
        blockingReasons.push(`${roleLabel} "${varName}": ${datasetIssues[varName].reason}`);
        return;
      }
      if (completeCaseIndices.length === 0) {
        const issue: ColumnSuitabilityIssue = {
          stataName: varName,
          severity: 'error',
          scope: 'estimation_sample',
          reason: 'No complete-case observations remain for estimation.',
        };
        estimationIssues[varName] = issue;
        return;
      }

      const distinctNums = new Set<number>();
      for (const idx of completeCaseIndices) {
        const val = transformedValuesByRow[varName]
          ? transformedValuesByRow[varName][idx]
          : parseStrictNumeric(workingRows[idx][varName] ?? '');
        if (val !== null && Number.isFinite(val)) {
          distinctNums.add(Number(val.toPrecision(12)));
        }
      }

      if (distinctNums.size === 0) {
        const issue: ColumnSuitabilityIssue = {
          stataName: varName,
          severity: 'error',
          scope: 'estimation_sample',
          reason: 'Has 0 valid values on the complete-case estimation sample.',
        };
        estimationIssues[varName] = issue;
        blockingReasons.push(`${roleLabel} "${varName}": ${issue.reason}`);
      } else if (distinctNums.size === 1) {
        const singleVal = Array.from(distinctNums)[0];
        const issue: ColumnSuitabilityIssue = {
          stataName: varName,
          severity: 'error',
          scope: 'estimation_sample',
          reason: `Becomes constant (${singleVal}) on the complete-case sample after missingness/transformations and cannot be estimated.`,
        };
        estimationIssues[varName] = issue;
        blockingReasons.push(`${roleLabel} "${varName}": ${issue.reason}`);
      }
    };

    checkNumericOnEstimationSample(spec.depVar, 'Dependent variable');
    for (const x of spec.indepVars) {
      checkNumericOnEstimationSample(x, 'Regressor');
      const col = dataset.columns.find((c) => c.stataName === x);
      if (col && col.role === 'identifier') {
        warnings.push(`Regressor "${x}" is flagged as an identifier rather than a substantive covariate.`);
      }
    }

    if (spec.estimator === 'fe_reghdfe') {
      for (const fe of spec.absorbVars) {
        if (datasetIssues[fe]) {
          estimationIssues[fe] = datasetIssues[fe];
          blockingReasons.push(`Absorbed FE "${fe}": ${datasetIssues[fe].reason}`);
        } else if (completeCaseIndices.length > 0) {
          const vals = new Set<string>();
          for (const idx of completeCaseIndices) {
            const v = (workingRows[idx][fe] ?? '').trim();
            if (v) vals.add(v);
          }
          if (vals.size <= 1) {
            const issue: ColumnSuitabilityIssue = {
              stataName: fe,
              severity: 'error',
              scope: 'estimation_sample',
              reason: 'Has only 1 unique group on the complete-case sample; fixed effect cannot be absorbed.',
            };
            estimationIssues[fe] = issue;
            blockingReasons.push(`Absorbed FE "${fe}": ${issue.reason}`);
          }
        }
      }
    }

    if (spec.indepVars.length > 0 && previewCompleteCasesN < spec.indepVars.length + 2) {
      blockingReasons.push(
        `Insufficient complete cases (${previewCompleteCasesN}) to estimate ${spec.indepVars.length} regressor(s) plus intercept.`
      );
    }

    if (
      (spec.estimator === 'fe_xtreg' || spec.estimator === 're_xtreg') &&
      !postDedupPanelCheck.isSafeForXtset
    ) {
      blockingReasons.push(
        !dataset.panel.userConfirmed
          ? 'Panel keys must be confirmed in the Inspector before running xtreg.'
          : postDedupPanelCheck.duplicateKeyPairs > 0
            ? `${postDedupPanelCheck.duplicateKeyPairs} repeated panel key pair(s) remain after deduplication (xtset r(451)).`
            : 'Valid non-missing panel entity and time keys are required for xtreg.'
      );
    }
  }

  const suitability: ModelSuitabilityReport = {
    datasetIssues,
    estimationIssues,
    modelBlocked: blockingReasons.length > 0,
    blockingReasons,
    warnings,
  };

  const steps: SampleImpactStep[] = [
    {
      id: 'imported',
      label: 'Imported Dataset',
      detail: `${dataset.fileName}${dataset.selectedSheet ? ` (${dataset.selectedSheet})` : ''}`,
      rowsRemaining: startingN,
      rowsAffected: 0,
      kind: 'base',
    },
  ];

  if (spec.dropExactDuplicates) {
    steps.push({
      id: 'duplicates',
      label: 'Exact Duplicates Drop',
      detail: exactDuplicatesRemoved > 0 ? 'duplicates drop' : 'No exact duplicates found',
      rowsRemaining: afterExactDuplicatesN,
      rowsAffected: exactDuplicatesRemoved,
      kind: 'drop',
    });
  }

  if (winsorizedValueCounts.length > 0) {
    const totalClipped = winsorizedValueCounts.reduce((acc, w) => acc + w.count, 0);
    steps.push({
      id: 'winsorize',
      label: `Winsorize (${spec.winsorizeLevel}% / ${100 - spec.winsorizeLevel}%)`,
      detail: `${winsorizedValueCounts.map((w) => w.variable).join(', ')} — ${totalClipped} tail values capped (N retained)`,
      rowsRemaining: afterExactDuplicatesN,
      rowsAffected: totalClipped,
      kind: 'modify',
    });
  }

  const totalLogOutOfDomain = logDomainNewMissing.reduce((acc, l) => acc + l.count, 0);
  if (Object.keys(spec.logTransforms).length > 0) {
    steps.push({
      id: 'log_transforms',
      label: 'Log / IHS Transforms',
      detail:
        totalLogOutOfDomain > 0
          ? `${totalLogOutOfDomain} out-of-domain value(s) turned missing (${logDomainNewMissing.map((l) => `${l.mode}(${l.variable})`).join(', ')})`
          : `${Object.keys(spec.logTransforms).length} variable(s) transformed cleanly (0 new missing)`,
      rowsRemaining: afterExactDuplicatesN,
      rowsAffected: totalLogOutOfDomain,
      kind: totalLogOutOfDomain > 0 ? 'drop' : 'modify',
    });
  }

  if (spec.depVar) {
    steps.push({
      id: 'listwise',
      label: 'Model Listwise Missingness',
      detail: `Non-missing across Y (${spec.depVar}), ${spec.indepVars.length} control(s)${categoricalOrIdVars.size > 0 ? ', and FE/cluster IDs' : ''}`,
      rowsRemaining: previewCompleteCasesN,
      rowsAffected: listwiseMissingDropped,
      kind: 'drop',
    });
  }

  steps.push({
    id: 'complete_cases',
    label: spec.depVar ? 'Complete Cases Before Estimation (Selected Model)' : 'Cleaned Dataset Rows',
    detail: !spec.depVar
      ? 'Select a dependent variable Y to preview complete cases for a model'
      : spec.estimator === 'fe_reghdfe'
        ? 'Browser preview before reghdfe singleton absorption; compare with fitted e(N) in Stata'
        : 'Browser preview; exported .do reports fitted e(N) separately after estimation',
    rowsRemaining: previewCompleteCasesN,
    rowsAffected: startingN - previewCompleteCasesN,
    kind: 'final',
  });

  return {
    cleanedRows: workingRows,
    impact: {
      startingN,
      afterExactDuplicatesN,
      exactDuplicatesRemoved,
      logDomainNewMissing,
      winsorizedValueCounts,
      listwiseMissingDropped,
      previewCompleteCasesN,
      postDedupPanelCheck,
      cleanedPanel,
      suitability,
      steps,
    },
  };
}

export function formatNum(val: number, decimals = 2): string {
  if (!Number.isFinite(val)) return '—';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
