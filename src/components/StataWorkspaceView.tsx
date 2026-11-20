import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, FileSpreadsheet, Info, ShieldAlert } from 'lucide-react';
import type {
  DatasetState,
  DiagnosticsReport,
  EstimatorType,
  LogTransformMode,
  ModelSpec,
  SampleImpact,
  StandardErrorType,
} from '../types/econometrics';
import { getDiagnosticCompatibility } from '../lib/specValidator';
import {
  generateStataDoFile,
  generateStataVerificationDoFile,
  getOriginalSourceLimitations,
} from '../lib/stataGenerator';
import { formatPanelStatusHeadline } from '../lib/panelStatus';
import {
  buildBundleReadme,
  buildZipBlob,
  getBundleZipFileName,
  getNormalizedCsvFileName,
  getStataDoFileName,
  getStataVerifyDoFileName,
  serializeNormalizedCsv,
} from '../lib/zipBundle';
import {
  buildHousingDemoVerificationBundle,
  buildPrecisionKeysFixtureBundle,
} from '../lib/verificationFixtures';
import { SyntaxCodeBlock } from './SyntaxCodeBlock';

interface StataWorkspaceViewProps {
  dataset: DatasetState;
  diagnostics: DiagnosticsReport;
  spec: ModelSpec;
  impact: SampleImpact;
  onChangeSpec: (next: ModelSpec) => void;
  onCopyCode: (code: string, label: string) => void;
  onDownloadCode: (code: string, fileName: string) => void;
  onDownloadBlob: (blob: Blob, fileName: string, toastMsg: string) => void;
  copiedKey: string | null;
}

