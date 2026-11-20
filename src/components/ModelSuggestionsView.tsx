import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  Info,
  ShieldAlert,
} from 'lucide-react';
import type {
  DatasetState,
  ModelSpec,
  PanelDetection,
  RawRow,
} from '../types/econometrics';
import {
  buildModelSuggestions,
  createInitialResearcherConfirmations,
  type CandidateModelRecommendation,
  type ConfirmedOutcomeType,
  type ResearchAim,
  type ResearcherConfirmations,
} from '../lib/modelSuggestions';
import { formatPanelStatusHeadline } from '../lib/panelStatus';

interface ModelSuggestionsViewProps {
  dataset: DatasetState;
  cleanedRows: RawRow[];
  cleanedPanel: PanelDetection;
  currentSpec: ModelSpec;
  onReviewInModelBuilder: (
    draft: NonNullable<CandidateModelRecommendation['builderSpecDraft']>,
    title: string
  ) => void;
  onJumpToInspector: () => void;
}

const STORAGE_LABELS: Record<string, string> = {
  number: 'Number',
  text: 'Text',
  date: 'Date / Period',
  all_missing: 'All missing',
};

const ROLE_LABELS: Record<string, string> = {
  record_identifier: 'Record ID',
  entity_identifier: 'Entity / Unit ID',
  time: 'Time / Period',
  outcome: 'Outcome',
  categorical_covariate: 'Categorical / Coded',
  continuous_covariate: 'Numeric Covariate / Outcome',
};

const OUTCOME_TYPE_LABELS: Record<string, string> = {
  continuous: 'Continuous',
  binary: 'Binary (2 states)',
  count: 'Count (non-neg. integer)',
  ordinal: 'Ordinal (ordered categories)',
  nominal: 'Nominal (unordered categories)',
  ambiguous_low_cardinality_numeric: 'Ambiguous — confirm scale',
};

const OUTCOME_CONFIRMATION_OPTIONS: Array<{
  value: ConfirmedOutcomeType;
  label: string;
  hint: string;
}> = [
  { value: 'continuous', label: 'Continuous', hint: 'Numeric magnitude (e.g., price, wage, rate)' },
  { value: 'binary', label: 'Binary', hint: 'Two mutually exclusive outcomes (0/1, Yes/No)' },
  { value: 'count', label: 'Count', hint: 'Non-negative integer event counts (0, 1, 2, …)' },
  { value: 'ordinal', label: 'Ordinal', hint: 'Ordered levels without equal intervals' },
  { value: 'nominal', label: 'Nominal', hint: 'Unordered categories / numeric codes' },
];

const RESEARCH_AIM_OPTIONS: Array<{ value: ResearchAim; label: string; desc: string }> = [
  { value: 'description', label: 'Description', desc: 'Conditional associations & summaries' },
  { value: 'prediction', label: 'Prediction', desc: 'Forecasting / out-of-sample accuracy' },
  { value: 'causal', label: 'Causal estimation', desc: 'Requires domain identification design' },
];

