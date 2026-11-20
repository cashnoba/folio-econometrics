import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Check } from 'lucide-react';
import type {
  DatasetState,
  DiagnosticsReport,
  DiagnosticsSubTab,
  LogTransformMode,
  ModelSpec,
  NumericSummary,
  OutlierMethod,
  RawRow,
  SampleImpact,
} from '../types/econometrics';
import { computeNumericSummary, formatNum } from '../lib/statistics';
import { formatBalanceLabel } from '../lib/panelStatus';
import { DistributionChart } from './DistributionChart';
import { TrendComparisonChart } from './TrendComparisonChart';

interface DiagnosticsViewProps {
  dataset: DatasetState;
  diagnostics: DiagnosticsReport;
  cleanedRows: RawRow[];
  cleanedSummaries: NumericSummary[];
  impact: SampleImpact;
  spec: ModelSpec;
  onToggleWinsorize: (varName: string) => void;
  onToggleLogTransform: (varName: string, recommendedMode: LogTransformMode) => void;
  onToggleDropDuplicates: () => void;
  onJumpToStata: () => void;
}

type SortField = 'label' | 'n' | 'mean' | 'sd' | 'min' | 'median' | 'max' | 'skewness';

function getCorrCellStyle(r: number | null, isDiag: boolean, isFlagged: boolean): React.CSSProperties {
  if (isDiag) {
    return { backgroundColor: '#F4F1EA', color: '#52606D' };
  }
  if (r === null) {
    return { backgroundColor: '#FFFFFF', color: '#9CA3AF' };
  }
  const abs = Math.min(1, Math.abs(r));
  if (r >= 0) {
    const alpha = Math.max(0.04, abs * 0.34);
    return {
      backgroundColor: `rgba(27, 54, 93, ${alpha.toFixed(3)})`,
      color: abs > 0.65 ? '#10243E' : '#17202A',
      fontWeight: isFlagged ? 700 : 400,
    };
  }
  const alpha = Math.max(0.04, abs * 0.32);
  return {
    backgroundColor: `rgba(153, 27, 27, ${alpha.toFixed(3)})`,
    color: abs > 0.65 ? '#7F1D1D' : '#17202A',
    fontWeight: isFlagged ? 700 : 400,
  };
}