export const StataWorkspaceView: React.FC<StataWorkspaceViewProps> = ({
  dataset,
  diagnostics,
  spec,
  impact,
  onChangeSpec,
  onCopyCode,
  onDownloadCode,
  onDownloadBlob,
  copiedKey,
}) => {
  const numericCols = useMemo(
    () => dataset.columns.filter((c) => c.type === 'numeric'),
    [dataset.columns]
  );

  // Separate substantive numeric covariates from numeric IDs/time fields for clearer selection
  const covariateNumericCols = useMemo(
    () => numericCols.filter((c) => c.role === 'covariate'),
    [numericCols]
  );
  const idOrTimeNumericCols = useMemo(
    () => numericCols.filter((c) => c.role !== 'covariate'),
    [numericCols]
  );

  // Purposeful motion: briefly highlight whichever Sample Impact step row changed count
  const prevStepSnapshotRef = useRef<Record<string, string>>({});
  const [highlightedStepIds, setHighlightedStepIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const nextSnap: Record<string, string> = {};
    const changed = new Set<string>();
    const prevSnap = prevStepSnapshotRef.current;
    const hasPrev = Object.keys(prevSnap).length > 0;

    for (const step of impact.steps) {
      const sig = `${step.rowsRemaining}:${step.rowsAffected}:${step.detail}`;
      nextSnap[step.id] = sig;
      if (hasPrev && prevSnap[step.id] !== sig) {
        changed.add(step.id);
      }
    }
    prevStepSnapshotRef.current = nextSnap;

    if (changed.size > 0) {
      setHighlightedStepIds(changed);
      const timer = window.setTimeout(() => {
        setHighlightedStepIds(new Set());
      }, 950);
      return () => window.clearTimeout(timer);
    }
  }, [impact.steps]);

  const compat = useMemo(
    () => getDiagnosticCompatibility(dataset, spec, impact.postDedupPanelCheck),
    [dataset, spec, impact.postDedupPanelCheck]
  );

  const doCode = useMemo(
    () => generateStataDoFile(dataset, spec, impact),
    [dataset, spec, impact]
  );

  const doFileName = getStataDoFileName(dataset);
  const verifyDoFileName = getStataVerifyDoFileName(dataset);
  const normalizedCsvName = getNormalizedCsvFileName(dataset);
  const bundleZipName = getBundleZipFileName(dataset);

  const originalSourceLimitations = useMemo(
    () => getOriginalSourceLimitations(dataset),
    [dataset]
  );

  const handleDownloadBundle = () => {
    const bundleSpec: ModelSpec = { ...spec, importMode: 'normalized_bundle' };
    const bundleDo = generateStataDoFile(dataset, bundleSpec, impact);
    const verifyDo = generateStataVerificationDoFile(dataset, bundleSpec, impact);
    const csvText = serializeNormalizedCsv(dataset);
    const readmeText = buildBundleReadme(
      dataset,
      doFileName,
      verifyDoFileName,
      normalizedCsvName,
      impact.startingN,
      impact.afterExactDuplicatesN,
      impact.previewCompleteCasesN
    );

    const blob = buildZipBlob([
      { name: doFileName, content: bundleDo },
      { name: verifyDoFileName, content: verifyDo },
      { name: normalizedCsvName, content: csvText },
      { name: 'README.txt', content: readmeText },
    ]);
    onDownloadBlob(blob, bundleZipName, `Downloaded reproducible bundle (${bundleZipName})`);
  };

  const handleDownloadVerifyDo = () => {
    const bundleSpec: ModelSpec = { ...spec, importMode: 'normalized_bundle' };
    const verifyDo = generateStataVerificationDoFile(dataset, bundleSpec, impact);
    onDownloadCode(verifyDo, verifyDoFileName);
  };

  const handleDownloadDemoFixture = () => {
    const artifact = buildHousingDemoVerificationBundle();
    onDownloadBlob(artifact.blob, artifact.fileName, `Downloaded ${artifact.fileName}`);
  };

  const handleDownloadPrecisionFixture = () => {
    const artifact = buildPrecisionKeysFixtureBundle();
    onDownloadBlob(artifact.blob, artifact.fileName, `Downloaded ${artifact.fileName}`);
  };

  const handleDownloadNormalizedCsv = () => {
    const csvText = serializeNormalizedCsv(dataset);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    onDownloadBlob(blob, normalizedCsvName, `Downloaded ${normalizedCsvName}`);
  };

  const toggleInList = (list: string[], item: string) =>
    list.includes(item) ? list.filter((v) => v !== item) : [...list, item];

  const handleToggleLog = (varName: string) => {
    const nextLogs = { ...spec.logTransforms };
    if (nextLogs[varName]) {
      delete nextLogs[varName];
    } else {
      const col = dataset.columns.find((c) => c.stataName === varName);
      let defaultMode: LogTransformMode = 'ln';
      if (col && col.leqNegOneCount > 0) defaultMode = 'asinh';
      else if (col && col.nonPositiveCount > 0) defaultMode = 'ln1p';
      nextLogs[varName] = defaultMode;
    }
    onChangeSpec({ ...spec, logTransforms: nextLogs });
  };

  const handleLogModeChange = (varName: string, mode: LogTransformMode) => {
    onChangeSpec({
      ...spec,
      logTransforms: { ...spec.logTransforms, [varName]: mode },
    });
  };

  const handleEstimatorChange = (estimator: EstimatorType) => {
    let nextSe = spec.seType;
    if (nextSe === 'cluster_twoway' && estimator !== 'fe_reghdfe') {
      nextSe = dataset.panel.entityVar ? 'cluster_entity' : 'robust';
    }
    let nextAbsorb = spec.absorbVars;
    if (estimator === 'fe_reghdfe' && nextAbsorb.length === 0) {
      nextAbsorb = [dataset.panel.entityVar, dataset.panel.timeVar].filter(
        (v): v is string => Boolean(v)
      );
    }
    onChangeSpec({
      ...spec,
      estimator,
      seType: nextSe,
      absorbVars: nextAbsorb,
    });
  };

  const handleDepVarChange = (depVar: string) => {
    const cleanDep = depVar || null;
    onChangeSpec({
      ...spec,
      depVar: cleanDep,
      indepVars: cleanDep ? spec.indepVars.filter((x) => x !== cleanDep) : spec.indepVars,
    });
  };

  const handleSeChange = (seType: StandardErrorType) => {
    onChangeSpec({ ...spec, seType });
  };

  const { suitability } = impact;
  const depIssue = spec.depVar
    ? suitability.estimationIssues[spec.depVar] ?? suitability.datasetIssues[spec.depVar]
    : null;
  const selectedRegressorIssues = spec.indepVars
    .map((v) => suitability.estimationIssues[v] ?? suitability.datasetIssues[v])
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const selectedAbsorbIssues = spec.absorbVars
    .map((v) => suitability.estimationIssues[v] ?? suitability.datasetIssues[v])
    .filter((i): i is NonNullable<typeof i> => Boolean(i));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* LEFT COLUMN: INTERACTIVE MODEL & CLEANING BUILDER */}
      <div className="xl:col-span-5 space-y-5">
        {!dataset.isDemo && !spec.depVar && (
          <div className="bg-white border border-[#CFC7B8] rounded-md p-4 text-xs text-[#52606D] flex items-start gap-2.5">
            <Info className="w-4 h-4 text-[#1B365D] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <strong className="text-[#17202A]">Researcher-Confirmed Specification:</strong>{' '}
              Uploaded datasets start clean without opaque model guesses. Select your dependent variable, controls, and cleaning rules below to build your reproducible <code className="font-mono">.do</code> script.
            </div>
          </div>
        )}

        {/* Section 0: Import Parity & Bundle Mode */}
        <section className="bg-white border border-[#E5E0D6] rounded-md p-5 space-y-3">
          <div className="border-b border-[#E5E0D6] pb-2.5">
            <h2 className="font-serif text-base font-semibold text-[#17202A]">
              Import Strategy &amp; Reproducible Bundle
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-[#F4F1EA] border border-[#E5E0D6] rounded">
            <button
              type="button"
              onClick={() => onChangeSpec({ ...spec, importMode: 'normalized_bundle' })}
              className={`py-1.5 px-2 text-xs font-medium rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                spec.importMode === 'normalized_bundle'
                  ? 'bg-white text-[#1B365D] shadow-xs'
                  : 'text-[#52606D] hover:text-[#17202A]'
              }`}
            >
              Normalized Bundle
            </button>
            <button
              type="button"
              onClick={() => onChangeSpec({ ...spec, importMode: 'original_source' })}
              className={`py-1.5 px-2 text-xs font-medium rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                spec.importMode === 'original_source'
                  ? 'bg-white text-[#1B365D] shadow-xs'
                  : 'text-[#52606D] hover:text-[#17202A]'
              }`}
            >
              Original Source File
            </button>
          </div>

          <p className="text-[11px] text-[#52606D] leading-relaxed">
            {spec.importMode === 'normalized_bundle'
              ? 'Imports Folio’s companion normalized CSV with explicit `asdouble` double precision and `stringcols()` for every text, date, and identifier column. Download the .zip bundle (includes analysis .do, standalone verification .do, normalized CSV, and README) to run in Stata 17+.'
              : dataset.sourceFormat === 'xlsx'
                ? 'Imports your original .xlsx workbook preserving stored numeric precision (avoiding `allstring`), applying positional rename, zero-pad string formatting, and missing-token cleanup.'
                : 'Imports your raw CSV all-as-string, then executes positional rename, missing-token normalization, and double-precision `destring` inside Stata.'}
          </p>

          {spec.importMode === 'original_source' && originalSourceLimitations.length > 0 && (
            <div className="p-3 rounded border border-[#F59E0B]/40 bg-[#FFFBEB] text-[11px] text-[#92400E] space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Original Source Parity Notice — Normalized Bundle Recommended</span>
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {originalSourceLimitations.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleDownloadBundle}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#1B365D] rounded hover:bg-[#132847] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] focus-visible:ring-offset-2"
            >
              <Archive className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download Stata Bundle (.zip)</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadVerifyDo}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#17202A] bg-white border border-[#CFC7B8] rounded hover:bg-[#FAF8F4] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-[#1B365D]" aria-hidden="true" />
              <span>Verification .do</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadNormalizedCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#17202A] bg-white border border-[#CFC7B8] rounded hover:bg-[#FAF8F4] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#52606D]" aria-hidden="true" />
              <span>Normalized CSV</span>
            </button>
          </div>

          {/* Standalone Stata 17+ Reference Verification Fixtures */}
          <div className="pt-3 border-t border-[#F0ECE4] space-y-2">
            <div className="text-[11px] font-medium text-[#52606D]">
              Local Stata 17+ Verification Bundles (extract &amp; run <code className="font-mono">*_verify.do</code>):
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadDemoFixture}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#1B365D] bg-[#FAF8F4] border border-[#CFC7B8] rounded hover:bg-[#F4F1EA] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <Archive className="w-3 h-3" aria-hidden="true" />
                <span>Housing Demo Bundle (.zip)</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadPrecisionFixture}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#1B365D] bg-[#FAF8F4] border border-[#CFC7B8] rounded hover:bg-[#F4F1EA] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <Archive className="w-3 h-3" aria-hidden="true" />
                <span>Precision &amp; Keys Fixture (.zip)</span>
              </button>
            </div>
          </div>
        </section>

        {/* Section A: Cleaning & Transformations */}
        <section className="bg-white border border-[#E5E0D6] rounded-md p-5 space-y-4">
          <div className="border-b border-[#E5E0D6] pb-3">
            <h2 className="font-serif text-base font-semibold text-[#17202A]">
              1. Cleaning &amp; Transformations
            </h2>
          </div>

          {/* Exact Duplicates */}
          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-[#17202A]">
                Drop Exact Duplicate Rows (<code className="font-mono font-normal">duplicates drop</code>)
              </div>
              <div className="text-[11px] text-[#52606D] mt-0.5">
                {diagnostics.exactDuplicateRows > 0
                  ? `${diagnostics.exactDuplicateRows} exact duplicate row(s) detected in raw file.`
                  : 'Zero exact duplicate rows detected.'}
              </div>
            </div>
            <input
              type="checkbox"
              checked={spec.dropExactDuplicates}
              onChange={(e) =>
                onChangeSpec({ ...spec, dropExactDuplicates: e.target.checked })
              }
              className="mt-1 accent-[#1B365D]"
            />
          </label>

          {/* Winsorization */}
          <div className="pt-3 border-t border-[#F0ECE4] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#17202A]">
                Winsorize Outliers (<code className="font-mono font-normal">winsor2</code>)
              </span>
              <div className="inline-flex border border-[#CFC7B8] rounded overflow-hidden text-[11px] bg-white">
                {([1, 5] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => onChangeSpec({ ...spec, winsorizeLevel: lvl })}
                    className={`px-2 py-0.5 font-mono cursor-pointer ${
                      spec.winsorizeLevel === lvl
                        ? 'bg-[#1B365D] text-white'
                        : 'text-[#52606D] hover:bg-[#FAF8F4]'
                    }`}
                  >
                    {lvl}%/{100 - lvl}%
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {numericCols.map((col) => {
                const active = spec.winsorizeVars.includes(col.stataName);
                const unsuited = col.isAllMissing || col.isConstant;
                return (
                  <button
                    key={col.stataName}
                    type="button"
                    disabled={unsuited && !active}
                    title={unsuited ? 'All-missing or constant column' : col.label}
                    onClick={() =>
                      onChangeSpec({
                        ...spec,
                        winsorizeVars: toggleInList(spec.winsorizeVars, col.stataName),
                      })
                    }
                    className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      active
                        ? 'bg-[#1B365D] text-white border-[#1B365D]'
                        : 'bg-[#FAF8F4] text-[#52606D] border-[#E5E0D6] hover:border-[#1B365D] hover:text-[#17202A]'
                    }`}
                  >
                    {col.stataName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Log / IHS Transforms with Exact Domain Safeguard */}
          <div className="pt-3 border-t border-[#F0ECE4] space-y-2.5">
            <div className="text-xs font-semibold text-[#17202A]">
              Log / Skewness Transformations
            </div>
            <div className="flex flex-wrap gap-1.5">
              {numericCols.map((col) => {
                const active = Boolean(spec.logTransforms[col.stataName]);
                const unsuited = col.isAllMissing || col.isConstant;
                return (
                  <button
                    key={col.stataName}
                    type="button"
                    disabled={unsuited && !active}
                    onClick={() => handleToggleLog(col.stataName)}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      active
                        ? 'bg-[#1B365D] text-white border-[#1B365D]'
                        : 'bg-[#FAF8F4] text-[#52606D] border-[#E5E0D6] hover:border-[#1B365D] hover:text-[#17202A]'
                    }`}
                  >
                    {col.stataName}
                    {col.nonPositiveCount > 0 ? ' (≤0)' : ''}
                  </button>
                );
              })}
            </div>

            {Object.entries(spec.logTransforms).length > 0 && (
              <div className="space-y-2 pt-1">
                {Object.entries(spec.logTransforms).map(([varName, mode]) => {
                  const col = dataset.columns.find((c) => c.stataName === varName);
                  const nonPos = col?.nonPositiveCount ?? 0;
                  const leqNegOne = col?.leqNegOneCount ?? 0;

                  const dropsRows =
                    (mode === 'ln' && nonPos > 0) ||
                    (mode === 'ln1p' && leqNegOne > 0);

                  return (
                    <div
                      key={varName}
                      className="p-2.5 rounded border border-[#E5E0D6] bg-[#FAF8F4] space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-medium text-[#17202A]">
                          {varName}
                        </span>
                        <select
                          aria-label={`Log mode for ${varName}`}
                          value={mode}
                          onChange={(e) =>
                            handleLogModeChange(varName, e.target.value as LogTransformMode)
                          }
                          className="px-2 py-1 text-[11px] font-mono bg-white border border-[#CFC7B8] rounded text-[#17202A]"
                        >
                          <option value="ln">ln(x) — requires x &gt; 0</option>
                          <option value="ln1p">ln(x + 1) — requires x &gt; -1</option>
                          <option value="asinh">asinh(x) — all real x</option>
                        </select>
                      </div>
                      {nonPos > 0 && (
                        <div
                          className={`flex items-start gap-1.5 text-[11px] ${
                            dropsRows ? 'text-[#B45309]' : 'text-[#166534]'
                          }`}
                        >
                          {dropsRows && <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />}
                          <span>
                            {mode === 'ln'
                              ? `${nonPos} value(s) ≤ 0 will become missing under strict ln(x).`
                              : mode === 'ln1p' && leqNegOne > 0
                                ? `${leqNegOne} value(s) ≤ -1 will become missing under ln(x + 1); switch to asinh(x) to retain all rows.`
                                : mode === 'ln1p'
                                  ? `All values are > -1; ln(x + 1) retains every non-missing observation (0 new missing).`
                                  : `asinh(x) accommodates all ${nonPos} non-positive value(s) with 0 new missing.`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Section B: Econometric Specification with Variable Suitability Checks */}
        <section className="bg-white border border-[#E5E0D6] rounded-md p-5 space-y-4">
          <div className="border-b border-[#E5E0D6] pb-3">
            <h2 className="font-serif text-base font-semibold text-[#17202A]">
              2. Econometric Specification
            </h2>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="estimator-select" className="block text-xs font-medium text-[#52606D] mb-1">
                Estimator
              </label>
              <select
                id="estimator-select"
                value={spec.estimator}
                onChange={(e) => handleEstimatorChange(e.target.value as EstimatorType)}
                className="w-full px-3 py-2 text-xs bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <option value="ols">OLS (regress) — no xtset required</option>
                <option value="fe_xtreg" disabled={!compat.xtregAllowed}>
                  Panel Fixed Effects (xtreg, fe){!compat.xtregAllowed ? ' — requires confirmed unique panel keys' : ''}
                </option>
                <option value="fe_reghdfe">High-Dimensional Fixed Effects (reghdfe)</option>
                <option value="re_xtreg" disabled={!compat.xtregAllowed}>
                  Panel Random Effects (xtreg, re){!compat.xtregAllowed ? ' — requires confirmed unique panel keys' : ''}
                </option>
              </select>
              {!compat.xtregAllowed && compat.xtregBlockReason && (
                <p className="text-[11px] text-[#B45309] mt-1">
                  {compat.xtregBlockReason}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="depvar-select" className="block text-xs font-medium text-[#52606D] mb-1">
                Dependent Variable (Y)
              </label>
              <select
                id="depvar-select"
                value={spec.depVar ?? ''}
                onChange={(e) => handleDepVarChange(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <option value="">Select outcome variable...</option>
                {covariateNumericCols.length > 0 && (
                  <optgroup label="Substantive Covariates">
                    {covariateNumericCols.map((c) => {
                      const flag = c.isAllMissing
                        ? ' [ALL MISSING]'
                        : c.isConstant
                          ? ' [CONSTANT]'
                          : '';
                      return (
                        <option key={c.stataName} value={c.stataName}>
                          {c.stataName} — {c.label}{flag}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                {idOrTimeNumericCols.length > 0 && (
                  <optgroup label="Identifiers / Time Fields">
                    {idOrTimeNumericCols.map((c) => (
                      <option key={c.stataName} value={c.stataName}>
                        {c.stataName} ({c.role}) — {c.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {depIssue && (
                <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[#991B1B]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{depIssue.reason}</span>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-medium text-[#52606D] mb-1.5">
                <span>Independent Regressors (X)</span>
                <span className="text-[10.5px] font-normal text-[#7B8794]">
                  Substantive covariates shown first
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[...covariateNumericCols, ...idOrTimeNumericCols]
                  .filter((c) => c.stataName !== spec.depVar)
                  .map((col) => {
                    const active = spec.indepVars.includes(col.stataName);
                    const issue =
                      suitability.estimationIssues[col.stataName] ??
                      suitability.datasetIssues[col.stataName];
                    const isBlockedVar = Boolean(issue && issue.severity === 'error');
                    return (
                      <button
                        key={col.stataName}
                        type="button"
                        title={issue ? issue.reason : `${col.label} (${col.role})`}
                        onClick={() =>
                          onChangeSpec({
                            ...spec,
                            indepVars: toggleInList(spec.indepVars, col.stataName),
                          })
                        }
                        className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors whitespace-nowrap cursor-pointer ${
                          active
                            ? isBlockedVar
                              ? 'bg-[#991B1B] text-white border-[#991B1B]'
                              : 'bg-[#1B365D] text-white border-[#1B365D]'
                            : isBlockedVar
                              ? 'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]'
                              : 'bg-[#FAF8F4] text-[#52606D] border-[#E5E0D6] hover:border-[#1B365D] hover:text-[#17202A]'
                        }`}
                      >
                        {col.stataName}
                        {col.role !== 'covariate' ? ` (${col.role === 'identifier' ? 'id' : 'time'})` : ''}
                        {col.isAllMissing ? ' · missing' : col.isConstant ? ' · const' : ''}
                      </button>
                    );
                  })}
              </div>
              {selectedRegressorIssues.length > 0 && (
                <div className="mt-2 space-y-1">
                  {selectedRegressorIssues.map((iss) => (
                    <div
                      key={`${iss.stataName}-${iss.scope}`}
                      className={`flex items-start gap-1.5 text-[11px] ${
                        iss.severity === 'error' ? 'text-[#991B1B]' : 'text-[#B45309]'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{iss.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {spec.estimator === 'fe_reghdfe' && (
              <div>
                <div className="text-xs font-medium text-[#52606D] mb-1.5">
                  Absorbed Fixed Effects (<code className="font-mono">absorb()</code>)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {dataset.columns
                    .filter((c) => c.stataName !== spec.depVar && !spec.indepVars.includes(c.stataName))
                    .map((col) => {
                      const active = spec.absorbVars.includes(col.stataName);
                      const issue =
                        suitability.estimationIssues[col.stataName] ??
                        suitability.datasetIssues[col.stataName];
                      const isBlockedVar = Boolean(issue && issue.severity === 'error');
                      return (
                        <button
                          key={col.stataName}
                          type="button"
                          title={issue ? issue.reason : col.label}
                          onClick={() =>
                            onChangeSpec({
                              ...spec,
                              absorbVars: toggleInList(spec.absorbVars, col.stataName),
                            })
                          }
                          className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors whitespace-nowrap cursor-pointer ${
                            active
                              ? isBlockedVar
                                ? 'bg-[#991B1B] text-white border-[#991B1B]'
                                : 'bg-[#1B365D] text-white border-[#1B365D]'
                              : isBlockedVar
                                ? 'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]'
                                : 'bg-[#FAF8F4] text-[#52606D] border-[#E5E0D6] hover:border-[#1B365D] hover:text-[#17202A]'
                          }`}
                        >
                          {col.stataName}
                          {col.isAllMissing ? ' · missing' : col.isConstant ? ' · const' : ''}
                        </button>
                      );
                    })}
                </div>
                {selectedAbsorbIssues.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {selectedAbsorbIssues.map((iss) => (
                      <div
                        key={`${iss.stataName}-${iss.scope}`}
                        className="flex items-start gap-1.5 text-[11px] text-[#991B1B]"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{iss.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <label htmlFor="se-select" className="block text-xs font-medium text-[#52606D] mb-1">
                Variance-Covariance / Standard Errors
              </label>
              <select
                id="se-select"
                value={spec.seType}
                onChange={(e) => handleSeChange(e.target.value as StandardErrorType)}
                className="w-full px-3 py-2 text-xs bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <option value="default">Classical (Homoskedastic)</option>
                <option value="robust">Heteroskedasticity-Robust — vce(robust)</option>
                <option value="cluster_entity" disabled={!dataset.panel.entityVar}>
                  Clustered by Entity ({dataset.panel.entityVar ?? 'none'})
                </option>
                <option
                  value="cluster_twoway"
                  disabled={
                    spec.estimator !== 'fe_reghdfe' ||
                    !dataset.panel.entityVar ||
                    !dataset.panel.timeVar
                  }
                >
                  Two-Way Clustered ({dataset.panel.entityVar ?? 'i'}, {dataset.panel.timeVar ?? 't'}) — reghdfe only
                </option>
              </select>
            </div>
          </div>
        </section>

        {/* Section C: Estimator-Aware Diagnostic Templates */}
        <section className="bg-white border border-[#E5E0D6] rounded-md p-5 space-y-3.5">
          <div className="border-b border-[#E5E0D6] pb-3">
            <h2 className="font-serif text-base font-semibold text-[#17202A]">
              3. Post-Estimation Diagnostics &amp; Export
            </h2>
            <p className="text-[11px] text-[#52606D] mt-0.5">
              Automatically guarded for Stata estimator, VCE, and post-dedup panel uniqueness.
            </p>
          </div>

          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-[#17202A]">
                Multicollinearity VIF (<code className="font-mono font-normal">estat vif</code>)
              </div>
              <div className="text-[11px] text-[#52606D] mt-0.5">{compat.vifNote}</div>
            </div>
            <input
              type="checkbox"
              disabled={compat.vifMode === 'unavailable'}
              checked={spec.diagnostics.vif && compat.vifMode !== 'unavailable'}
              onChange={(e) =>
                onChangeSpec({
                  ...spec,
                  diagnostics: { ...spec.diagnostics, vif: e.target.checked },
                })
              }
              className="mt-1 accent-[#1B365D]"
            />
          </label>

          <label className="flex items-start justify-between gap-3 pt-2.5 border-t border-[#F0ECE4] cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-[#17202A]">
                Breusch-Pagan Heteroskedasticity (<code className="font-mono font-normal">estat hettest</code>)
              </div>
              <div className="text-[11px] text-[#52606D] mt-0.5">{compat.bpNote}</div>
            </div>
            <input
              type="checkbox"
              disabled={compat.bpMode === 'unavailable'}
              checked={spec.diagnostics.breuschPagan && compat.bpMode !== 'unavailable'}
              onChange={(e) =>
                onChangeSpec({
                  ...spec,
                  diagnostics: { ...spec.diagnostics, breuschPagan: e.target.checked },
                })
              }
              className="mt-1 accent-[#1B365D]"
            />
          </label>

          <label className="flex items-start justify-between gap-3 pt-2.5 border-t border-[#F0ECE4] cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-[#17202A]">
                Hausman FE vs. RE Test (<code className="font-mono font-normal">hausman</code>)
              </div>
              <div className="text-[11px] text-[#52606D] mt-0.5">{compat.hausmanNote}</div>
            </div>
            <input
              type="checkbox"
              disabled={compat.hausmanMode === 'unavailable'}
              checked={spec.diagnostics.hausman && compat.hausmanMode !== 'unavailable'}
              onChange={(e) =>
                onChangeSpec({
                  ...spec,
                  diagnostics: { ...spec.diagnostics, hausman: e.target.checked },
                })
              }
              className="mt-1 accent-[#1B365D]"
            />
          </label>

          <label className="flex items-start justify-between gap-3 pt-2.5 border-t border-[#F0ECE4] cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-[#17202A]">
                LaTeX Regression Export (<code className="font-mono font-normal">esttab</code>)
              </div>
              <div className="text-[11px] text-[#52606D] mt-0.5">
                Emits publication-ready booktabs regression table export at script end.
              </div>
            </div>
            <input
              type="checkbox"
              checked={spec.diagnostics.esttab}
              onChange={(e) =>
                onChangeSpec({
                  ...spec,
                  diagnostics: { ...spec.diagnostics, esttab: e.target.checked },
                })
              }
              className="mt-1 accent-[#1B365D]"
            />
          </label>
        </section>
      </div>

      {/* RIGHT COLUMN: STICKY SAMPLE IMPACT PREVIEW + SUITABILITY CALLOUT + STATA .DO VIEWER */}
      <div className="xl:col-span-7 space-y-5 xl:sticky xl:top-20">
        {/* Compact Sample Impact & Attrition Preview */}
        <section className="bg-white border border-[#E5E0D6] rounded-md p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#E5E0D6]">
            <div>
              <h3 className="font-serif text-base font-semibold text-[#17202A]">
                Sample Impact Preview
              </h3>
              <p className="text-xs text-[#52606D] mt-0.5">
                Complete cases before estimation — exported script prints fitted{' '}
                <code className="font-mono">e(N)</code> after running
                {spec.estimator === 'fe_reghdfe' ? ' (reghdfe may drop singletons)' : ''}.
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-[#1B365D] font-semibold">
              {impact.startingN.toLocaleString('en-US')} →{' '}
              {impact.previewCompleteCasesN.toLocaleString('en-US')} complete cases
              {impact.startingN > 0 && (
                <span className="font-normal text-[#52606D] ml-1.5">
                  ({((impact.previewCompleteCasesN / impact.startingN) * 100).toFixed(1)}%)
                </span>
              )}
            </div>
          </div>

          <div className="divide-y divide-[#F0ECE4] mt-1">
            {impact.steps.map((step) => {
              const isHighlighted = highlightedStepIds.has(step.id);
              return (
                <div
                  key={step.id}
                  className={`py-2 px-2 -mx-2 rounded flex items-center justify-between gap-4 text-xs transition-colors duration-300 motion-reduce:transition-none ${
                    isHighlighted ? 'bg-[#FEF3C7]/80' : 'bg-transparent'
                  }`}
                >
                  <div className="min-w-0">
                    <span
                      className={
                        step.kind === 'final'
                          ? 'font-semibold text-[#17202A]'
                          : 'font-medium text-[#17202A]'
                      }
                    >
                      {step.label}
                    </span>
                    <span className="text-[#7B8794] ml-2">{step.detail}</span>
                  </div>
                  <div className="font-mono tabular-nums shrink-0 text-right">
                    {step.kind === 'drop' && step.rowsAffected > 0 && (
                      <span className="text-[#B45309] mr-3">
                        −{step.rowsAffected.toLocaleString('en-US')}
                      </span>
                    )}
                    <span
                      className={
                        step.kind === 'final'
                          ? 'font-semibold text-[#1B365D]'
                          : 'text-[#17202A]'
                      }
                    >
                      N = {step.rowsRemaining.toLocaleString('en-US')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Model Suitability Blocked Banner */}
          {suitability.modelBlocked && (
            <div className="mt-3 p-3.5 rounded border border-[#FECACA] bg-[#FEF2F2] text-xs text-[#991B1B] space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Model Export Blocked — Variable Suitability Issue</span>
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-[11.5px]">
                {suitability.blockingReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <p className="text-[11px] text-[#7F1D1D]">
                Data inspection, summary statistics, and descriptive LaTeX exports remain unaffected.
              </p>
            </div>
          )}

          {suitability.warnings.length > 0 && !suitability.modelBlocked && (
            <div className="mt-3 pt-2.5 border-t border-[#F0ECE4] space-y-1 text-[11px] text-[#B45309]">
              {suitability.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {impact.postDedupPanelCheck.checked && (
            <div className="mt-3 pt-2.5 border-t border-[#F0ECE4] text-[11px] text-[#52606D] flex flex-wrap items-center justify-between gap-2">
              <span>
                Cleaned dataset panel structure ({dataset.panel.entityVar}, {dataset.panel.timeVar}; distinct from model complete-case sample):
              </span>
              <span
                className={`font-mono font-medium ${
                  impact.cleanedPanel.panelKeyStatus !== 'valid'
                    ? 'text-[#B45309]'
                    : impact.postDedupPanelCheck.isSafeForXtset
                      ? 'text-[#166534]'
                      : 'text-[#1B365D]'
                }`}
              >
                {formatPanelStatusHeadline(impact.cleanedPanel, 'cleaned rows')}
                {impact.postDedupPanelCheck.isSafeForXtset ? ' · xtset safe' : ' · xtset gated'}
              </span>
            </div>
          )}
        </section>

        {/* Syntax-Highlighted Stata .do Preview */}
        <SyntaxCodeBlock
          code={doCode}
          language="stata"
          fileName={doFileName}
          title={doFileName}
          subtitle={
            suitability.modelBlocked
              ? 'Exploratory cleaning & diagnostics ready — estimation block paused until suitability issues are resolved'
              : spec.importMode === 'normalized_bundle'
                ? `Paired with ${normalizedCsvName} — use Download Stata Bundle (.zip) for one-step execution`
                : `Executable raw-file import hygiene targeting ${dataset.fileName}`
          }
          copied={copiedKey === 'stata'}
          onCopy={() => onCopyCode(doCode, 'stata')}
          onDownload={() => onDownloadCode(doCode, doFileName)}
        />
      </div>
    </div>
  );
};
