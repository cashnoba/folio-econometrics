export type InferredType = 'numeric' | 'categorical' | 'string' | 'date';

export type VariableRole = 'identifier' | 'time' | 'covariate';

export type TimeCadence = 'none' | 'annual' | 'quarterly' | 'monthly' | 'daily';

export type SourceFormat = 'csv' | 'xlsx' | 'demo';

export type LogTransformMode = 'ln' | 'ln1p' | 'asinh';

export type EstimatorType = 'ols' | 'fe_xtreg' | 'fe_reghdfe' | 're_xtreg';

export type StandardErrorType = 'default' | 'robust' | 'cluster_entity' | 'cluster_twoway';

export type StataImportMode = 'normalized_bundle' | 'original_source';

export type LatexPageFitPreset = 'compact_article' | 'compact_6col' | 'standard';

export type OutlierMethod = 'iqr' | 'zscore';

export type WorkspaceTab = 'inspector' | 'diagnostics' | 'suggestions' | 'stata' | 'latex';

export type DiagnosticsSubTab = 'summary' | 'quality' | 'correlation';

export type StructureKind =
  | 'panel'
  | 'dated_cross_section'
  | 'cross_section';

export type PanelKeyStatus =
  | 'valid'
  | 'invalid_missing_keys'
  | 'invalid_repeated_keys'
  | 'invalid_missing_and_repeated'
  | 'not_panel';

export type PanelBalanceStatus =
  | 'strongly_balanced'
  | 'weakly_balanced'
  | 'unbalanced'
  | 'undefined_invalid_keys'
  | 'not_applicable';

export type SeriesAggregation = 'none' | 'mean' | 'median' | 'sum' | 'entity';

export interface ColumnProfile {
  /** Original header text from CSV/XLSX */
  rawName: string;
  /** Deterministic, collision-free Stata identifier (<=32 chars) */
  stataName: string;
  /** True when rawName had to be normalized or deduplicated */
  wasRenamed: boolean;
  /** Single-source academic variable label propagated to Stata & LaTeX */
  label: string;
  type: InferredType;
  /** Distinguishes identifiers, time fields, and substantive covariates */
  role: VariableRole;
  /** Auto-inferred time cadence for date/period columns */
  inferredTimeCadence: TimeCadence;
  /** User-confirmed (or auto-confirmed) time cadence for Stata %td/%tm/%tq formatting */
  confirmedTimeCadence: TimeCadence;
  /** True when leading zeros were detected (e.g. "00123" or Excel 00000 format) */
  preserveLeadingZeros: boolean;
  /** True when long >=15-digit integer IDs were detected and must remain string */
  preserveLongId: boolean;
  /** Width of explicit zero-pad format if detected from Excel (e.g., 5 for "00000") */
  zeroPadWidth: number | null;
  /** True when values came from Excel date serials or formatted dates */
  isExcelDateColumn: boolean;
  /** Count of Excel numeric cells whose stored value differed from displayed text (e.g. 13.5 vs 14) */
  excelPrecisionDiffCount: number;
  /** Example stored-vs-displayed precision difference for user transparency */
  excelPrecisionExample: string | null;
  /** 1-based column index for Stata import delimited stringcols() */
  columnIndex: number;
  nonMissing: number;
  missingCount: number;
  missingPct: number;
  uniqueCount: number;
  isAllMissing: boolean;
  isConstant: boolean;
  /** For numeric columns: count of values <= 0, == 0, < 0, and <= -1 */
  nonPositiveCount: number;
  zeroCount: number;
  negativeCount: number;
  leqNegOneCount: number;
  sampleValues: string[];
}

