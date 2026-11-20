import type {
  ColumnProfile,
  DatasetState,
  EstimatorType,
  ModelSpec,
  PanelDetection,
  RawRow,
} from '../types/econometrics';
import { parseStrictNumeric } from './parser';
import { describeKeyValidityIssues, formatBalanceLabel } from './panelStatus';

export type StorageType = 'number' | 'text' | 'date' | 'all_missing';

export type SuggestedResearchRole =
  | 'record_identifier'
  | 'entity_identifier'
  | 'time'
  | 'outcome'
  | 'categorical_covariate'
  | 'continuous_covariate';

export type SuggestedDataStructure =
  | 'cross_section'
  | 'dated_cross_section'
  | 'time_series'
  | 'candidate_panel';

export type SuggestedOutcomeType =
  | 'continuous'
  | 'binary'
  | 'count'
  | 'nominal'
  | 'ordinal'
  | 'ambiguous_low_cardinality_numeric';

export type ConfirmedOutcomeType =
  | 'continuous'
  | 'binary'
  | 'count'
  | 'nominal'
  | 'ordinal';

export type ResearchAim = 'description' | 'prediction' | 'causal';

export interface ColumnSuggestionAudit {
  stataName: string;
  label: string;
  storageType: StorageType;
  inferredResearchRole: SuggestedResearchRole;
  roleEvidence: string;
  roleUncertainty: string | null;
  inferredOutcomeType: SuggestedOutcomeType | null;
  outcomeEvidence: string | null;
  outcomeUncertainty: string | null;
  isLowCardinalityNumeric: boolean;
  isNonNegativeInteger: boolean;
  observedDistinctSample: string[];
  uniqueCount: number;
  nonMissing: number;
}

export interface DataStructureAudit {
  structure: SuggestedDataStructure;
  label: string;
  evidence: string[];
  uncertainties: string[];
  uniqueRecordIdVar: string | null;
  candidateEntityVar: string | null;
  candidateTimeVar: string | null;
  panelEvaluation: PanelDetection;
}

export interface FeVariationCheck {
  variable: string;
  absorbedByEntityFe: boolean;
  absorbedByTimeFe: boolean;
  entityGroupsWithVariation: number;
  entityGroupsEvaluated: number;
  timeGroupsWithVariation: number;
  timeGroupsEvaluated: number;
  explanation: string | null;
}

export interface ResearcherConfirmations {
  structureConfirmed: boolean;
  outcomeVar: string | null;
  confirmedOutcomeType: ConfirmedOutcomeType | null;
  binaryEventValue: string | null;
  countHasDifferingExposure: 'unknown' | 'no' | 'yes';
  countExposureVar: string | null;
  researchAim: ResearchAim;
  selectedRegressors: string[];
}

export interface CandidateModelRecommendation {
  id: string;
  title: string;
  estimatorLabel: string;
  implementationStatus: 'implemented_ready' | 'implemented_blocked' | 'guidance_only';
  blockedReason: string | null;
  reasons: string[];
  assumptions: string[];
  nextChecks: string[];
  absorptionWarnings: string[];
  researcherJudgementNotes: string[];
  /** Present ONLY when implementationStatus === 'implemented_ready' */
  builderSpecDraft?: Partial<ModelSpec> & {
    estimator: EstimatorType;
    depVar: string;
    indepVars: string[];
  };
}

export interface ModelSuggestionsReport {
  structureAudit: DataStructureAudit;
  columnAudits: ColumnSuggestionAudit[];
  activeOutcomeAudit: ColumnSuggestionAudit | null;
  outcomeRequiresConfirmation: boolean;
  countNonNegativeIntegerCheck: {
    checked: boolean;
    passed: boolean;
    detail: string;
  };
  feVariationChecks: FeVariationCheck[];
  recommendations: CandidateModelRecommendation[];
  globalJudgementNotes: string[];
}

const LOW_CARDINALITY_NUMERIC_MAX = 7;

function classifyStorageType(col: ColumnProfile): StorageType {
  if (col.isAllMissing) return 'all_missing';
  if (col.type === 'numeric') return 'number';
  if (col.type === 'date') return 'date';
  return 'text';
}

function inspectNumericValues(
  rows: RawRow[],
  stataName: string
): {
  distinctStrings: string[];
  distinctNums: number[];
  allIntegers: boolean;
  allNonNegative: boolean;
  hasZero: boolean;
  hasNegative: boolean;
} {
  const distinctNumSet = new Set<number>();
  const distinctStrSet = new Set<string>();
  let allIntegers = true;
  let allNonNegative = true;
  let hasZero = false;
  let hasNegative = false;

  for (const row of rows) {
    const raw = (row[stataName] ?? '').trim();
    if (!raw) continue;
    const num = parseStrictNumeric(raw);
    if (num === null) continue;
    distinctNumSet.add(num);
    if (distinctStrSet.size < 12) distinctStrSet.add(raw);
    if (!Number.isInteger(num)) allIntegers = false;
    if (num < 0) {
      allNonNegative = false;
      hasNegative = true;
    }
    if (num === 0) hasZero = true;
  }

  const distinctNums = Array.from(distinctNumSet).sort((a, b) => a - b);
  return {
    distinctStrings: Array.from(distinctStrSet),
    distinctNums,
    allIntegers: distinctNums.length > 0 && allIntegers,
    allNonNegative: distinctNums.length > 0 && allNonNegative,
    hasZero,
    hasNegative,
  };
}