export const ModelSuggestionsView: React.FC<ModelSuggestionsViewProps> = ({
  dataset,
  cleanedRows,
  cleanedPanel,
  currentSpec,
  onReviewInModelBuilder,
  onJumpToInspector,
}) => {
  const [confirmations, setConfirmations] = useState<ResearcherConfirmations>(() =>
    createInitialResearcherConfirmations(dataset, cleanedRows, cleanedPanel, currentSpec)
  );

  const report = useMemo(
    () => buildModelSuggestions(dataset, cleanedRows, cleanedPanel, confirmations),
    [dataset, cleanedRows, cleanedPanel, confirmations]
  );

  const outcomeCandidates = useMemo(
    () =>
      report.columnAudits.filter(
        (c) =>
          c.storageType !== 'all_missing' &&
          c.storageType !== 'date' &&
          c.inferredResearchRole !== 'record_identifier' &&
          c.inferredResearchRole !== 'time'
      ),
    [report.columnAudits]
  );

  const numericCovariateCandidates = useMemo(
    () =>
      dataset.columns.filter(
        (c) =>
          c.type === 'numeric' &&
          !c.isAllMissing &&
          !c.isConstant &&
          c.stataName !== confirmations.outcomeVar
      ),
    [dataset.columns, confirmations.outcomeVar]
  );

  const handleSelectOutcomeVar = (nextVar: string) => {
    const varName = nextVar || null;
    const audit = varName
      ? report.columnAudits.find((c) => c.stataName === varName) ?? null
      : null;

    // Never auto-confirm low-cardinality numeric columns — force explicit researcher choice
    const nextOutcomeType: ConfirmedOutcomeType | null =
      audit &&
      audit.inferredOutcomeType &&
      audit.inferredOutcomeType !== 'ambiguous_low_cardinality_numeric'
        ? audit.inferredOutcomeType
        : null;

    const defaultEvent =
      audit && nextOutcomeType === 'binary' && audit.observedDistinctSample.length === 2
        ? audit.observedDistinctSample[1]
        : null;

    setConfirmations((prev) => ({
      ...prev,
      outcomeVar: varName,
      confirmedOutcomeType: nextOutcomeType,
      binaryEventValue: defaultEvent,
      countHasDifferingExposure: 'unknown',
      countExposureVar: null,
      selectedRegressors: prev.selectedRegressors.filter((r) => r !== varName),
    }));
  };

  const handleToggleRegressor = (varName: string) => {
    setConfirmations((prev) => {
      const exists = prev.selectedRegressors.includes(varName);
      return {
        ...prev,
        selectedRegressors: exists
          ? prev.selectedRegressors.filter((v) => v !== varName)
          : [...prev.selectedRegressors, varName],
      };
    });
  };

  const { structureAudit, activeOutcomeAudit } = report;
  const absorbedChecks = report.feVariationChecks.filter(
    (c) => c.absorbedByEntityFe || c.absorbedByTimeFe
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <section className="bg-white border border-[#E5E0D6] rounded-md p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#1B365D]">
              <Compass className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Deterministic Client-Side Model Guidance</span>
            </div>
            <h2 className="font-serif text-xl font-bold text-[#17202A]">
              Model Suggestions &amp; Specification Audit
            </h2>
            <p className="text-sm text-[#52606D] leading-relaxed">
              Evaluates storage types, research roles, data structure, outcome scale, and
              within-group fixed-effects variation locally in your browser without sending data
              to any external model. Nothing is auto-applied to the Model Builder.
            </p>
          </div>
          <div className="text-xs text-[#52606D] bg-[#FAF8F4] border border-[#E5E0D6] rounded px-3.5 py-2.5 space-y-1 shrink-0">
            <div className="font-medium text-[#17202A]">Active evaluation sample</div>
            <div className="font-mono tabular-nums">
              {cleanedRows.length.toLocaleString('en-US')} cleaned rows ·{' '}
              {dataset.columnCount} variables
            </div>
            <div className="text-[11px] text-[#7B8794]">
              {formatPanelStatusHeadline(cleanedPanel)}
            </div>
          </div>
        </div>
      </section>

      {/* Main 2-Column Workspace: Left Confirmations, Right Candidate Models */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Researcher Confirmation Form (5 cols) */}
        <section className="lg:col-span-5 bg-white border border-[#E5E0D6] rounded-md p-5 space-y-5">
          <div className="border-b border-[#EFECE6] pb-3">
            <h3 className="font-serif text-base font-bold text-[#17202A]">
              1. Researcher Confirmations
            </h3>
            <p className="text-xs text-[#52606D] mt-0.5">
              Confirm structure, outcome scale, research aim, and candidate regressors before
              reviewing model suggestions.
            </p>
          </div>

          {/* 1A. Data Structure Confirmation */}
          <div className="space-y-2 pb-4 border-b border-[#EFECE6]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#17202A]">
                Observation Unit &amp; Structure
              </span>
              <button
                type="button"
                onClick={onJumpToInspector}
                className="text-xs font-medium text-[#1B365D] underline underline-offset-2 hover:text-[#132847] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] rounded px-1"
              >
                Edit keys in Inspector
              </button>
            </div>
            <div className="bg-[#FAF8F4] border border-[#E5E0D6] rounded p-3 space-y-2">
              <div className="text-sm font-semibold text-[#17202A]">
                {structureAudit.label}
              </div>
              <ul className="space-y-1 text-xs text-[#3E4C59] list-disc pl-4">
                {structureAudit.evidence.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {structureAudit.uncertainties.length > 0 && (
                <div className="pt-1.5 border-t border-[#E5E0D6] space-y-1">
                  {structureAudit.uncertainties.map((u, i) => (
                    <p key={i} className="text-xs text-[#8C5319] flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{u}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 1B. Outcome Variable & Scale Confirmation */}
          <div className="space-y-3 pb-4 border-b border-[#EFECE6]">
            <label
              htmlFor="suggestion-outcome-select"
              className="block text-xs font-semibold uppercase tracking-wide text-[#17202A]"
            >
              Outcome Variable (Y)
            </label>
            <select
              id="suggestion-outcome-select"
              value={confirmations.outcomeVar ?? ''}
              onChange={(e) => handleSelectOutcomeVar(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            >
              <option value="">Select an outcome variable…</option>
              {outcomeCandidates.map((c) => (
                <option key={c.stataName} value={c.stataName}>
                  {c.stataName} — {c.label} ({STORAGE_LABELS[c.storageType]})
                </option>
              ))}
            </select>

            {activeOutcomeAudit && (
              <div className="space-y-2.5">
                <div className="text-xs text-[#52606D] bg-[#FAF8F4] border border-[#E5E0D6] rounded p-2.5 space-y-1">
                  <div>
                    <span className="font-medium text-[#17202A]">Storage:</span>{' '}
                    {STORAGE_LABELS[activeOutcomeAudit.storageType]} ·{' '}
                    <span className="font-medium text-[#17202A]">Observed:</span>{' '}
                    <span className="font-mono tabular-nums">
                      {activeOutcomeAudit.uniqueCount}
                    </span>{' '}
                    distinct values
                  </div>
                  {activeOutcomeAudit.outcomeEvidence && (
                    <div>{activeOutcomeAudit.outcomeEvidence}</div>
                  )}
                </div>

                {/* Ambiguous low-cardinality numeric callout */}
                {activeOutcomeAudit.isLowCardinalityNumeric && !confirmations.confirmedOutcomeType && (
                  <div
                    role="alert"
                    className="bg-[#FDF8EE] border border-[#D8B46C] rounded p-3 text-xs text-[#6B4214] space-y-1"
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Confirmation required: low-cardinality numeric column</span>
                    </div>
                    <p>{activeOutcomeAudit.outcomeUncertainty}</p>
                    <p className="font-mono text-[11px]">
                      Observed values: {'{'}
                      {activeOutcomeAudit.observedDistinctSample.join(', ')}
                      {'}'}
                    </p>
                  </div>
                )}

                <fieldset className="space-y-1.5">
                  <legend className="text-xs font-medium text-[#17202A]">
                    Confirm outcome scale:
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {OUTCOME_CONFIRMATION_OPTIONS.map((opt) => {
                      const active = confirmations.confirmedOutcomeType === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setConfirmations((prev) => ({
                              ...prev,
                              confirmedOutcomeType: opt.value,
                              binaryEventValue:
                                opt.value === 'binary'
                                  ? prev.binaryEventValue ??
                                    activeOutcomeAudit.observedDistinctSample[
                                      activeOutcomeAudit.observedDistinctSample.length - 1
                                    ] ??
                                    null
                                  : null,
                            }))
                          }
                          className={`text-left px-2.5 py-2 rounded border text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                            active
                              ? 'bg-[#1B365D] text-white border-[#1B365D]'
                              : 'bg-white text-[#17202A] border-[#CFC7B8] hover:border-[#1B365D]'
                          }`}
                        >
                          <div className="font-semibold">{opt.label}</div>
                          <div
                            className={`text-[11px] mt-0.5 ${
                              active ? 'text-white/85' : 'text-[#52606D]'
                            }`}
                          >
                            {opt.hint}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {/* Binary follow-up prompt */}
                {confirmations.confirmedOutcomeType === 'binary' && (
                  <div className="bg-[#FAF8F4] border border-[#E5E0D6] rounded p-3 space-y-2">
                    <label
                      htmlFor="binary-event-select"
                      className="block text-xs font-medium text-[#17202A]"
                    >
                      Which observed value represents the target event (Y = 1)?
                    </label>
                    {activeOutcomeAudit.observedDistinctSample.length > 0 ? (
                      <select
                        id="binary-event-select"
                        value={confirmations.binaryEventValue ?? ''}
                        onChange={(e) =>
                          setConfirmations((prev) => ({
                            ...prev,
                            binaryEventValue: e.target.value || null,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#CFC7B8] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
                      >
                        <option value="">Select event value…</option>
                        {activeOutcomeAudit.observedDistinctSample.map((val) => (
                          <option key={val} value={val}>
                            {val}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-[#52606D]">
                        No distinct sample values found.
                      </p>
                    )}
                  </div>
                )}

                {/* Count follow-up prompt */}
                {confirmations.confirmedOutcomeType === 'count' && (
                  <div className="bg-[#FAF8F4] border border-[#E5E0D6] rounded p-3 space-y-2.5">
                    {report.countNonNegativeIntegerCheck.checked && (
                      <div
                        className={`text-xs flex items-start gap-1.5 ${
                          report.countNonNegativeIntegerCheck.passed
                            ? 'text-[#1F5D3B]'
                            : 'text-[#8B2635]'
                        }`}
                      >
                        {report.countNonNegativeIntegerCheck.passed ? (
                          <CheckCircle2
                            className="w-3.5 h-3.5 shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                        ) : (
                          <AlertTriangle
                            className="w-3.5 h-3.5 shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                        )}
                        <span>{report.countNonNegativeIntegerCheck.detail}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <span className="block text-xs font-medium text-[#17202A]">
                        Do observations differ in exposure / time-at-risk / population?
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(
                          [
                            ['unknown', 'Unsure'],
                            ['no', 'Equal'],
                            ['yes', 'Differs'],
                          ] as const
                        ).map(([val, lbl]) => {
                          const active = confirmations.countHasDifferingExposure === val;
                          return (
                            <button
                              key={val}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                setConfirmations((prev) => ({
                                  ...prev,
                                  countHasDifferingExposure: val,
                                  countExposureVar: val === 'yes' ? prev.countExposureVar : null,
                                }))
                              }
                              className={`px-2 py-1.5 text-xs rounded border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                                active
                                  ? 'bg-[#1B365D] text-white border-[#1B365D]'
                                  : 'bg-white text-[#17202A] border-[#CFC7B8] hover:border-[#1B365D]'
                              }`}
                            >
                              {lbl}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {confirmations.countHasDifferingExposure === 'yes' && (
                      <div className="space-y-1">
                        <label
                          htmlFor="count-exposure-select"
                          className="block text-xs font-medium text-[#17202A]"
                        >
                          Exposure / denominator variable (optional)
                        </label>
                        <select
                          id="count-exposure-select"
                          value={confirmations.countExposureVar ?? ''}
                          onChange={(e) =>
                            setConfirmations((prev) => ({
                              ...prev,
                              countExposureVar: e.target.value || null,
                            }))
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#CFC7B8] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
                        >
                          <option value="">Not specified</option>
                          {numericCovariateCandidates.map((c) => (
                            <option key={c.stataName} value={c.stataName}>
                              {c.stataName} — {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 1C. Research Aim */}
          <div className="space-y-2 pb-4 border-b border-[#EFECE6]">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[#17202A]">
              Research Aim
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {RESEARCH_AIM_OPTIONS.map((opt) => {
                const active = confirmations.researchAim === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setConfirmations((prev) => ({ ...prev, researchAim: opt.value }))
                    }
                    className={`text-left px-2.5 py-2 rounded border text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                      active
                        ? 'bg-[#1B365D] text-white border-[#1B365D]'
                        : 'bg-white text-[#17202A] border-[#CFC7B8] hover:border-[#1B365D]'
                    }`}
                  >
                    <div className="font-semibold">{opt.label}</div>
                    <div
                      className={`text-[11px] mt-0.5 leading-snug ${
                        active ? 'text-white/85' : 'text-[#52606D]'
                      }`}
                    >
                      {opt.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1D. Candidate Regressors & FE Variation Check */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#17202A]">
                Candidate Regressors (X)
              </span>
              <span className="text-xs font-mono tabular-nums text-[#52606D]">
                {confirmations.selectedRegressors.length} selected
              </span>
            </div>
            {numericCovariateCandidates.length === 0 ? (
              <p className="text-xs text-[#52606D]">
                No additional numeric non-constant covariates available.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {numericCovariateCandidates.map((col) => {
                  const active = confirmations.selectedRegressors.includes(col.stataName);
                  return (
                    <button
                      key={col.stataName}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleToggleRegressor(col.stataName)}
                      className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                        active
                          ? 'bg-[#1B365D] text-white border-[#1B365D]'
                          : 'bg-[#FAF8F4] text-[#17202A] border-[#CFC7B8] hover:border-[#1B365D]'
                      }`}
                    >
                      {col.stataName}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Live FE Absorption Readout */}
            {absorbedChecks.length > 0 && (
              <div className="bg-[#FDF8EE] border border-[#D8B46C] rounded p-3 space-y-1.5">
                <div className="text-xs font-semibold text-[#6B4214] flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Fixed-Effects Absorption Detected</span>
                </div>
                <ul className="space-y-1 text-xs text-[#6B4214] list-disc pl-4">
                  {absorbedChecks.map((check) => (
                    <li key={check.variable}>{check.explanation}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Candidate Models & Explanations (7 cols) */}
        <section className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-[#E5E0D6] rounded-md p-5 space-y-4">
            <div className="border-b border-[#EFECE6] pb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-serif text-base font-bold text-[#17202A]">
                  2. Candidate Models &amp; Assumptions
                </h3>
                <p className="text-xs text-[#52606D] mt-0.5">
                  Only estimators implemented in Folio’s Model Builder offer a{' '}
                  <span className="font-medium text-[#17202A]">Review in Model Builder</span>{' '}
                  action. All other estimators are marked <span className="font-medium">Guidance only</span>.
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-[#52606D]">
                {report.recommendations.length} candidate
                {report.recommendations.length === 1 ? '' : 's'}
              </span>
            </div>

            {!activeOutcomeAudit ? (
              <div className="p-6 text-center bg-[#FAF8F4] border border-dashed border-[#CFC7B8] rounded text-sm text-[#52606D]">
                Select an outcome variable on the left to inspect candidate model families.
              </div>
            ) : report.outcomeRequiresConfirmation ? (
              <div className="p-5 bg-[#FDF8EE] border border-[#D8B46C] rounded space-y-2">
                <div className="text-sm font-semibold text-[#6B4214] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Confirm outcome scale for “{activeOutcomeAudit.stataName}” first</span>
                </div>
                <p className="text-xs text-[#6B4214] leading-relaxed">
                  Low-cardinality numeric columns ({'{'}
                  {activeOutcomeAudit.observedDistinctSample.join(', ')}
                  {'}'}) are intentionally kept ambiguous until you confirm whether they are
                  continuous, binary, count, ordinal, or nominal. Choose an outcome scale on the
                  left to generate tailored guidance.
                </p>
              </div>
            ) : report.recommendations.length === 0 ? (
              <div className="p-6 text-center bg-[#FAF8F4] border border-dashed border-[#CFC7B8] rounded text-sm text-[#52606D]">
                No candidate models available for the current confirmation state.
              </div>
            ) : (
              <div className="space-y-4">
                {report.recommendations.map((rec) => {
                  const isReady =
                    rec.implementationStatus === 'implemented_ready' &&
                    Boolean(rec.builderSpecDraft);
                  const isBlocked = rec.implementationStatus === 'implemented_blocked';

                  return (
                    <article
                      key={rec.id}
                      className="border border-[#E5E0D6] rounded-md p-4 bg-[#FCFBF8] space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-serif text-base font-bold text-[#17202A]">
                              {rec.title}
                            </h4>
                            <span
                              className={`text-[11px] font-medium px-2 py-0.5 border rounded ${
                                isReady
                                  ? 'bg-[#EEF6F1] text-[#1F5D3B] border-[#B8D8C5]'
                                  : isBlocked
                                    ? 'bg-[#FDF2F2] text-[#8B2635] border-[#E8BDC2]'
                                    : 'bg-[#F4F1EA] text-[#52606D] border-[#CFC7B8]'
                              }`}
                            >
                              {isReady
                                ? 'Implemented · Ready'
                                : isBlocked
                                  ? 'Blocked on current data'
                                  : 'Guidance only'}
                            </span>
                          </div>
                          <div className="text-xs font-mono text-[#52606D]">
                            {rec.estimatorLabel}
                          </div>
                        </div>

                        {isReady && rec.builderSpecDraft && (
                          <button
                            type="button"
                            onClick={() =>
                              onReviewInModelBuilder(rec.builderSpecDraft!, rec.title)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1B365D] rounded hover:bg-[#132847] transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] focus-visible:ring-offset-2"
                          >
                            <span>Review in Model Builder</span>
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>

                      {rec.blockedReason && (
                        <div className="bg-[#FDF2F2] border border-[#E8BDC2] rounded px-3 py-2 text-xs text-[#8B2635] flex items-start gap-2">
                          <AlertTriangle
                            className="w-3.5 h-3.5 shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                          <span>{rec.blockedReason}</span>
                        </div>
                      )}

                      {rec.absorptionWarnings.length > 0 && (
                        <div className="bg-[#FDF8EE] border border-[#D8B46C] rounded px-3 py-2 text-xs text-[#6B4214] space-y-1">
                          <div className="font-semibold">Fixed-effects absorption check:</div>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {rec.absorptionWarnings.map((w, idx) => (
                              <li key={idx}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="space-y-1">
                          <div className="font-semibold text-[#17202A] uppercase tracking-wide text-[11px]">
                            Why this candidate fits
                          </div>
                          <ul className="list-disc pl-4 space-y-1 text-[#3E4C59]">
                            {rec.reasons.map((r, idx) => (
                              <li key={idx}>{r}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1">
                          <div className="font-semibold text-[#17202A] uppercase tracking-wide text-[11px]">
                            Key assumptions
                          </div>
                          <ul className="list-disc pl-4 space-y-1 text-[#3E4C59]">
                            {rec.assumptions.map((a, idx) => (
                              <li key={idx}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-[#EFECE6] space-y-1.5 text-xs">
                        <div className="font-semibold text-[#17202A] uppercase tracking-wide text-[11px]">
                          Recommended next checks
                        </div>
                        <ul className="list-disc pl-4 space-y-1 text-[#3E4C59]">
                          {rec.nextChecks.map((nc, idx) => (
                            <li key={idx}>{nc}</li>
                          ))}
                        </ul>
                        {rec.researcherJudgementNotes.length > 0 && (
                          <p className="text-[11px] text-[#52606D] pt-1 flex items-start gap-1.5">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{rec.researcherJudgementNotes.join(' ')}</span>
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {/* Researcher Judgement & Boundaries Callout */}
          <div className="bg-white border border-[#E5E0D6] rounded-md p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#1B365D]">
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Researcher Judgement Boundaries</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-xs text-[#52606D]">
              {report.globalJudgementNotes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* Section 3: Full Column Audit Table (Storage vs Research Role vs Outcome Type) */}
      <section className="bg-white border border-[#E5E0D6] rounded-md overflow-hidden">
        <div className="px-5 py-4 border-b border-[#EFECE6]">
          <h3 className="font-serif text-base font-bold text-[#17202A]">
            3. Column Storage, Research Role &amp; Outcome Scale Audit
          </h3>
          <p className="text-xs text-[#52606D] mt-0.5">
            Separates raw storage type from inferred research role and candidate outcome type so
            coded numeric columns and text identifiers are never conflated.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E5E0D6] bg-[#FAF8F4] text-[#52606D] uppercase tracking-wider text-[11px]">
                <th className="py-2.5 px-4 font-semibold">Variable</th>
                <th className="py-2.5 px-3 font-semibold">Storage Type</th>
                <th className="py-2.5 px-3 font-semibold">Inferred Role</th>
                <th className="py-2.5 px-3 font-semibold">Candidate Outcome Type</th>
                <th className="py-2.5 px-4 font-semibold">Evidence &amp; Uncertainties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFECE6]">
              {report.columnAudits.map((col) => (
                <tr key={col.stataName} className="hover:bg-[#FCFBF8]">
                  <td className="py-2.5 px-4 align-top">
                    <div className="font-mono font-semibold text-[#17202A]">{col.stataName}</div>
                    <div className="text-[11px] text-[#52606D]">{col.label}</div>
                  </td>
                  <td className="py-2.5 px-3 align-top font-mono text-[#17202A] whitespace-nowrap">
                    {STORAGE_LABELS[col.storageType]}
                  </td>
                  <td className="py-2.5 px-3 align-top text-[#17202A] whitespace-nowrap">
                    {ROLE_LABELS[col.inferredResearchRole]}
                  </td>
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    {col.inferredOutcomeType ? (
                      <span
                        className={
                          col.isLowCardinalityNumeric
                            ? 'font-semibold text-[#8C5319]'
                            : 'text-[#17202A]'
                        }
                      >
                        {OUTCOME_TYPE_LABELS[col.inferredOutcomeType]}
                      </span>
                    ) : (
                      <span className="text-[#7B8794]">Not an outcome</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 align-top space-y-1 max-w-md">
                    <div className="text-[#3E4C59]">{col.roleEvidence}</div>
                    {col.outcomeEvidence && (
                      <div className="text-[#52606D]">{col.outcomeEvidence}</div>
                    )}
                    {(col.roleUncertainty || col.outcomeUncertainty) && (
                      <div className="text-[#8C5319]">
                        {col.outcomeUncertainty ?? col.roleUncertainty}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