export interface PanelDetection {
  /** High-level classification of the observation structure */
  structureKind: StructureKind;
  /** Detected unique record ID column (e.g. loan_id) if one exists */
  uniqueRecordIdVar: string | null;
  /** Auto-suggested or user-confirmed panel mode */
  isPanel: boolean;
  entityVar: string | null;
  timeVar: string | null;
  /** Candidate keys suggested even when structureKind is dated_cross_section */
  candidateEntityVar: string | null;
  candidateTimeVar: string | null;
  entityIsString: boolean;
  /** Plain-English explanation of why these keys / structure were detected */
  detectionReason: string;
  /** Explicit key validity on this evaluated row slice (strictly separate from balance) */
  panelKeyStatus: PanelKeyStatus;
  /** Panel balance status — defined ONLY when panelKeyStatus === 'valid' */
  balanceStatus: PanelBalanceStatus;
  /** Convenience boolean: true ONLY when balanceStatus === 'strongly_balanced' */
  isBalanced: boolean;
  numEntities: number;
  numPeriods: number;
  minPeriodsPerEntity: number;
  maxPeriodsPerEntity: number;
  missingEntityRows: number;
  missingTimeRows: number;
  /** Rows missing either entity or time key */
  missingKeyRows: number;
  /** Number of distinct (entity, time) groups appearing more than once */
  repeatedKeyGroups: number;
  /** Excess rows beyond 1 per (entity, time) group */
  duplicateKeyPairs: number;
  /** Exact full-row duplicates inside this evaluated row slice */
  exactDuplicateRows: number;
  /** Excess key-sharing rows that are NOT exact duplicates (distinct records sharing a key) */
  distinctKeyConflictRows: number;
  /** True if user confirmed or edited the panel keys */
  userConfirmed: boolean;
}

export interface RawRow {
  /** Canonical stored string representation keyed by stataName ("" for missing) */
  [stataName: string]: string;
}

export interface SheetPreviewMeta {
  name: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  previewRows: string[][];
  looksLikeNotes: boolean;
}

export interface DatasetState {
  id: string;
  fileName: string;
  sourceFormat: SourceFormat;
  isDemo: boolean;
  availableSheets: string[];
  selectedSheet: string | null;
  /** For Excel workbooks: '1900' | '1904' | null */
  excelDateSystem: '1900' | '1904' | null;
  /** Explicit user-facing notes about Excel precision/date/cadence conversions */
  conversionNotices: string[];
  missingTokens: string[];
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  rows: RawRow[];
  panel: PanelDetection;
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}

export interface BoxplotStats {
  min: number;
  lowerWhisker: number;
  q1: number;
  median: number;
  q3: number;
  upperWhisker: number;
  max: number;
  mean: number;
  outliersIqr: number[];
  outliersZ: number[];
}

export interface NumericSummary {
  stataName: string;
  label: string;
  n: number;
  missing: number;
  mean: number;
  sd: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  skewness: number;
  nonPositiveCount: number;
  zeroCount: number;
  negativeCount: number;
  leqNegOneCount: number;
  iqrOutlierCount: number;
  iqrExtremeCount: number;
  zOutlierCount: number;
  histogram: HistogramBin[];
  boxplot: BoxplotStats;
}

export interface CorrelationPair {
  varA: string;
  varB: string;
  r: number;
  n: number;
}

export interface CorrelationMatrixData {
  variables: string[];
  matrix: Record<string, Record<string, { r: number | null; n: number }>>;
  minPairwiseN: number;
  maxPairwiseN: number;
}

export interface DiagnosticsReport {
  summaries: NumericSummary[];
  summaryMap: Record<string, NumericSummary>;
  exactDuplicateRows: number;
  /** Rows non-missing across EVERY column in the raw dataset */
  completeCaseRows: number;
  /** Rows non-missing across all numeric diagnostics variables in the raw dataset */
  completeCaseNumericRows: number;
  correlation: CorrelationMatrixData;
}

export interface DiagnosticsOptions {
  vif: boolean;
  breuschPagan: boolean;
  hausman: boolean;
  esttab: boolean;
}

export interface ModelSpec {
  importMode: StataImportMode;
  dropExactDuplicates: boolean;
  winsorizeVars: string[];
  winsorizeLevel: 1 | 5;
  logTransforms: Record<string, LogTransformMode>;
  estimator: EstimatorType;
  depVar: string | null;
  indepVars: string[];
  absorbVars: string[];
  seType: StandardErrorType;
  diagnostics: DiagnosticsOptions;
}