function inferOutcomeTypeForColumn(
  col: ColumnProfile,
  rows: RawRow[]
): {
  outcomeType: SuggestedOutcomeType | null;
  evidence: string | null;
  uncertainty: string | null;
  isLowCardinalityNumeric: boolean;
  isNonNegativeInteger: boolean;
  observedDistinctSample: string[];
} {
  if (col.isAllMissing || col.isConstant) {
    return {
      outcomeType: null,
      evidence: col.isAllMissing
        ? 'All values are missing; cannot serve as an outcome.'
        : 'Column is constant (0 variance); cannot serve as an outcome.',
      uncertainty: null,
      isLowCardinalityNumeric: false,
      isNonNegativeInteger: false,
      observedDistinctSample: col.sampleValues,
    };
  }

  if (col.type === 'date') {
    return {
      outcomeType: null,
      evidence: 'Stored as a date/period column; typically a time index rather than a regression outcome.',
      uncertainty: null,
      isLowCardinalityNumeric: false,
      isNonNegativeInteger: false,
      observedDistinctSample: col.sampleValues,
    };
  }

  if (col.type === 'categorical' || col.type === 'string') {
    if (col.uniqueCount === 2) {
      return {
        outcomeType: 'binary',
        evidence: `Text column with exactly 2 distinct non-missing values (${col.sampleValues.join(', ')}).`,
        uncertainty: 'Confirm which text label represents the target event (1) before modeling.',
        isLowCardinalityNumeric: false,
        isNonNegativeInteger: false,
        observedDistinctSample: col.sampleValues,
      };
    }
    if (col.uniqueCount <= 12) {
      return {
        outcomeType: 'nominal',
        evidence: `Text/categorical column with ${col.uniqueCount} distinct categories.`,
        uncertainty: 'Confirm whether categories are unordered (nominal) or ordered (ordinal).',
        isLowCardinalityNumeric: false,
        isNonNegativeInteger: false,
        observedDistinctSample: col.sampleValues,
      };
    }
    return {
      outcomeType: null,
      evidence: `High-cardinality text column (${col.uniqueCount} unique values); unlikely to be a standard regression outcome.`,
      uncertainty: null,
      isLowCardinalityNumeric: false,
      isNonNegativeInteger: false,
      observedDistinctSample: col.sampleValues,
    };
  }

  // Numeric column
  const numStats = inspectNumericValues(rows, col.stataName);
  const distinctCount = numStats.distinctNums.length;
  const samplePreview = numStats.distinctNums.slice(0, 8).map(String);
  const isNonNegativeInteger = numStats.allIntegers && numStats.allNonNegative;

  // CRITICAL: Low-cardinality numeric columns are treated as AMBIGUOUS until researcher confirms!
  if (distinctCount >= 2 && distinctCount <= LOW_CARDINALITY_NUMERIC_MAX) {
    const looksZeroOne =
      distinctCount === 2 && numStats.distinctNums[0] === 0 && numStats.distinctNums[1] === 1;
    const lower = col.stataName.toLowerCase();
    const looksCountName = /(count|num_|n_|visits|claims|events|incidents|patents|children|loans|births|accidents)/.test(
      lower
    );

    let hint = 'Could represent binary indicators, unordered codes, ordered ratings, small counts, or coarse continuous measurements.';
    if (looksZeroOne) {
      hint = 'Values are {0, 1}, strongly suggesting a binary indicator — confirm event meaning (1 vs. 0) before choosing a model.';
    } else if (isNonNegativeInteger && looksCountName) {
      hint = 'Small non-negative integers with a count-like name — confirm whether this is a count, ordinal scale, or categorical code.';
    } else if (numStats.allIntegers) {
      hint = `Only ${distinctCount} distinct integer values observed (${samplePreview.join(', ')}) — numeric codes cannot distinguish nominal, ordinal, count, or continuous scales automatically.`;
    }

    return {
      outcomeType: 'ambiguous_low_cardinality_numeric',
      evidence: `Numeric column with only ${distinctCount} distinct values: {${samplePreview.join(', ')}}.`,
      uncertainty: `Ambiguous until confirmed: ${hint}`,
      isLowCardinalityNumeric: true,
      isNonNegativeInteger,
      observedDistinctSample: samplePreview,
    };
  }

  // Higher-cardinality non-negative integer column
  if (isNonNegativeInteger) {
    const lower = col.stataName.toLowerCase();
    const looksCountName = /(count|num_|n_|visits|claims|events|incidents|patents|children|accidents|deaths|defaults|orders|trips|tickets|applications)/.test(
      lower
    );
    if (looksCountName || (numStats.hasZero && numStats.distinctNums[distinctCount - 1] <= 200)) {
      return {
        outcomeType: 'count',
        evidence: `Non-negative integer values (${distinctCount} distinct, range ${numStats.distinctNums[0]}–${numStats.distinctNums[distinctCount - 1]}${numStats.hasZero ? ', includes 0' : ''}).`,
        uncertainty: 'Confirm whether values represent event counts (and whether exposure/time-at-risk differs) or a continuous numeric quantity.',
        isLowCardinalityNumeric: false,
        isNonNegativeInteger: true,
        observedDistinctSample: samplePreview,
      };
    }
  }

  return {
    outcomeType: 'continuous',
    evidence: `Numeric column with ${distinctCount} distinct values (${numStats.allIntegers ? 'integers' : 'fractional decimals'}, range ${numStats.distinctNums[0]}–${numStats.distinctNums[distinctCount - 1]}).`,
    uncertainty:
      isNonNegativeInteger
        ? 'All observed values are non-negative integers; confirm if this is a continuous magnitude or a count outcome.'
        : null,
    isLowCardinalityNumeric: false,
    isNonNegativeInteger,
    observedDistinctSample: samplePreview,
  };
}

/**
 * Classifies dataset structure cleanly into cross_section, dated_cross_section,
 * time_series, or candidate_panel with explicit evidence and uncertainty disclosures.
 */
