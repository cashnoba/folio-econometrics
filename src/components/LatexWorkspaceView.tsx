import React, { useMemo } from 'react';
import type {
  CorrelationMatrixData,
  DatasetState,
  LatexConfig,
  LatexPageFitPreset,
  ModelSpec,
  NumericSummary,
  SampleImpact,
} from '../types/econometrics';
import { formatNum } from '../lib/statistics';
import { describePanelForSample, generateLatexTable } from '../lib/latexGenerator';
import { SyntaxCodeBlock } from './SyntaxCodeBlock';

interface LatexWorkspaceViewProps {
  dataset: DatasetState;
  rawSummaries: NumericSummary[];
  rawCorrelation: CorrelationMatrixData;
  cleanedSummaries: NumericSummary[];
  cleanedCorrelation: CorrelationMatrixData;
  spec: ModelSpec;
  impact: SampleImpact;
  config: LatexConfig;
  onChangeConfig: (next: LatexConfig) => void;
  onCopyCode: (code: string, label: string) => void;
  onDownloadCode: (code: string, fileName: string) => void;
  copiedKey: string | null;
}

export const LatexWorkspaceView: React.FC<LatexWorkspaceViewProps> = ({
  dataset,
  rawSummaries,
  rawCorrelation,
  cleanedSummaries,
  cleanedCorrelation,
  spec,
  impact,
  config,
  onChangeConfig,
  onCopyCode,
  onDownloadCode,
  copiedKey,
}) => {
  const activeSummaries = config.sampleScope === 'cleaned' ? cleanedSummaries : rawSummaries;
  const activeCorrelation =
    config.sampleScope === 'cleaned' ? cleanedCorrelation : rawCorrelation;

  const selectedSummaries = useMemo(() => {
    const sel = new Set(config.selectedVars);
    return activeSummaries.filter((s) => sel.has(s.stataName));
  }, [activeSummaries, config.selectedVars]);

  const latexCode = useMemo(
    () =>
      generateLatexTable(
        dataset,
        activeSummaries,
        activeCorrelation,
        config,
        spec,
        impact
      ),
    [dataset, activeSummaries, activeCorrelation, config, spec, impact]
  );

  const fileStem = dataset.fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const texFileName = `${fileStem}_${config.tableType}.tex`;

  const toggleVar = (varName: string) => {
    const exists = config.selectedVars.includes(varName);
    const next = exists
      ? config.selectedVars.filter((v) => v !== varName)
      : [...config.selectedVars, varName];
    onChangeConfig({ ...config, selectedVars: next });
  };

  const isSixCol = config.pageFitPreset === 'compact_6col';

  const presetOptions: Array<{ id: LatexPageFitPreset; label: string }> = [
    { id: 'compact_article', label: 'Compact Article' },
    { id: 'compact_6col', label: 'Compact 6-Col' },
    { id: 'standard', label: 'Standard Wide' },
  ];

  const requiredPackagesText = [
    '\\usepackage{booktabs}',
    '\\usepackage{threeparttable}',
    config.pageFitPreset !== 'standard' ? '\\usepackage{array}' : null,
    config.useResizeBox ? '\\usepackage{graphicx}' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* LEFT: TABLE CONFIGURATION */}
      <section className="xl:col-span-4 bg-white border border-[#E5E0D6] rounded-md p-5 space-y-5">
        <div className="border-b border-[#E5E0D6] pb-3">
          <h2 className="font-serif text-base font-semibold text-[#17202A]">
            LaTeX Table Configuration
          </h2>
          <p className="text-xs text-[#52606D] mt-0.5">
            Generates publication-ready <code className="font-mono">booktabs</code> &amp;{' '}
            <code className="font-mono">threeparttable</code> code.
          </p>
        </div>

        {/* Table Type */}
        <div>
          <div className="text-xs font-medium text-[#52606D] mb-1.5">Table Format</div>
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#F4F1EA] border border-[#E5E0D6] rounded">
            {(
              [
                { id: 'summary', label: 'Summary Stats' },
                { id: 'correlation', label: 'Correlations' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() =>
                  onChangeConfig({
                    ...config,
                    tableType: opt.id,
                    caption:
                      opt.id === 'summary'
                        ? 'Descriptive Summary Statistics'
                        : 'Pairwise Pearson Correlation Matrix',
                    label: opt.id === 'summary' ? 'tab:summary_stats' : 'tab:correlations',
                  })
                }
                className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  config.tableType === opt.id
                    ? 'bg-white text-[#1B365D] shadow-xs'
                    : 'text-[#52606D] hover:text-[#17202A]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Page Fit Preset */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-[#52606D]">Page Fit Preset</div>
          <div className="grid grid-cols-3 gap-1 p-1 bg-[#F4F1EA] border border-[#E5E0D6] rounded">
            {presetOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeConfig({ ...config, pageFitPreset: opt.id })}
                className={`py-1.5 px-1.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  config.pageFitPreset === opt.id
                    ? 'bg-white text-[#1B365D] shadow-xs'
                    : 'text-[#52606D] hover:text-[#17202A]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#7B8794] leading-relaxed">
            {config.pageFitPreset === 'compact_article'
              ? 'Uses \\footnotesize, tight \\tabcolsep (3pt), and wrapped variable labels to fit standard LaTeX article margins without overflowing.'
              : config.pageFitPreset === 'compact_6col'
                ? 'Omits p25/p75 in summary tables for narrow journal columns without font scaling.'
                : 'Uncompacted \\normalsize layout for wide geometry or landscape tables.'}
          </p>
          <label className="flex items-center justify-between text-xs text-[#17202A] pt-1 cursor-pointer">
            <span>
              Scale to <code className="font-mono text-[11px]">\linewidth</code> (
              <code className="font-mono text-[11px]">\resizebox</code>)
            </span>
            <input
              type="checkbox"
              checked={config.useResizeBox}
              onChange={(e) => onChangeConfig({ ...config, useResizeBox: e.target.checked })}
              className="accent-[#1B365D]"
            />
          </label>
        </div>

        {/* Sample Scope */}
        <div>
          <div className="text-xs font-medium text-[#52606D] mb-1.5">Sample Described</div>
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#F4F1EA] border border-[#E5E0D6] rounded">
            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, sampleScope: 'raw' })}
              className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                config.sampleScope === 'raw'
                  ? 'bg-white text-[#1B365D] shadow-xs'
                  : 'text-[#52606D] hover:text-[#17202A]'
              }`}
            >
              Raw (N = {dataset.rowCount})
            </button>
            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, sampleScope: 'cleaned' })}
              className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                config.sampleScope === 'cleaned'
                  ? 'bg-white text-[#1B365D] shadow-xs'
                  : 'text-[#52606D] hover:text-[#17202A]'
              }`}
            >
              Cleaned (N = {impact.afterExactDuplicatesN})
            </button>
          </div>
          <p className="text-[11px] text-[#7B8794] mt-1">
            Sample scope, cleaning steps, and pairwise N range are automatically documented in{' '}
            <code className="font-mono">\begin&#123;tablenotes&#125;</code>.
          </p>
        </div>

        {/* Decimals */}
        <div>
          <div className="text-xs font-medium text-[#52606D] mb-1.5">Decimal Places</div>
          <div className="grid grid-cols-4 border border-[#CFC7B8] rounded overflow-hidden bg-white">
            {([1, 2, 3, 4] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onChangeConfig({ ...config, decimals: d })}
                className={`py-1.5 text-xs font-mono cursor-pointer ${
                  config.decimals === d
                    ? 'bg-[#1B365D] text-white'
                    : 'text-[#52606D] hover:bg-[#FAF8F4]'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Caption & Label */}
        <div className="space-y-3">
          <div>
            <label htmlFor="latex-caption" className="block text-xs font-medium text-[#52606D] mb-1">
              Table Caption
            </label>
            <input
              id="latex-caption"
              type="text"
              value={config.caption}
              onChange={(e) => onChangeConfig({ ...config, caption: e.target.value })}
              className="w-full px-3 py-1.5 text-xs bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus:outline-none focus:border-[#1B365D]"
            />
          </div>
          <div>
            <label htmlFor="latex-label" className="block text-xs font-medium text-[#52606D] mb-1">
              LaTeX Label
            </label>
            <input
              id="latex-label"
              type="text"
              value={config.label}
              onChange={(e) => onChangeConfig({ ...config, label: e.target.value })}
              className="w-full px-3 py-1.5 text-xs font-mono bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus:outline-none focus:border-[#1B365D]"
            />
          </div>
        </div>

        {config.tableType === 'correlation' && (
          <div className="pt-2 border-t border-[#F0ECE4] space-y-2">
            <label className="flex items-center justify-between text-xs text-[#17202A] cursor-pointer">
              <span>Bold high correlations (\textbf)</span>
              <input
                type="checkbox"
                checked={config.boldHighCorrelations}
                onChange={(e) =>
                  onChangeConfig({ ...config, boldHighCorrelations: e.target.checked })
                }
                className="accent-[#1B365D]"
              />
            </label>
            {config.boldHighCorrelations && (
              <div className="flex items-center justify-between text-xs text-[#52606D] font-mono">
                <span>Threshold: |r| ≥ {config.highlightThreshold.toFixed(2)}</span>
                <input
                  type="range"
                  min={0.5}
                  max={0.9}
                  step={0.05}
                  value={config.highlightThreshold}
                  onChange={(e) =>
                    onChangeConfig({ ...config, highlightThreshold: Number(e.target.value) })
                  }
                  className="w-24 accent-[#1B365D]"
                />
              </div>
            )}
          </div>
        )}

        {/* Variable Subset Picker */}
        <div className="pt-2 border-t border-[#F0ECE4]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[#52606D]">Included Variables</span>
            <button
              type="button"
              onClick={() =>
                onChangeConfig({
                  ...config,
                  selectedVars:
                    config.selectedVars.length === activeSummaries.length
                      ? []
                      : activeSummaries.map((s) => s.stataName),
                })
              }
              className="text-[11px] font-medium text-[#1B365D] hover:underline cursor-pointer"
            >
              {config.selectedVars.length === activeSummaries.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {activeSummaries.map((s) => (
              <label
                key={s.stataName}
                className="flex items-center justify-between gap-2 text-xs py-1 cursor-pointer"
              >
                <span className="truncate text-[#17202A]">
                  <span className="font-mono text-[11px] text-[#52606D] mr-1.5">{s.stataName}</span>
                  {s.label}
                </span>
                <input
                  type="checkbox"
                  checked={config.selectedVars.includes(s.stataName)}
                  onChange={() => toggleVar(s.stataName)}
                  className="accent-[#1B365D] shrink-0"
                />
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* RIGHT: LIVE ACADEMIC PREVIEW + LATEX SOURCE */}
      <div className="xl:col-span-8 space-y-5">
        {/* Live Journal-Style Typeset Preview */}
        <section className="bg-white border border-[#E5E0D6] rounded-md p-6">
          <div className="text-center mb-4">
            <div className="text-[11px] font-mono text-[#7B8794]">
              Rendered Publication Preview ·{' '}
              {config.sampleScope === 'cleaned' ? 'Cleaned Sample' : 'Raw Sample'} ·{' '}
              {config.pageFitPreset === 'compact_article'
                ? 'Compact Article Fit'
                : config.pageFitPreset === 'compact_6col'
                  ? 'Compact 6-Col'
                  : 'Standard Wide'}
            </div>
            <h3 className="font-serif text-base font-semibold text-[#17202A] mt-1">
              Table 1. {config.caption}
            </h3>
          </div>

          {selectedSummaries.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#52606D]">
              Select at least one variable on the left to preview the table.
            </div>
          ) : config.tableType === 'summary' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-t-2 border-b border-[#17202A] font-serif text-[#17202A]">
                    <th className="py-2 px-2 text-left font-semibold">Variable</th>
                    <th className="py-2 px-2 text-right font-semibold italic">N</th>
                    <th className="py-2 px-2 text-right font-semibold">Mean</th>
                    <th className="py-2 px-2 text-right font-semibold">SD</th>
                    <th className="py-2 px-2 text-right font-semibold">Min</th>
                    {!isSixCol && <th className="py-2 px-2 text-right font-semibold">p25</th>}
                    <th className="py-2 px-2 text-right font-semibold">
                      {config.pageFitPreset === 'compact_article' ? 'Med.' : 'Median'}
                    </th>
                    {!isSixCol && <th className="py-2 px-2 text-right font-semibold">p75</th>}
                    <th className="py-2 px-2 text-right font-semibold">Max</th>
                  </tr>
                </thead>
                <tbody className="border-b-2 border-[#17202A] font-mono tabular-nums text-[11.5px]">
                  {selectedSummaries.map((s) => (
                    <tr key={s.stataName}>
                      <td className="py-1.5 px-2 font-sans text-[#17202A]">{s.label}</td>
                      <td className="py-1.5 px-2 text-right">{s.n.toLocaleString('en-US')}</td>
                      <td className="py-1.5 px-2 text-right">{formatNum(s.mean, config.decimals)}</td>
                      <td className="py-1.5 px-2 text-right">{formatNum(s.sd, config.decimals)}</td>
                      <td className="py-1.5 px-2 text-right">{formatNum(s.min, config.decimals)}</td>
                      {!isSixCol && (
                        <td className="py-1.5 px-2 text-right">{formatNum(s.p25, config.decimals)}</td>
                      )}
                      <td className="py-1.5 px-2 text-right">{formatNum(s.median, config.decimals)}</td>
                      {!isSixCol && (
                        <td className="py-1.5 px-2 text-right">{formatNum(s.p75, config.decimals)}</td>
                      )}
                      <td className="py-1.5 px-2 text-right">{formatNum(s.max, config.decimals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-t-2 border-b border-[#17202A] font-serif text-[#17202A]">
                    <th className="py-2 px-2 text-left font-semibold">Variable</th>
                    {selectedSummaries.map((s, idx) => (
                      <th key={s.stataName} className="py-2 px-2 text-right font-semibold">
                        ({idx + 1})
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="border-b-2 border-[#17202A] font-mono tabular-nums text-[11.5px]">
                  {selectedSummaries.map((rowS, i) => (
                    <tr key={rowS.stataName}>
                      <td className="py-1.5 px-2 font-sans text-[#17202A] whitespace-nowrap">
                        ({i + 1}) {rowS.label}
                      </td>
                      {selectedSummaries.map((colS, j) => {
                        if (j > i) return <td key={colS.stataName} className="py-1.5 px-2" />;
                        if (j === i) {
                          return (
                            <td key={colS.stataName} className="py-1.5 px-2 text-right text-[#52606D]">
                              {(1).toFixed(config.decimals)}
                            </td>
                          );
                        }
                        const entry = activeCorrelation.matrix[rowS.stataName]?.[colS.stataName];
                        const isBold =
                          config.boldHighCorrelations &&
                          entry?.r !== null &&
                          entry?.r !== undefined &&
                          Math.abs(entry.r) >= config.highlightThreshold;
                        return (
                          <td
                            key={colS.stataName}
                            className={`py-1.5 px-2 text-right ${isBold ? 'font-bold text-[#17202A]' : 'text-[#52606D]'}`}
                          >
                            {entry?.r !== null && entry?.r !== undefined
                              ? entry.r.toFixed(config.decimals)
                              : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-[11px] text-[#52606D] leading-relaxed">
            <span className="italic font-serif font-medium text-[#17202A]">Notes:</span>{' '}
            {config.sampleScope === 'cleaned'
              ? `Cleaned sample (N = ${impact.afterExactDuplicatesN.toLocaleString('en-US')}).`
              : `Raw imported dataset (N = ${dataset.rowCount.toLocaleString('en-US')}).`}{' '}
            {describePanelForSample(
              config.sampleScope === 'cleaned' ? impact.cleanedPanel : dataset.panel
            )}{' '}
            {config.tableType === 'correlation' &&
              `Pairwise N range: ${activeCorrelation.minPairwiseN.toLocaleString('en-US')}–${activeCorrelation.maxPairwiseN.toLocaleString('en-US')}.`}
          </p>
        </section>

        {/* Syntax-Highlighted LaTeX Code */}
        <SyntaxCodeBlock
          code={latexCode}
          language="latex"
          fileName={texFileName}
          title={texFileName}
          subtitle={`Requires ${requiredPackagesText}`}
          copied={copiedKey === 'latex'}
          onCopy={() => onCopyCode(latexCode, 'latex')}
          onDownload={() => onDownloadCode(latexCode, texFileName)}
        />
      </div>
    </div>
  );
};