export interface PostDedupPanelCheck {
  checked: boolean;
  panelKeyStatus: PanelKeyStatus;
  balanceStatus: PanelBalanceStatus;
  duplicateKeyPairs: number;
  repeatedKeyGroups: number;
  distinctKeyConflictRows: number;
  missingEntityRows: number;
  missingTimeRows: number;
  missingKeyRows: number;
  isBalanced: boolean;
  isSafeForXtset: boolean;
}

export interface ColumnSuitabilityIssue {
  stataName: string;
  severity: 'error' | 'warning';
  scope: 'dataset' | 'estimation_sample';
  reason: string;
}

export interface ModelSuitabilityReport {
  /** Dataset-level issues (all-missing or constant columns anywhere in dataset) */
  datasetIssues: Record<string, ColumnSuitabilityIssue>;
  /** Estimation-sample issues (e.g., variable becomes constant after listwise deletion) */
  estimationIssues: Record<string, ColumnSuitabilityIssue>;
  /** True when the proposed model cannot be validly estimated/exported */
  modelBlocked: boolean;
  blockingReasons: string[];
  warnings: string[];
}

export interface SampleImpactStep {
  id: string;
  label: string;
  detail: string;
  rowsRemaining: number;
  rowsAffected: number;
  kind: 'base' | 'drop' | 'modify' | 'final';
}

export interface SampleImpact {
  startingN: number;
  afterExactDuplicatesN: number;
  exactDuplicatesRemoved: number;
  logDomainNewMissing: Array<{ variable: string; mode: LogTransformMode; count: number }>;
  winsorizedValueCounts: Array<{ variable: string; count: number }>;
  listwiseMissingDropped: number;
  previewCompleteCasesN: number;
  postDedupPanelCheck: PostDedupPanelCheck;
  /** Full panel recomputation on the cleaned rows for unified preview & LaTeX reporting */
  cleanedPanel: PanelDetection;
  /** Variable suitability rechecked on the complete-case estimation sample */
  suitability: ModelSuitabilityReport;
  steps: SampleImpactStep[];
}

export interface DiagnosticCompatibility {
  vifMode: 'direct' | 'auxiliary_ols' | 'unavailable';
  vifNote: string;
  bpMode: 'direct' | 'auxiliary_ols' | 'unavailable';
  bpNote: string;
  hausmanMode: 'direct' | 'classical_block' | 'unavailable';
  hausmanNote: string;
  xtregAllowed: boolean;
  xtregBlockReason: string | null;
}

export interface LatexConfig {
  tableType: 'summary' | 'correlation';
  sampleScope: 'raw' | 'cleaned';
  pageFitPreset: LatexPageFitPreset;
  useResizeBox: boolean;
  decimals: 1 | 2 | 3 | 4;
  selectedVars: string[];
  caption: string;
  label: string;
  highlightThreshold: number;
  boldHighCorrelations: boolean;
}

export interface SpecProposalPatch {
  summaryTitle: string;
  dropExactDuplicates?: boolean;
  winsorizeVars?: string[];
  winsorizeLevel?: 1 | 5;
  logTransforms?: Array<{ variable: string; mode: LogTransformMode }>;
  estimator?: EstimatorType;
  depVar?: string;
  indepVars?: string[];
  absorbVars?: string[];
  seType?: StandardErrorType;
  diagnostics?: Partial<DiagnosticsOptions>;
}

export interface SpecDiffItem {
  field: string;
  before: string;
  after: string;
}

export interface ValidatedProposal {
  rawTitle: string;
  nextSpec: ModelSpec;
  diffs: SpecDiffItem[];
  validationNotes: string[];
  isValid: boolean;
}

export type AssistantRoleId =
  | 'econometrician'
  | 'stata_auditor'
  | 'referee_critic'
  | 'latex_editor';

export type AssistantReasoningMode = 'fast' | 'general' | 'interactive' | 'deep';

export interface AssistantMessage {
  id: string;
  /** Origin dataset ID so proposals can never leak across dataset switches */
  datasetId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** Specialist role and reasoning mode used for this assistant response */
  assistantRoleId?: AssistantRoleId;
  reasoningMode?: AssistantReasoningMode;
  modelUsed?: string;
  /** Raw AI patch revalidated dynamically against current ModelSpec & dataset on Apply */
  rawPatch?: SpecProposalPatch | null;
  applied?: boolean;
  error?: boolean;
}