export function auditDataStructure(dataset: DatasetState, activePanel: PanelDetection): DataStructureAudit {
  const evidence: string[] = [];
  const uncertainties: string[] = [];

  const timeCols = dataset.columns.filter(
    (c) => c.role === 'time' || c.type === 'date' || c.confirmedTimeCadence !== 'none'
  );

  // Check for pure time series: a time column uniquely identifies rows AND no entity panel structure exists
  if (!activePanel.isPanel && activePanel.structureKind !== 'dated_cross_section') {
    const uniqueTimeCol = timeCols.find(
      (c) => c.nonMissing === dataset.rowCount && c.uniqueCount === dataset.rowCount && dataset.rowCount >= 4
    );
    if (uniqueTimeCol) {
      evidence.push(
        `Time column "${uniqueTimeCol.stataName}" has ${uniqueTimeCol.uniqueCount} unique non-missing periods matching all ${dataset.rowCount} rows (no cross-sectional entity dimension).`
      );
      uncertainties.push(
        'Confirm that rows represent sequential observations of a single aggregate unit and check for gaps or irregular spacing.'
      );
      return {
        structure: 'time_series',
        label: 'Time Series (Single Unit)',
        evidence,
        uncertainties,
        uniqueRecordIdVar: activePanel.uniqueRecordIdVar,
        candidateEntityVar: null,
        candidateTimeVar: uniqueTimeCol.stataName,
        panelEvaluation: activePanel,
      };
    }
  }

  // Candidate panel
  if (activePanel.isPanel && activePanel.entityVar && activePanel.timeVar) {
    evidence.push(
      `Candidate panel keys (${activePanel.entityVar}, ${activePanel.timeVar}): ${activePanel.numEntities} units × ${activePanel.numPeriods} periods.`
    );
    if (activePanel.panelKeyStatus === 'valid') {
      evidence.push(`Keys are unique and non-missing on the evaluated rows (${formatBalanceLabel(activePanel)}).`);
      if (!activePanel.userConfirmed) {
        uncertainties.push(
          'Panel keys are auto-suggested and not yet confirmed in the Inspector. Confirm keys before relying on xtreg / xtset.'
        );
      }
    } else {
      evidence.push(`Keys FAIL validation on current rows: ${describeKeyValidityIssues(activePanel)}.`);
      uncertainties.push(
        'Panel balance is undefined while keys are missing or repeated; xtset/xtreg are blocked until key validity is resolved.'
      );
    }

    return {
      structure: 'candidate_panel',
      label:
        activePanel.panelKeyStatus === 'valid'
          ? `Candidate Panel (${activePanel.userConfirmed ? 'Confirmed' : 'Unconfirmed'} · ${formatBalanceLabel(activePanel)})`
          : `Candidate Panel (Keys Invalid on Current Rows)`,
      evidence,
      uncertainties,
      uniqueRecordIdVar: activePanel.uniqueRecordIdVar,
      candidateEntityVar: activePanel.entityVar,
      candidateTimeVar: activePanel.timeVar,
      panelEvaluation: activePanel,
    };
  }

  // Dated cross-section (e.g., loan-level data with unique loan_id and repeated location-month keys)
  if (activePanel.structureKind === 'dated_cross_section' || timeCols.length > 0) {
    if (activePanel.uniqueRecordIdVar) {
      evidence.push(
        `Unique per-row record identifier "${activePanel.uniqueRecordIdVar}" detected across all ${dataset.rowCount} rows.`
      );
    }
    if (activePanel.candidateEntityVar && activePanel.candidateTimeVar && activePanel.distinctKeyConflictRows > 0) {
      evidence.push(
        `Candidate (${activePanel.candidateEntityVar}, ${activePanel.candidateTimeVar}) has ${activePanel.repeatedKeyGroups} repeated group(s) with ${activePanel.distinctKeyConflictRows} distinct record(s) sharing a key (not exact duplicates).`
      );
    } else if (timeCols.length > 0) {
      evidence.push(
        `Time column "${timeCols[0].stataName}" observed (${timeCols[0].uniqueCount} unique periods) without a unique entity-time panel key.`
      );
    }
    uncertainties.push(
      'Confirm whether the observation unit is an individual record/transaction (dated cross-section) or whether an additional key dimension defines a panel.'
    );
    return {
      structure: 'dated_cross_section',
      label: 'Dated Cross-Section',
      evidence,
      uncertainties,
      uniqueRecordIdVar: activePanel.uniqueRecordIdVar,
      candidateEntityVar: activePanel.candidateEntityVar,
      candidateTimeVar: activePanel.candidateTimeVar ?? timeCols[0]?.stataName ?? null,
      panelEvaluation: activePanel,
    };
  }

  // Plain cross-section
  evidence.push(
    `No repeating temporal dimension detected across ${dataset.rowCount} rows and ${dataset.columnCount} columns.`
  );
  if (activePanel.uniqueRecordIdVar) {
    evidence.push(`Unique record identifier "${activePanel.uniqueRecordIdVar}" detected.`);
  }
  uncertainties.push('Confirm that observations are independent cross-sectional units (or note any hierarchical grouping for clustering).');
  return {
    structure: 'cross_section',
    label: 'Cross-Section',
    evidence,
    uncertainties,
    uniqueRecordIdVar: activePanel.uniqueRecordIdVar,
    candidateEntityVar: null,
    candidateTimeVar: null,
    panelEvaluation: activePanel,
  };
}

/**
 * Audits every column separately for storage type, inferred research role,
 * and outcome type with explicit evidence and uncertainty notes.
 */
export function auditColumnsForSuggestions(
  dataset: DatasetState,
  rows: RawRow[],
  structureAudit: DataStructureAudit
): ColumnSuggestionAudit[] {
  const { uniqueRecordIdVar, candidateEntityVar, candidateTimeVar } = structureAudit;

  return dataset.columns.map((col) => {
    const storageType = classifyStorageType(col);
    const outcomeInfo = inferOutcomeTypeForColumn(col, rows);

    let inferredResearchRole: SuggestedResearchRole = 'continuous_covariate';
    let roleEvidence = '';
    let roleUncertainty: string | null = null;

    if (col.isAllMissing) {
      inferredResearchRole = 'categorical_covariate';
      roleEvidence = '0 non-missing values in dataset.';
      roleUncertainty = 'Empty column — excluded from modeling.';
    } else if (col.stataName === uniqueRecordIdVar) {
      inferredResearchRole = 'record_identifier';
      roleEvidence = `Unique non-missing value for every row (${col.uniqueCount} / ${dataset.rowCount}).`;
      roleUncertainty = null;
    } else if (col.stataName === candidateEntityVar) {
      inferredResearchRole = 'entity_identifier';
      roleEvidence = `Matches cross-sectional unit/entity dimension (${col.uniqueCount} distinct units).`;
      roleUncertainty =
        structureAudit.structure === 'dated_cross_section'
          ? 'Multiple distinct records share this location/entity within the same period; use as grouping/FE/cluster factor rather than a unique panel key.'
          : null;
    } else if (
      col.stataName === candidateTimeVar ||
      col.role === 'time' ||
      col.type === 'date' ||
      col.confirmedTimeCadence !== 'none'
    ) {
      inferredResearchRole = 'time';
      roleEvidence =
        col.confirmedTimeCadence !== 'none'
          ? `Temporal column (cadence: ${col.confirmedTimeCadence}; ${col.uniqueCount} unique periods).`
          : `Name/values match a time index (${col.uniqueCount} unique values).`;
      roleUncertainty = null;
    } else if (col.role === 'identifier' || col.preserveLeadingZeros || col.preserveLongId) {
      inferredResearchRole =
        col.uniqueCount === dataset.rowCount ? 'record_identifier' : 'entity_identifier';
      roleEvidence = col.preserveLeadingZeros
        ? 'Leading-zero code preserved as text identifier.'
        : col.preserveLongId
          ? 'Long 15+ digit ID preserved as text identifier.'
          : `Identifier naming/uniqueness pattern (${col.uniqueCount} unique values).`;
      roleUncertainty = 'Verify whether this code is an identifier or a substantive grouping variable.';
    } else if (col.type === 'categorical' || col.type === 'string') {
      inferredResearchRole = 'categorical_covariate';
      roleEvidence = `Text storage with ${col.uniqueCount} distinct values across ${col.nonMissing} rows.`;
      roleUncertainty =
        col.uniqueCount > 25 ? 'High cardinality text — verify whether free text, identifier, or grouping factor.' : null;
    } else if (outcomeInfo.isLowCardinalityNumeric) {
      inferredResearchRole = 'categorical_covariate';
      roleEvidence = `Numeric storage with only ${col.uniqueCount} distinct values (${outcomeInfo.observedDistinctSample.join(', ')}).`;
      roleUncertainty =
        'Low-cardinality numeric column: could be a binary/ordinal/nominal variable, a small count, or a numeric covariate — confirm before modeling.';
    } else {
      inferredResearchRole = 'continuous_covariate';
      roleEvidence = `Numeric storage with ${col.uniqueCount} distinct values across ${col.nonMissing} non-missing rows.`;
      roleUncertainty =
        col.isConstant
          ? 'Constant (0 variance) — unsuitable as outcome or regressor.'
          : 'Can serve as either an outcome (Y) or covariate (X) depending on your research question.';
    }

    return {
      stataName: col.stataName,
      label: col.label,
      storageType,
      inferredResearchRole,
      roleEvidence,
      roleUncertainty,
      inferredOutcomeType: outcomeInfo.outcomeType,
      outcomeEvidence: outcomeInfo.evidence,
      outcomeUncertainty: outcomeInfo.uncertainty,
      isLowCardinalityNumeric: outcomeInfo.isLowCardinalityNumeric,
      isNonNegativeInteger: outcomeInfo.isNonNegativeInteger,
      observedDistinctSample: outcomeInfo.observedDistinctSample,
      uniqueCount: col.uniqueCount,
      nonMissing: col.nonMissing,
    };
  });
}