export const DiagnosticsView: React.FC<DiagnosticsViewProps> = ({
  dataset,
  diagnostics,
  cleanedRows,
  cleanedSummaries,
  impact,
  spec,
  onToggleWinsorize,
  onToggleLogTransform,
  onToggleDropDuplicates,
  onJumpToStata,
}) => {
  const [subTab, setSubTab] = useState<DiagnosticsSubTab>('summary');
  const [decimals, setDecimals] = useState<2 | 3 | 4>(2);
  const [sortField, setSortField] = useState<SortField>('label');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [outlierMethod, setOutlierMethod] = useState<OutlierMethod>('iqr');
  const [chartSampleScope, setChartSampleScope] = useState<'raw' | 'cleaned'>('raw');
  const [selectedVar, setSelectedVar] = useState<string>(
    diagnostics.summaries[0]?.stataName ?? ''
  );

  const [flagMulticollinearity, setFlagMulticollinearity] = useState(true);
  const [corrThreshold, setCorrThreshold] = useState(0.7);
  const [hoveredCorr, setHoveredCorr] = useState<{
    varA: string;
    varB: string;
    r: number | null;
    n: number;
  } | null>(null);

  const activeSelectedVar = useMemo(() => {
    if (diagnostics.summaryMap[selectedVar]) return selectedVar;
    return diagnostics.summaries[0]?.stataName ?? '';
  }, [selectedVar, diagnostics]);

  const sortedSummaries = useMemo(() => {
    return [...diagnostics.summaries].sort((a, b) => {
      if (sortField === 'label') {
        return sortDir === 'asc'
          ? a.label.localeCompare(b.label)
          : b.label.localeCompare(a.label);
      }
      const av = a[sortField];
      const bv = b[sortField];
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [diagnostics.summaries, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'label' ? 'asc' : 'desc');
    }
  };

  const flaggedPairs = useMemo(() => {
    const vars = diagnostics.correlation.variables;
    const pairs: Array<{ varA: string; varB: string; r: number; n: number }> = [];
    for (let i = 0; i < vars.length; i++) {
      for (let j = i + 1; j < vars.length; j++) {
        const entry = diagnostics.correlation.matrix[vars[i]]?.[vars[j]];
        if (entry && entry.r !== null && Math.abs(entry.r) >= corrThreshold) {
          pairs.push({ varA: vars[i], varB: vars[j], r: entry.r, n: entry.n });
        }
      }
    }
    return pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  }, [diagnostics.correlation, corrThreshold]);

  const missingColumns = useMemo(
    () => dataset.columns.filter((c) => c.missingCount > 0).sort((a, b) => b.missingPct - a.missingPct),
    [dataset.columns]
  );

  // Build stable shared-domain raw & cleaned histograms for the selected variable so toggling never jumps scales
  const comparableChartState = useMemo(() => {
    const rawS = diagnostics.summaryMap[activeSelectedVar];
    const cleanS = cleanedSummaries.find((s) => s.stataName === activeSelectedVar);
    if (!rawS) return null;

    if (!cleanS || cleanS.n === 0 || rawS.n === 0) {
      return {
        displaySummary: chartSampleScope === 'cleaned' && cleanS ? cleanS : rawS,
        fixedDomain: undefined,
      };
    }

    const sharedMin = Math.min(rawS.boxplot.min, cleanS.boxplot.min);
    const sharedMax = Math.max(rawS.boxplot.max, cleanS.boxplot.max);
    const rawAligned = computeNumericSummary(dataset.rows, rawS.stataName, rawS.label, {
      min: sharedMin,
      max: sharedMax,
    });
    const cleanAligned = computeNumericSummary(cleanedRows, cleanS.stataName, cleanS.label, {
      min: sharedMin,
      max: sharedMax,
    });
    const maxBinCount = Math.max(
      ...rawAligned.histogram.map((b) => b.count),
      ...cleanAligned.histogram.map((b) => b.count),
      1
    );

    return {
      displaySummary: chartSampleScope === 'cleaned' ? cleanAligned : rawAligned,
      fixedDomain: { min: sharedMin, max: sharedMax, maxBinCount },
    };
  }, [
    diagnostics.summaryMap,
    cleanedSummaries,
    activeSelectedVar,
    chartSampleScope,
    dataset.rows,
    cleanedRows,
  ]);

  const activeSummary = comparableChartState?.displaySummary ?? diagnostics.summaryMap[activeSelectedVar];
  const activeChartRows = chartSampleScope === 'cleaned' ? cleanedRows : dataset.rows;
  const activeSampleLabel =
    chartSampleScope === 'cleaned'
      ? `Cleaned Sample (N = ${impact.afterExactDuplicatesN.toLocaleString('en-US')})`
      : `Raw Sample (N = ${dataset.rowCount.toLocaleString('en-US')})`;

  const getRecommendedLogMode = (varName: string): LogTransformMode => {
    const s = diagnostics.summaryMap[varName];
    if (!s) return 'ln';
    if (s.leqNegOneCount > 0) return 'asinh';
    if (s.nonPositiveCount > 0) return 'ln1p';
    return 'ln';
  };

  return (
    <div className="space-y-6">
      {/* Sub-tab navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E0D6] pb-3">
        <div className="inline-flex items-center gap-1 p-1 bg-[#F4F1EA] border border-[#E5E0D6] rounded">
          {(
            [
              { id: 'summary', label: 'Summary Statistics' },
              { id: 'quality', label: 'Data Quality & Outliers' },
              { id: 'correlation', label: 'Correlation Matrix' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                subTab === tab.id
                  ? 'bg-white text-[#1B365D] shadow-xs'
                  : 'text-[#52606D] hover:text-[#17202A]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[#52606D] font-mono tabular-nums">
          <span>{diagnostics.summaries.length} numeric vars</span>
          <span aria-hidden="true">·</span>
          <span>
            Complete across diagnostics vars (raw):{' '}
            {diagnostics.completeCaseNumericRows.toLocaleString('en-US')} /{' '}
            {dataset.rowCount.toLocaleString('en-US')} raw rows
          </span>
          {spec.depVar && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[#1B365D]">
                Complete cases for selected model: {impact.previewCompleteCasesN.toLocaleString('en-US')} /{' '}
                {impact.afterExactDuplicatesN.toLocaleString('en-US')} cleaned rows
              </span>
            </>
          )}
          {diagnostics.exactDuplicateRows > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[#B45309] font-medium">
                {diagnostics.exactDuplicateRows} exact duplicate(s)
              </span>
            </>
          )}
        </div>
      </div>

      {/* TAB 1: SUMMARY STATISTICS */}
      {subTab === 'summary' && (
        <section className="bg-white border border-[#E5E0D6] rounded-md overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-[#E5E0D6] bg-[#FAF8F4]">
            <div>
              <h2 className="font-serif text-lg font-semibold text-[#17202A]">
                Descriptive Summary Statistics
              </h2>
              <p className="text-xs text-[#52606D] mt-0.5">
                Click any variable row to inspect its distribution histogram, boxplot, period trend, and tail outliers.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#52606D]">
              <span>Decimals</span>
              <div className="inline-flex border border-[#CFC7B8] rounded overflow-hidden bg-white">
                {([2, 3, 4] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDecimals(d)}
                    className={`px-2.5 py-1 font-mono text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B365D] ${
                      decimals === d
                        ? 'bg-[#1B365D] text-white'
                        : 'text-[#52606D] hover:bg-[#FAF8F4]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {sortedSummaries.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#52606D]">
              No numeric variables were detected in this dataset.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#17202A] text-[11px] font-semibold text-[#17202A] bg-white">
                    {(
                      [
                        { key: 'label', label: 'Variable', align: 'left' },
                        { key: 'n', label: 'N', align: 'right' },
                        { key: 'mean', label: 'Mean', align: 'right' },
                        { key: 'sd', label: 'SD', align: 'right' },
                        { key: 'min', label: 'Min', align: 'right' },
                        { key: null, label: 'p25', align: 'right' },
                        { key: 'median', label: 'Median', align: 'right' },
                        { key: null, label: 'p75', align: 'right' },
                        { key: 'max', label: 'Max', align: 'right' },
                        { key: 'skewness', label: 'Skew', align: 'right' },
                      ] as const
                    ).map((h) => (
                      <th
                        key={h.label}
                        className={`py-2.5 px-3.5 whitespace-nowrap ${
                          h.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h.key ? (
                          <button
                            type="button"
                            onClick={() => handleSort(h.key)}
                            className="inline-flex items-center gap-1 hover:text-[#1B365D] cursor-pointer"
                          >
                            <span>{h.label}</span>
                            {sortField === h.key &&
                              (sortDir === 'asc' ? (
                                <ArrowUp className="w-3 h-3" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="w-3 h-3" aria-hidden="true" />
                              ))}
                          </button>
                        ) : (
                          h.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFECE6] text-xs">
                  {sortedSummaries.map((s) => {
                    const highSkew = Math.abs(s.skewness) >= 1;
                    return (
                      <tr
                        key={s.stataName}
                        onClick={() => {
                          setSelectedVar(s.stataName);
                          setSubTab('quality');
                        }}
                        className="hover:bg-[#FAF8F4] transition-colors cursor-pointer"
                      >
                        <td className="py-2.5 px-3.5">
                          <div className="font-medium text-[#17202A]">{s.label}</div>
                          <div className="text-[11px] font-mono text-[#7B8794]">
                            {s.stataName}
                            {s.nonPositiveCount > 0 ? ` · ${s.nonPositiveCount} obs ≤ 0` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-[#52606D]">
                          {s.n.toLocaleString('en-US')}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-[#17202A]">
                          {formatNum(s.mean, decimals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-[#52606D]">
                          {formatNum(s.sd, decimals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-[#52606D]">
                          {formatNum(s.min, decimals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-[#52606D]">
                          {formatNum(s.p25, decimals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-medium text-[#17202A]">
                          {formatNum(s.median, decimals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-[#52606D]">
                          {formatNum(s.p75, decimals)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-[#52606D]">
                          {formatNum(s.max, decimals)}
                        </td>
                        <td
                          className={`py-2.5 px-3.5 text-right font-mono tabular-nums ${
                            highSkew ? 'text-[#B45309] font-semibold' : 'text-[#52606D]'
                          }`}
                        >
                          {formatNum(s.skewness, 2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: DATA QUALITY, DUPLICATES & OUTLIERS */}
      {subTab === 'quality' && (
        <div className="space-y-6">
          {/* Unboxed Quality Audit Strip */}
          <div className="bg-white border border-[#E5E0D6] rounded-md px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 divide-y lg:divide-y-0 lg:divide-x divide-[#EFECE6]">
            <div>
              <div className="text-xs text-[#52606D]">Exact Duplicate Rows (Raw)</div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span
                  className={`font-mono text-xl font-semibold tabular-nums ${
                    diagnostics.exactDuplicateRows > 0 ? 'text-[#B45309]' : 'text-[#166534]'
                  }`}
                >
                  {diagnostics.exactDuplicateRows}
                </span>
                {diagnostics.exactDuplicateRows > 0 && (
                  <button
                    type="button"
                    onClick={onToggleDropDuplicates}
                    className="text-xs font-medium text-[#1B365D] hover:underline whitespace-nowrap cursor-pointer"
                  >
                    {spec.dropExactDuplicates ? 'Queued: duplicates drop' : 'Queue duplicates drop'}
                  </button>
                )}
              </div>
              <div className="text-[11px] text-[#7B8794] mt-0.5 font-mono tabular-nums">
                Raw rows: {dataset.rowCount.toLocaleString('en-US')} → Cleaned rows:{' '}
                {impact.afterExactDuplicatesN.toLocaleString('en-US')}
              </div>
            </div>

            <div className="pt-3 lg:pt-0 lg:pl-6">
              <div className="text-xs text-[#52606D]">Panel Keys &amp; Balance (Raw → Cleaned)</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={`font-mono text-xl font-semibold tabular-nums ${
                    impact.cleanedPanel.isPanel && impact.cleanedPanel.panelKeyStatus !== 'valid'
                      ? 'text-[#B45309]'
                      : 'text-[#166534]'
                  }`}
                >
                  {dataset.panel.repeatedKeyGroups} → {impact.cleanedPanel.repeatedKeyGroups}
                </span>
                <span className="text-[11px] text-[#7B8794]">repeated groups</span>
              </div>
              <div className="text-[11px] text-[#52606D] mt-0.5">
                {dataset.panel.distinctKeyConflictRows > 0
                  ? `${dataset.panel.distinctKeyConflictRows} distinct-record key conflict(s)`
                  : impact.cleanedPanel.isPanel
                    ? `Cleaned: ${formatBalanceLabel(impact.cleanedPanel)}`
                    : dataset.panel.structureKind === 'dated_cross_section'
                      ? 'Dated cross-section'
                      : 'Cross-section'}
              </div>
            </div>

            <div className="pt-3 lg:pt-0 lg:pl-6">
              <div className="text-xs text-[#52606D]">Complete Across Diagnostics Vars (Raw)</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-xl font-semibold tabular-nums text-[#17202A]">
                  {diagnostics.completeCaseNumericRows.toLocaleString('en-US')}
                </span>
                <span className="text-xs font-mono text-[#7B8794]">
                  / {dataset.rowCount.toLocaleString('en-US')} ({((diagnostics.completeCaseNumericRows / Math.max(1, dataset.rowCount)) * 100).toFixed(1)}%)
                </span>
              </div>
              <div className="text-[11px] text-[#7B8794] mt-0.5 font-mono tabular-nums">
                All {dataset.columnCount} cols complete: {diagnostics.completeCaseRows.toLocaleString('en-US')} ·{' '}
                {missingColumns.length} col(s) with missingness
              </div>
            </div>

            <div className="pt-3 lg:pt-0 lg:pl-6">
              <div className="text-xs text-[#52606D]">Complete Cases for Selected Model</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-xl font-semibold tabular-nums text-[#1B365D]">
                  {spec.depVar
                    ? impact.previewCompleteCasesN.toLocaleString('en-US')
                    : '—'}
                </span>
                {spec.depVar && (
                  <span className="text-xs font-mono text-[#7B8794]">
                    / {impact.afterExactDuplicatesN.toLocaleString('en-US')} cleaned
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[#7B8794] mt-0.5">
                {spec.depVar
                  ? 'Before estimation (separate from dataset balance)'
                  : 'Select Y in Stata Model Builder to preview'}
              </div>
            </div>
          </div>

          {/* Interactive Distribution + Period/Group Comparison Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Outlier Screening Table */}
            <div className="lg:col-span-5 bg-white border border-[#E5E0D6] rounded-md overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#E5E0D6] bg-[#FAF8F4]">
                <h3 className="font-serif text-base font-semibold text-[#17202A]">
                  Outlier &amp; Skewness Audit
                </h3>
                <div className="inline-flex border border-[#CFC7B8] rounded overflow-hidden bg-white text-[11px]">
                  <button
                    type="button"
                    onClick={() => setOutlierMethod('iqr')}
                    className={`px-2.5 py-1 font-medium cursor-pointer ${
                      outlierMethod === 'iqr'
                        ? 'bg-[#1B365D] text-white'
                        : 'text-[#52606D] hover:bg-[#FAF8F4]'
                    }`}
                  >
                    1.5×IQR
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutlierMethod('zscore')}
                    className={`px-2.5 py-1 font-medium cursor-pointer ${
                      outlierMethod === 'zscore'
                        ? 'bg-[#1B365D] text-white'
                        : 'text-[#52606D] hover:bg-[#FAF8F4]'
                    }`}
                  >
                    |z| &gt; 3
                  </button>
                </div>
              </div>

              <div className="divide-y divide-[#F0ECE4] max-h-[520px] overflow-y-auto">
                {diagnostics.summaries.map((s) => {
                  const flagCount =
                    outlierMethod === 'iqr' ? s.iqrOutlierCount : s.zOutlierCount;
                  const isSelected = s.stataName === activeSelectedVar;
                  const isWinsorized = spec.winsorizeVars.includes(s.stataName);
                  const logMode = spec.logTransforms[s.stataName];

                  return (
                    <button
                      key={s.stataName}
                      type="button"
                      onClick={() => setSelectedVar(s.stataName)}
                      className={`w-full text-left px-4 py-3 cursor-pointer transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B365D] ${
                        isSelected ? 'bg-[#1B365D]/6' : 'hover:bg-[#FAF8F4]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#17202A] truncate">
                            {s.label}
                          </div>
                          <div className="text-[11px] font-mono text-[#7B8794]">
                            {s.stataName} · skew {formatNum(s.skewness, 2)}
                          </div>
                        </div>
                        <div className="text-right shrink-0 font-mono tabular-nums">
                          <div
                            className={`text-xs font-semibold ${
                              flagCount > 0 ? 'text-[#991B1B]' : 'text-[#166534]'
                            }`}
                          >
                            {flagCount} flagged
                          </div>
                          <div className="text-[11px] text-[#7B8794]">
                            {s.n > 0 ? ((flagCount / s.n) * 100).toFixed(1) : '0.0'}%
                          </div>
                        </div>
                      </div>

                      {(isWinsorized || logMode) && (
                        <div className="mt-1.5 text-[11px] font-mono text-[#1B365D]">
                          Active in .do:{' '}
                          {[
                            isWinsorized && `winsor2 (${spec.winsorizeLevel}%)`,
                            logMode && `${logMode}(${s.stataName})`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Sample-Locked Distribution Chart, Period/Group Chart & Quick Stata Actions */}
            <div className="lg:col-span-7 space-y-4">
              {activeSummary ? (
                <>
                  {/* Raw vs. Cleaned Sample Switcher with locked axis scales */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#E5E0D6] rounded-md px-4 py-2.5 text-xs">
                    <span className="text-[#52606D]">
                      Chart Sample <span className="text-[#7B8794]">(axes locked for comparison)</span>
                    </span>
                    <div className="inline-flex p-0.5 bg-[#F4F1EA] border border-[#E5E0D6] rounded">
                      <button
                        type="button"
                        onClick={() => setChartSampleScope('raw')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                          chartSampleScope === 'raw'
                            ? 'bg-white text-[#1B365D] shadow-xs'
                            : 'text-[#52606D] hover:text-[#17202A]'
                        }`}
                      >
                        Raw (N = {dataset.rowCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartSampleScope('cleaned')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                          chartSampleScope === 'cleaned'
                            ? 'bg-white text-[#1B365D] shadow-xs'
                            : 'text-[#52606D] hover:text-[#17202A]'
                        }`}
                      >
                        Cleaned (N = {impact.afterExactDuplicatesN})
                      </button>
                    </div>
                  </div>

                  <DistributionChart
                    summary={activeSummary}
                    outlierMethod={outlierMethod}
                    fixedDomain={comparableChartState?.fixedDomain}
                    sampleBadge={chartSampleScope === 'cleaned' ? 'Cleaned Sample' : 'Raw Sample'}
                  />

                  <TrendComparisonChart
                    dataset={dataset}
                    rows={activeChartRows}
                    sampleLabel={activeSampleLabel}
                    selectedVar={activeSummary.stataName}
                    selectedVarLabel={activeSummary.label}
                  />

                  <div className="bg-white border border-[#E5E0D6] rounded-md px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-[#52606D]">
                      <span className="font-semibold text-[#17202A]">Direct Pipeline Actions</span>{' '}
                      for <code className="font-mono text-[#17202A]">{activeSummary.stataName}</code>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleWinsorize(activeSummary.stataName)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap cursor-pointer ${
                          spec.winsorizeVars.includes(activeSummary.stataName)
                            ? 'bg-[#1B365D] text-white border-[#1B365D]'
                            : 'bg-white text-[#17202A] border-[#CFC7B8] hover:bg-[#FAF8F4]'
                        }`}
                      >
                        {spec.winsorizeVars.includes(activeSummary.stataName) && (
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>
                          {spec.winsorizeVars.includes(activeSummary.stataName)
                            ? `Winsorized (${spec.winsorizeLevel}%/${100 - spec.winsorizeLevel}%)`
                            : 'Flag for Winsorization'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onToggleLogTransform(
                            activeSummary.stataName,
                            getRecommendedLogMode(activeSummary.stataName)
                          )
                        }
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap cursor-pointer ${
                          spec.logTransforms[activeSummary.stataName]
                            ? 'bg-[#1B365D] text-white border-[#1B365D]'
                            : 'bg-white text-[#17202A] border-[#CFC7B8] hover:bg-[#FAF8F4]'
                        }`}
                      >
                        {spec.logTransforms[activeSummary.stataName] && (
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>
                          {spec.logTransforms[activeSummary.stataName]
                            ? `Transform: ${spec.logTransforms[activeSummary.stataName]}()`
                            : `Add ${getRecommendedLogMode(activeSummary.stataName)}() Transform`}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={onJumpToStata}
                        className="px-3 py-1.5 text-xs font-medium text-[#1B365D] hover:underline whitespace-nowrap cursor-pointer"
                      >
                        View in Stata .do →
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-white border border-[#E5E0D6] rounded-md p-8 text-center text-sm text-[#52606D]">
                  No numeric variables available to plot.
                </div>
              )}

              {/* Missing Value Pattern Breakdown */}
              <div className="bg-white border border-[#E5E0D6] rounded-md overflow-hidden">
                <div className="px-5 py-3 border-b border-[#E5E0D6] bg-[#FAF8F4]">
                  <h3 className="font-serif text-base font-semibold text-[#17202A]">
                    Missingness Pattern Breakdown
                  </h3>
                </div>
                {missingColumns.length === 0 ? (
                  <div className="px-5 py-4 text-xs text-[#166534]">
                    Zero missing values detected across all {dataset.columnCount} columns.
                  </div>
                ) : (
                  <div className="divide-y divide-[#F0ECE4]">
                    {missingColumns.map((col) => (
                      <div
                        key={col.stataName}
                        className="px-5 py-2.5 flex items-center justify-between gap-4 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-mono font-medium text-[#17202A]">
                            {col.stataName}
                          </span>
                          <span className="text-[#7B8794] ml-2">{col.label}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="w-28 h-1.5 bg-[#EFECE6] rounded-xs overflow-hidden">
                            <div
                              className="h-full bg-[#B45309]"
                              style={{ width: `${Math.min(100, Math.max(2, col.missingPct))}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-[#B45309] w-24 text-right">
                            {col.missingCount} ({col.missingPct.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CORRELATION MATRIX */}
      {subTab === 'correlation' && (
        <section className="space-y-5">
          <div className="bg-white border border-[#E5E0D6] rounded-md overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-[#E5E0D6] bg-[#FAF8F4]">
              <div>
                <h2 className="font-serif text-lg font-semibold text-[#17202A]">
                  Pairwise Pearson Correlation Matrix
                </h2>
                <p className="text-xs text-[#52606D] mt-0.5 font-mono tabular-nums">
                  {hoveredCorr ? (
                    <span className="text-[#17202A]">
                      {hoveredCorr.varA} × {hoveredCorr.varB}:{' '}
                      <strong>
                        r = {hoveredCorr.r !== null ? hoveredCorr.r.toFixed(4) : '—'}
                      </strong>{' '}
                      (pairwise N = {hoveredCorr.n.toLocaleString('en-US')})
                    </span>
                  ) : (
                    <span>
                      Hover any cell for exact r and pairwise N · Range:{' '}
                      {diagnostics.correlation.minPairwiseN.toLocaleString('en-US')}–
                      {diagnostics.correlation.maxPairwiseN.toLocaleString('en-US')}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer text-[#17202A]">
                  <input
                    type="checkbox"
                    checked={flagMulticollinearity}
                    onChange={(e) => setFlagMulticollinearity(e.target.checked)}
                    className="accent-[#1B365D]"
                  />
                  <span>Flag high |r|</span>
                </label>

                <label className="inline-flex items-center gap-2 text-[#52606D] font-mono tabular-nums">
                  <span>|r| ≥ {corrThreshold.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.5}
                    max={0.9}
                    step={0.05}
                    value={corrThreshold}
                    onChange={(e) => setCorrThreshold(Number(e.target.value))}
                    disabled={!flagMulticollinearity}
                    className="w-24 accent-[#1B365D] cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {diagnostics.correlation.variables.length < 2 ? (
              <div className="p-8 text-center text-sm text-[#52606D]">
                At least two numeric variables are required to compute a correlation matrix.
              </div>
            ) : (
              <div className="overflow-x-auto p-4">
                <table className="w-full border-collapse text-xs font-mono tabular-nums">
                  <thead>
                    <tr>
                      <th className="py-2 px-3 text-left text-[#52606D] font-sans font-semibold border-b border-[#CFC7B8]">
                        Variable
                      </th>
                      {diagnostics.correlation.variables.map((v, idx) => (
                        <th
                          key={v}
                          title={v}
                          className="py-2 px-2 text-right text-[#52606D] border-b border-[#CFC7B8] whitespace-nowrap"
                        >
                          ({idx + 1}) {v.length > 10 ? `${v.slice(0, 9)}…` : v}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostics.correlation.variables.map((rowVar, rIdx) => (
                      <tr key={rowVar}>
                        <td className="py-2 px-3 text-left text-[#17202A] font-medium border-b border-[#F0ECE4] whitespace-nowrap">
                          ({rIdx + 1}) {rowVar}
                        </td>
                        {diagnostics.correlation.variables.map((colVar, cIdx) => {
                          const entry = diagnostics.correlation.matrix[rowVar]?.[colVar];
                          const isDiag = rIdx === cIdx;
                          const isFlagged =
                            flagMulticollinearity &&
                            !isDiag &&
                            entry?.r !== null &&
                            Math.abs(entry.r) >= corrThreshold;

                          return (
                            <td
                              key={colVar}
                              onMouseEnter={() =>
                                setHoveredCorr({
                                  varA: rowVar,
                                  varB: colVar,
                                  r: entry?.r ?? null,
                                  n: entry?.n ?? 0,
                                })
                              }
                              onMouseLeave={() => setHoveredCorr(null)}
                              style={getCorrCellStyle(entry?.r ?? null, isDiag, isFlagged)}
                              className={`py-2 px-2 text-right border border-[#EFECE6] transition-colors ${
                                isFlagged ? 'ring-1 ring-inset ring-[#991B1B]' : ''
                              }`}
                            >
                              {entry?.r !== null && entry?.r !== undefined
                                ? entry.r.toFixed(2)
                                : '—'}
                              {isFlagged ? '*' : ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Multicollinearity Flagged Pairs */}
          {flagMulticollinearity && (
            <div className="bg-white border border-[#E5E0D6] rounded-md px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#17202A] mb-2">
                <AlertTriangle
                  className={`w-4 h-4 ${
                    flaggedPairs.length > 0 ? 'text-[#991B1B]' : 'text-[#166534]'
                  }`}
                  aria-hidden="true"
                />
                <span>
                  Multicollinearity Screening (|r| ≥ {corrThreshold.toFixed(2)})
                </span>
              </div>
              {flaggedPairs.length === 0 ? (
                <p className="text-xs text-[#166534]">
                  No off-diagonal numeric variable pairs exceed |r| ≥ {corrThreshold.toFixed(2)}.
                </p>
              ) : (
                <div className="divide-y divide-[#F0ECE4]">
                  {flaggedPairs.map((pair) => (
                    <div
                      key={`${pair.varA}-${pair.varB}`}
                      className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-mono text-[#17202A]">
                        {pair.varA} <span className="text-[#7B8794]">↔</span> {pair.varB}
                      </span>
                      <span className="font-mono tabular-nums text-[#991B1B] font-semibold">
                        r = {pair.r.toFixed(3)}{' '}
                        <span className="font-normal text-[#7B8794]">
                          (N = {pair.n.toLocaleString('en-US')})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