/**
 * Checks within-entity and within-time variation on the active rows for every
 * candidate regressor so fixed-effects absorption (time-invariant or common time-only
 * regressors) is detected deterministically before modeling.
 */
export function evaluateFeAbsorption(
  rows: RawRow[],
  entityVar: string | null,
  timeVar: string | null,
  regressors: string[]
): FeVariationCheck[] {
  return regressors.map((varName) => {
    let entityGroupsEvaluated = 0;
    let entityGroupsWithVariation = 0;
    let timeGroupsEvaluated = 0;
    let timeGroupsWithVariation = 0;

    if (entityVar) {
      const byEntity = new Map<string, number[]>();
      for (const row of rows) {
        const e = (row[entityVar] ?? '').trim();
        const v = parseStrictNumeric(row[varName] ?? '');
        if (!e || v === null) continue;
        if (!byEntity.has(e)) byEntity.set(e, []);
        byEntity.get(e)!.push(v);
      }
      for (const vals of byEntity.values()) {
        if (vals.length < 2) continue;
        entityGroupsEvaluated++;
        let min = vals[0];
        let max = vals[0];
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] < min) min = vals[i];
          if (vals[i] > max) max = vals[i];
        }
        if (max - min > 1e-12) entityGroupsWithVariation++;
      }
    }

    if (timeVar) {
      const byTime = new Map<string, number[]>();
      for (const row of rows) {
        const t = (row[timeVar] ?? '').trim();
        const v = parseStrictNumeric(row[varName] ?? '');
        if (!t || v === null) continue;
        if (!byTime.has(t)) byTime.set(t, []);
        byTime.get(t)!.push(v);
      }
      for (const vals of byTime.values()) {
        if (vals.length < 2) continue;
        timeGroupsEvaluated++;
        let min = vals[0];
        let max = vals[0];
        for (let i = 1; i < vals.length; i++) {
          if (vals[i] < min) min = vals[i];
          if (vals[i] > max) max = vals[i];
        }
        if (max - min > 1e-12) timeGroupsWithVariation++;
      }
    }

    const absorbedByEntityFe = entityGroupsEvaluated > 0 && entityGroupsWithVariation === 0;
    const absorbedByTimeFe = timeGroupsEvaluated > 0 && timeGroupsWithVariation === 0;

    let explanation: string | null = null;
    if (absorbedByEntityFe && absorbedByTimeFe) {
      explanation = `"${varName}" has zero within-entity and zero within-time variation (constant across evaluated groups) and will be absorbed/dropped by fixed effects.`;
    } else if (absorbedByEntityFe) {
      explanation = `"${varName}" is time-invariant within all ${entityGroupsEvaluated} multi-period "${entityVar}" units (0 within-entity variation). Entity fixed effects absorb it completely — Stata drops it due to collinearity.`;
    } else if (absorbedByTimeFe) {
      explanation = `"${varName}" is identical across all units within each "${timeVar}" period (0 within-time variation across ${timeGroupsEvaluated} periods). Time fixed effects absorb it completely — Stata drops it due to collinearity.`;
    }

    return {
      variable: varName,
      absorbedByEntityFe,
      absorbedByTimeFe,
      entityGroupsWithVariation,
      entityGroupsEvaluated,
      timeGroupsWithVariation,
      timeGroupsEvaluated,
      explanation,
    };
  });
}

export function createInitialResearcherConfirmations(
  dataset: DatasetState,
  cleanedRows: RawRow[],
  cleanedPanel: PanelDetection,
  currentSpec: ModelSpec
): ResearcherConfirmations {
  const structureAudit = auditDataStructure(dataset, cleanedPanel);
  const colAudits = auditColumnsForSuggestions(dataset, cleanedRows, structureAudit);

  const defaultOutcomeVar = currentSpec.depVar ?? null;
  const outcomeAudit = defaultOutcomeVar
    ? colAudits.find((c) => c.stataName === defaultOutcomeVar) ?? null
    : null;

  // Never auto-confirm ambiguous low-cardinality numeric outcomes!
  const defaultConfirmedOutcomeType: ConfirmedOutcomeType | null =
    outcomeAudit &&
    outcomeAudit.inferredOutcomeType &&
    outcomeAudit.inferredOutcomeType !== 'ambiguous_low_cardinality_numeric'
      ? outcomeAudit.inferredOutcomeType
      : null;

  const defaultRegressors =
    currentSpec.indepVars.length > 0
      ? currentSpec.indepVars
      : colAudits
          .filter(
            (c) =>
              c.storageType === 'number' &&
              c.stataName !== defaultOutcomeVar &&
              c.inferredResearchRole === 'continuous_covariate'
          )
          .slice(0, 4)
          .map((c) => c.stataName);

  return {
    structureConfirmed: dataset.panel.userConfirmed,
    outcomeVar: defaultOutcomeVar,
    confirmedOutcomeType: defaultConfirmedOutcomeType,
    binaryEventValue: null,
    countHasDifferingExposure: 'unknown',
    countExposureVar: null,
    researchAim: 'description',
    selectedRegressors: defaultRegressors,
  };
}

/**
 * Purely local, deterministic rule engine producing transparent candidate model
 * recommendations with reasons, assumptions, next checks, FE absorption warnings,
 * and explicit boundaries between implemented Model Builder estimators vs. Guidance-only.
 */
export function buildModelSuggestions(
  dataset: DatasetState,
  cleanedRows: RawRow[],
  cleanedPanel: PanelDetection,
  confirmations: ResearcherConfirmations
): ModelSuggestionsReport {
  const structureAudit = auditDataStructure(dataset, cleanedPanel);
  const columnAudits = auditColumnsForSuggestions(dataset, cleanedRows, structureAudit);
  const activeOutcomeAudit = confirmations.outcomeVar
    ? columnAudits.find((c) => c.stataName === confirmations.outcomeVar) ?? null
    : null;

  const outcomeRequiresConfirmation = Boolean(
    activeOutcomeAudit && !confirmations.confirmedOutcomeType
  );

  // Count non-negative integer check
  let countCheck = {
    checked: false,
    passed: true,
    detail: '',
  };
  if (activeOutcomeAudit && confirmations.confirmedOutcomeType === 'count') {
    const passed = activeOutcomeAudit.storageType === 'number' && activeOutcomeAudit.isNonNegativeInteger;
    countCheck = {
      checked: true,
      passed,
      detail: passed
        ? `Verified: all non-missing values of "${activeOutcomeAudit.stataName}" are non-negative integers.`
        : `Warning: "${activeOutcomeAudit.stataName}" contains negative or non-integer values — standard count models (Poisson/NB) require non-negative integer counts.`,
    };
  }

  // Evaluate within-entity and within-time variation for selected regressors
  const entityVarForFe =
    structureAudit.structure === 'candidate_panel'
      ? cleanedPanel.entityVar
      : structureAudit.candidateEntityVar;
  const timeVarForFe =
    structureAudit.structure === 'candidate_panel'
      ? cleanedPanel.timeVar
      : structureAudit.candidateTimeVar;

  const validNumericRegressors = confirmations.selectedRegressors.filter((v) => {
    const col = dataset.columns.find((c) => c.stataName === v);
    return col && col.type === 'numeric' && !col.isAllMissing && !col.isConstant && v !== confirmations.outcomeVar;
  });

  const feVariationChecks = evaluateFeAbsorption(
    cleanedRows,
    entityVarForFe,
    timeVarForFe,
    validNumericRegressors
  );

  const entityAbsorbedVars = feVariationChecks
    .filter((f) => f.absorbedByEntityFe)
    .map((f) => f.variable);
  const timeAbsorbedVars = feVariationChecks
    .filter((f) => f.absorbedByTimeFe)
    .map((f) => f.variable);

  const globalJudgementNotes: string[] = [
    'Clustering level (e.g., robust vs. entity vs. two-way clustering) depends on the sampling and treatment assignment design — confirm based on domain knowledge, not sample size alone.',
    'Functional form choices (levels, logs/asinh, polynomials, interactions) require substantive economic theory and residual diagnostics.',
    confirmations.researchAim === 'causal'
      ? 'Causal identification cannot be inferred from schema alone: treatment assignment, parallel trends, exclusion restrictions, and unconfoundedness require domain justification outside this tool.'
      : confirmations.researchAim === 'prediction'
        ? 'Prediction aims prioritize out-of-sample cross-validation and leakage checks rather than in-sample t-statistics; Folio’s Model Builder focuses on inference scripts.'
        : 'Descriptive associations summarize conditional means in the sample and should not be interpreted as causal effects without an explicit identification design.',
  ];

  const recommendations: CandidateModelRecommendation[] = [];

  if (!activeOutcomeAudit || !confirmations.confirmedOutcomeType) {
    return {
      structureAudit,
      columnAudits,
      activeOutcomeAudit,
      outcomeRequiresConfirmation,
      countNonNegativeIntegerCheck: countCheck,
      feVariationChecks,
      recommendations,
      globalJudgementNotes,
    };
  }

  const outcomeName = activeOutcomeAudit.stataName;
  const outcomeType = confirmations.confirmedOutcomeType;
  const aimNotes =
    confirmations.researchAim === 'causal'
      ? [
          'Causal interpretation requires researcher-verified identification (no automatic claims about treatment assignment, parallel trends, or instruments).',
        ]
      : confirmations.researchAim === 'prediction'
        ? [
            'If prediction is the primary goal, validate out-of-sample performance (e.g., cross-validation or temporal holdout) outside standard inference tables.',
          ]
        : ['Interpret coefficients as conditional descriptive associations, not causal effects.'];

  // -------------------------------------------------------------------------
  // CASE 1: CONTINUOUS OUTCOME
  // -------------------------------------------------------------------------
  if (outcomeType === 'continuous') {
    const canRunOls =
      activeOutcomeAudit.storageType === 'number' &&
      validNumericRegressors.length > 0 &&
      !dataset.columns.find((c) => c.stataName === outcomeName)?.isConstant;

    // 1A. Baseline OLS (always available for continuous numeric outcome)
    const olsReasons: string[] = [
      `Confirmed continuous numeric outcome "${outcomeName}" is suitable for a linear conditional-mean baseline (OLS).`,
    ];
    if (structureAudit.structure === 'dated_cross_section') {
      olsReasons.push(
        `Retains observation-level modeling${structureAudit.uniqueRecordIdVar ? ` (unit: ${structureAudit.uniqueRecordIdVar})` : ''}. Candidate (${structureAudit.candidateEntityVar ?? 'entity'}, ${structureAudit.candidateTimeVar ?? 'time'}) keys cannot be used with Stata xtset because multiple distinct records share the same location-period key.`
      );
    } else if (structureAudit.structure === 'candidate_panel' && cleanedPanel.panelKeyStatus !== 'valid') {
      olsReasons.push(
        `Remains valid and executable without xtset even though panel keys (${cleanedPanel.entityVar}, ${cleanedPanel.timeVar}) are currently invalid (${describeKeyValidityIssues(cleanedPanel)}).`
      );
    } else if (structureAudit.structure === 'time_series') {
      olsReasons.push(
        `Provides a transparent baseline on the single-unit time series indexed by "${structureAudit.candidateTimeVar}", prior to serial-correlation adjustments.`
      );
    }

    recommendations.push({
      id: 'ols_baseline',
      title:
        structureAudit.structure === 'dated_cross_section'
          ? 'Observation-Level OLS Baseline (regress)'
          : 'Linear OLS Baseline (regress)',
      estimatorLabel: 'OLS (regress, vce(robust))',
      implementationStatus: canRunOls ? 'implemented_ready' : 'implemented_blocked',
      blockedReason: canRunOls
        ? null
        : activeOutcomeAudit.storageType !== 'number'
          ? `Outcome "${outcomeName}" is stored as ${activeOutcomeAudit.storageType}, not numeric.`
          : 'Select at least one numeric covariate above to build an executable Model Builder draft.',
      reasons: olsReasons,
      assumptions: [
        'Linear conditional expectation in the chosen functional form (levels/logs).',
        'Zero conditional mean of errors for unbiased descriptive/causal slopes (stronger exogeneity required if causal).',
        structureAudit.structure === 'time_series'
          ? 'Standard OLS SEs assume no serial correlation — inspect autocorrelation before relying on robust SEs.'
          : 'Heteroskedasticity-robust SEs handle non-constant error variance; group correlation requires clustering judgement.',
      ],
      nextChecks: [
        'Inspect residual skewness, extreme tails, and nonlinearities in Diagnostics.',
        'Check collinearity via VIF (estat vif) and heteroskedasticity via Breusch-Pagan.',
        ...(structureAudit.structure === 'dated_cross_section' && structureAudit.candidateEntityVar
          ? [
              `Consider whether unobserved "${structureAudit.candidateEntityVar}" or "${structureAudit.candidateTimeVar ?? 'period'}" shocks warrant absorbed group fixed effects and clustered SEs.`,
            ]
          : []),
      ],
      absorptionWarnings: [],
      researcherJudgementNotes: [
        ...aimNotes,
        'Choose clustering level and functional form (e.g., ln / asinh for skewed positive outcomes) based on study design.',
      ],
      builderSpecDraft: canRunOls
        ? {
            estimator: 'ols',
            depVar: outcomeName,
            indepVars: validNumericRegressors,
            seType: 'robust',
          }
        : undefined,
    });

    // 1B. Dated cross-section optional group/period FE via reghdfe (NO xtset!)
    if (
      structureAudit.structure === 'dated_cross_section' &&
      structureAudit.candidateEntityVar &&
      structureAudit.candidateTimeVar
    ) {
      const absorbGroupTime = [structureAudit.candidateEntityVar, structureAudit.candidateTimeVar];
      const absWarnings = feVariationChecks
        .filter((f) => f.absorbedByEntityFe || f.absorbedByTimeFe)
        .map((f) => f.explanation!)
        .filter(Boolean);
      const nonAbsorbedX = validNumericRegressors.filter(
        (v) => !entityAbsorbedVars.includes(v) && !timeAbsorbedVars.includes(v)
      );

      recommendations.push({
        id: 'dated_cs_group_fe',
        title: `Observation-Level Model with Group & Period Fixed Effects (reghdfe)`,
        estimatorLabel: `reghdfe, absorb(${absorbGroupTime.join(' ')})`,
        implementationStatus:
          canRunOls && nonAbsorbedX.length > 0 ? 'implemented_ready' : 'implemented_blocked',
        blockedReason:
          !canRunOls
            ? 'Requires a numeric outcome and at least one numeric regressor.'
            : nonAbsorbedX.length === 0
              ? 'All selected regressors are absorbed by the chosen group/period fixed effects.'
              : null,
        reasons: [
          `Keeps individual-record modeling${structureAudit.uniqueRecordIdVar ? ` (${structureAudit.uniqueRecordIdVar})` : ''} without forcing xtset on non-unique (${absorbGroupTime.join(', ')}) keys.`,
          `Absorbs common "${structureAudit.candidateEntityVar}" and "${structureAudit.candidateTimeVar}" level shifts via reghdfe (which does not require xtset).`,
        ],
        assumptions: [
          'Group and period shocks enter additively into the outcome equation.',
          'Remaining regressors vary within group-period cells.',
        ],
        nextChecks: [
          'Verify fitted e(N) after reghdfe in case singleton location-period cells are dropped.',
          'Decide whether standard errors should be clustered by location/group.',
        ],
        absorptionWarnings: absWarnings,
        researcherJudgementNotes: [
          ...aimNotes,
          'Do NOT collapse or deduplicate distinct records solely to force xtset unless your research question is truly at the aggregated location-period level.',
        ],
        builderSpecDraft:
          canRunOls && nonAbsorbedX.length > 0
            ? {
                estimator: 'fe_reghdfe',
                depVar: outcomeName,
                indepVars: nonAbsorbedX,
                absorbVars: absorbGroupTime,
                seType: 'robust',
              }
            : undefined,
      });
    }

    // 1C. Panel Fixed Effects (xtreg, fe) & Two-Way FE (reghdfe) for candidate_panel
    if (structureAudit.structure === 'candidate_panel' && cleanedPanel.entityVar && cleanedPanel.timeVar) {
      const panelKeysValid = cleanedPanel.panelKeyStatus === 'valid';
      const panelReadyForXtset = panelKeysValid && cleanedPanel.userConfirmed;

      const entityAbsWarnings = feVariationChecks
        .filter((f) => f.absorbedByEntityFe)
        .map((f) => f.explanation!)
        .filter(Boolean);
      const twoWayAbsWarnings = feVariationChecks
        .filter((f) => f.absorbedByEntityFe || f.absorbedByTimeFe)
        .map((f) => f.explanation!)
        .filter(Boolean);

      const entityVaryingX = validNumericRegressors.filter((v) => !entityAbsorbedVars.includes(v));
      const twoWayVaryingX = validNumericRegressors.filter(
        (v) => !entityAbsorbedVars.includes(v) && !timeAbsorbedVars.includes(v)
      );

      let xtregBlocked: string | null = null;
      if (!panelKeysValid) {
        xtregBlocked = `Panel keys (${cleanedPanel.entityVar}, ${cleanedPanel.timeVar}) are invalid on current rows (${describeKeyValidityIssues(cleanedPanel)}); Stata xtset rejects missing/repeated keys.`;
      } else if (!cleanedPanel.userConfirmed) {
        xtregBlocked = 'Confirm panel keys in the Inspector before running xtreg / xtset.';
      } else if (!canRunOls) {
        xtregBlocked = 'Select a numeric outcome and at least one varying numeric regressor.';
      } else if (entityVaryingX.length === 0) {
        xtregBlocked = `All selected regressors are time-invariant within "${cleanedPanel.entityVar}" and would be absorbed by entity FE.`;
      }

      recommendations.push({
        id: 'panel_entity_fe',
        title: `Entity Fixed Effects (xtreg, fe)`,
        estimatorLabel: `xtreg, fe (panel: ${cleanedPanel.entityVar}, ${cleanedPanel.timeVar})`,
        implementationStatus: xtregBlocked ? 'implemented_blocked' : 'implemented_ready',
        blockedReason: xtregBlocked,
        reasons: [
          `Valid panel structure (${cleanedPanel.numEntities} units × ${cleanedPanel.numPeriods} periods; ${formatBalanceLabel(cleanedPanel)}) allows within-entity estimation controlling for time-invariant unobserved unit heterogeneity.`,
          entityVaryingX.length > 0
            ? `${entityVaryingX.length} of ${validNumericRegressors.length} selected regressor(s) exhibit within-${cleanedPanel.entityVar} variation.`
            : 'Check within-entity variation of regressors before applying entity FE.',
        ],
        assumptions: [
          'Unobserved entity heterogeneity is time-invariant and additive.',
          'Strict exogeneity of time-varying regressors conditional on entity fixed effects (required for consistent within estimates).',
        ],
        nextChecks: [
          'Compare Entity FE vs. Random Effects with a Hausman or Mundlak check (note: classical Hausman requires non-clustered SEs).',
          'Check whether entity-level clustering is warranted for serial correlation within units.',
        ],
        absorptionWarnings: entityAbsWarnings,
        researcherJudgementNotes: [
          ...aimNotes,
          'Entity FE removes all cross-sectional between-unit variation; only use it if within-unit changes match your substantive question.',
        ],
        builderSpecDraft: xtregBlocked
          ? undefined
          : {
              estimator: 'fe_xtreg',
              depVar: outcomeName,
              indepVars: entityVaryingX,
              seType: 'cluster_entity',
            },
      });

      // Two-Way FE (reghdfe)
      let twfeBlocked: string | null = null;
      if (!panelKeysValid) {
        twfeBlocked = `Resolve invalid panel keys (${describeKeyValidityIssues(cleanedPanel)}) before interpreting two-way panel FE.`;
      } else if (!canRunOls) {
        twfeBlocked = 'Select a numeric outcome and at least one numeric regressor.';
      } else if (twoWayVaryingX.length === 0) {
        twfeBlocked =
          'Every selected regressor is absorbed by either entity FE or time FE (no regressor varies both within entities and within periods).';
      }

      recommendations.push({
        id: 'panel_twoway_fe',
        title: `Two-Way Fixed Effects (reghdfe)`,
        estimatorLabel: `reghdfe, absorb(${cleanedPanel.entityVar} ${cleanedPanel.timeVar})`,
        implementationStatus: twfeBlocked ? 'implemented_blocked' : 'implemented_ready',
        blockedReason: twfeBlocked,
        reasons: [
          `Absorbs both time-invariant "${cleanedPanel.entityVar}" differences and common "${cleanedPanel.timeVar}" period shocks simultaneously.`,
          twoWayVaryingX.length > 0
            ? `${twoWayVaryingX.length} of ${validNumericRegressors.length} selected regressor(s) vary both within entities and within periods.`
            : 'All selected regressors are absorbed by entity or time fixed effects.',
        ],
        assumptions: [
          'Unit and period shocks are additive and homogeneous in the chosen functional form.',
          'If studying staggered policy adoption, homogeneous treatment effects are required for standard TWFE (consider heterogeneity-robust DiD estimators outside Folio if applicable).',
        ],
        nextChecks: [
          'Inspect fitted e(N) vs. pre-estimation complete cases for any singleton FE groups dropped by reghdfe.',
          'Check whether any macro/time-only regressor (e.g., national rate) was absorbed by period FE.',
        ],
        absorptionWarnings: twoWayAbsWarnings,
        researcherJudgementNotes: [
          ...aimNotes,
          'Two-way FE does not automatically establish parallel trends or causal identification — those remain substantive research assumptions.',
        ],
        builderSpecDraft: twfeBlocked
          ? undefined
          : {
              estimator: 'fe_reghdfe',
              depVar: outcomeName,
              indepVars: twoWayVaryingX,
              absorbVars: [cleanedPanel.entityVar, cleanedPanel.timeVar],
              seType: panelReadyForXtset ? 'cluster_entity' : 'robust',
            },
      });
    }

    // 1D. Time series guidance-only note
    if (structureAudit.structure === 'time_series') {
      recommendations.push({
        id: 'ts_newey_arima_guidance',
        title: 'Serial-Correlation-Robust / Time-Series Models (Newey-West, ARDL, ARIMA)',
        estimatorLabel: 'Guidance only — not implemented in Model Builder',
        implementationStatus: 'guidance_only',
        blockedReason: null,
        reasons: [
          `Single-unit time series indexed by "${structureAudit.candidateTimeVar}" often exhibits autocorrelation and non-stationarity.`,
        ],
        assumptions: [
          'Stationarity (or cointegration) of included series; appropriate lag structure.',
        ],
        nextChecks: [
          'In Stata, run `tsset`, `dfuller` (unit root tests), `ac`/`pac` correlograms, and `estat bgodfrey` for serial correlation.',
          'Consider `newey` (HAC standard errors) or dynamic `arima`/`ardl` specifications in Stata.',
        ],
        absorptionWarnings: [],
        researcherJudgementNotes: aimNotes,
      });
    }
  }

  // -------------------------------------------------------------------------
  // CASE 2: CONFIRMED BINARY OUTCOME
  // -------------------------------------------------------------------------
  if (outcomeType === 'binary') {
    const eventNote = confirmations.binaryEventValue
      ? `Confirmed event (Y = 1): "${confirmations.binaryEventValue}".`
      : 'Confirm which observed value corresponds to the event (1) before estimating.';

    recommendations.push({
      id: 'binary_logit_probit',
      title: 'Binary Choice Model — Logit or Probit',
      estimatorLabel: 'Guidance only — not implemented in Model Builder',
      implementationStatus: 'guidance_only',
      blockedReason: null,
      reasons: [
        `Confirmed binary outcome "${outcomeName}". ${eventNote}`,
        'Logit (`logit`) and Probit (`probit`) bound predicted probabilities strictly to (0, 1) and respect Bernoulli variance.',
        ...(structureAudit.structure === 'candidate_panel' && cleanedPanel.panelKeyStatus === 'valid'
          ? ['For panel data with entity fixed effects, note the incidental-parameters problem for nonlinear FE; consider conditional logit (`xtlogit, fe`) or correlated random effects (Mundlak).']
          : []),
      ],
      assumptions: [
        'Logistic (logit) or standard normal (probit) link function for P(Y = 1 | X).',
        'Correct specification of the linear index and no quasi-complete separation.',
      ],
      nextChecks: [
        'Report average marginal effects (`margins, dydx(*)`) rather than raw log-odds alone.',
        'Check for perfect prediction / separation across sparse categorical cells.',
      ],
      absorptionWarnings:
        structureAudit.structure === 'candidate_panel'
          ? feVariationChecks.filter((f) => f.absorbedByEntityFe).map((f) => f.explanation!).filter(Boolean)
          : [],
      researcherJudgementNotes: [
        ...aimNotes,
        'Folio’s current Model Builder generates linear models only (regress / xtreg / reghdfe); write `logit` / `probit` / `xtlogit` directly in Stata.',
      ],
    });
  }

  // -------------------------------------------------------------------------
  // CASE 3: CONFIRMED COUNT OUTCOME
  // -------------------------------------------------------------------------
  if (outcomeType === 'count') {
    const exposureNote =
      confirmations.countHasDifferingExposure === 'yes'
        ? confirmations.countExposureVar
          ? `Differing exposure confirmed (exposure variable: "${confirmations.countExposureVar}") — include \`exposure(${confirmations.countExposureVar})\` (or \`offset(ln_${confirmations.countExposureVar})\`) in Poisson/PPML.`
          : 'Differing exposure confirmed — specify an exposure/time-at-risk variable (`exposure(t)` / `offset(ln_t)`) so coefficients model event rates rather than raw totals.'
        : confirmations.countHasDifferingExposure === 'no'
          ? 'Equal exposure across observations confirmed; no offset/exposure term required.'
          : 'Confirm whether observations differ in time-at-risk, population, or denominator size (exposure/offset).';

    recommendations.push({
      id: 'count_poisson_ppml',
      title: 'Count Outcome — Poisson / Quasi-Poisson (PPML)',
      estimatorLabel: 'Guidance only — not implemented in Model Builder',
      implementationStatus: 'guidance_only',
      blockedReason: null,
      reasons: [
        `Confirmed count outcome "${outcomeName}". ${countCheck.detail}`,
        exposureNote,
        'Poisson pseudo-maximum likelihood (`poisson ..., vce(robust)` or `ppmlhdfe` for high-dimensional FEs) remains consistent for the conditional mean under overdispersion as long as the log-link mean is correctly specified.',
      ],
      assumptions: [
        'Non-negative outcome with multiplicative (log-link) conditional mean E[Y | X] = exp(Xβ) × Exposure.',
        'Use robust/clustered SEs (quasi-Poisson) because raw Poisson SEs assume Var(Y|X) = E[Y|X].',
      ],
      nextChecks: [
        'Check overdispersion (variance vs. mean) and excess zeros; compare with Negative Binomial (`nbreg`) only if distributional efficiency is needed (note NB consistency requires stronger distributional assumptions than Poisson QMLE).',
        ...(confirmations.countHasDifferingExposure === 'yes'
          ? ['Verify the exposure variable is strictly positive (> 0) for all estimation observations.']
          : []),
      ],
      absorptionWarnings: [],
      researcherJudgementNotes: [
        ...aimNotes,
        'Folio’s current Model Builder does not generate Poisson/PPML scripts; use Stata `poisson` or `ppmlhdfe` directly.',
      ],
    });
  }

  // -------------------------------------------------------------------------
  // CASE 4: CONFIRMED ORDINAL OR NOMINAL OUTCOME
  // -------------------------------------------------------------------------
  if (outcomeType === 'ordinal') {
    recommendations.push({
      id: 'ordinal_ologit',
      title: 'Ordered Outcome — Ordered Logit / Ordered Probit',
      estimatorLabel: 'Guidance only — not implemented in Model Builder',
      implementationStatus: 'guidance_only',
      blockedReason: null,
      reasons: [
        `Confirmed ordinal outcome "${outcomeName}" preserves rank ordering without assuming equal spacing between numeric category codes.`,
      ],
      assumptions: [
        'Proportional odds / parallel-lines assumption across category thresholds (for standard `ologit`/`oprobit`).',
      ],
      nextChecks: [
        'Test proportional odds (e.g., Brant test in Stata) and inspect predicted category probabilities (`margins`).',
      ],
      absorptionWarnings: [],
      researcherJudgementNotes: aimNotes,
    });
  }

  if (outcomeType === 'nominal') {
    recommendations.push({
      id: 'nominal_mlogit',
      title: 'Unordered Categorical Outcome — Multinomial Logit',
      estimatorLabel: 'Guidance only — not implemented in Model Builder',
      implementationStatus: 'guidance_only',
      blockedReason: null,
      reasons: [
        `Confirmed unordered nominal outcome "${outcomeName}" should not be regressed linearly on arbitrary numeric codes.`,
      ],
      assumptions: [
        'Independence of irrelevant alternatives (IIA) for standard `mlogit`.',
      ],
      nextChecks: [
        'Choose an interpretable base category (`baseoutcome()`) and report average marginal effects per category.',
      ],
      absorptionWarnings: [],
      researcherJudgementNotes: aimNotes,
    });
  }

  return {
    structureAudit,
    columnAudits,
    activeOutcomeAudit,
    outcomeRequiresConfirmation,
    countNonNegativeIntegerCheck: countCheck,
    feVariationChecks,
    recommendations,
    globalJudgementNotes,
  };
}
