import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Search,
} from 'lucide-react';
import type { DatasetState, TimeCadence } from '../types/econometrics';
import {
  describeKeyValidityIssues,
  formatPanelStatusHeadline,
} from '../lib/panelStatus';

interface InspectorViewProps {
  dataset: DatasetState;
  onUpdateColumnLabel: (stataName: string, newLabel: string) => void;
  onUpdatePanelKeys: (entityVar: string | null, timeVar: string | null, confirmed: boolean) => void;
  onUpdateTimeCadence: (stataName: string, cadence: TimeCadence) => void;
}

export const InspectorView: React.FC<InspectorViewProps> = ({
  dataset,
  onUpdateColumnLabel,
  onUpdatePanelKeys,
  onUpdateTimeCadence,
}) => {
  const [schemaSearch, setSchemaSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const renamedColumns = useMemo(
    () => dataset.columns.filter((c) => c.wasRenamed),
    [dataset.columns]
  );

  const leadingZeroColumns = useMemo(
    () => dataset.columns.filter((c) => c.preserveLeadingZeros),
    [dataset.columns]
  );

  const filteredColumns = useMemo(() => {
    const q = schemaSearch.trim().toLowerCase();
    if (!q) return dataset.columns;
    return dataset.columns.filter(
      (c) =>
        c.stataName.toLowerCase().includes(q) ||
        c.rawName.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q)
    );
  }, [dataset.columns, schemaSearch]);

  const sortedRows = useMemo(() => {
    if (!sortCol) return dataset.rows;
    const colMeta = dataset.columns.find((c) => c.stataName === sortCol);
    const isNum = colMeta?.type === 'numeric';

    return [...dataset.rows].sort((a, b) => {
      const av = a[sortCol] ?? '';
      const bv = b[sortCol] ?? '';
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      if (isNum) {
        const na = Number(av.replace(/,/g, ''));
        const nb = Number(bv.replace(/,/g, ''));
        return sortDir === 'asc' ? na - nb : nb - na;
      }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [dataset.rows, dataset.columns, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, safePage, pageSize]);

  const handleSort = (stataName: string) => {
    if (sortCol === stataName) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(stataName);
      setSortDir('asc');
    }
    setPage(1);
  };

  const { panel } = dataset;

  const structureStatusText = formatPanelStatusHeadline(panel, 'raw rows');

  const structureStatusColor = panel.isPanel
    ? panel.panelKeyStatus !== 'valid'
      ? 'text-[#B45309] font-medium'
      : panel.balanceStatus === 'strongly_balanced'
        ? 'text-[#166534] font-medium'
        : 'text-[#1B365D] font-medium'
    : 'text-[#52606D] font-medium';

  const hasKeyAuditDetails =
    panel.duplicateKeyPairs > 0 ||
    panel.missingKeyRows > 0 ||
    panel.exactDuplicateRows > 0 ||
    panel.distinctKeyConflictRows > 0;

  return (
    <div className="space-y-8">
      {/* Observation Unit, Panel Validation & Import Parity */}
      <section className="bg-white border border-[#E5E0D6] rounded-md p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#E5E0D6]">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#17202A]">
              Observation Unit, Panel Keys &amp; Import Parity
            </h2>
            <p className="text-xs text-[#52606D] mt-1 max-w-3xl leading-relaxed">
              {panel.detectionReason}
            </p>
          </div>
          <div className={`text-xs font-mono tabular-nums shrink-0 ${structureStatusColor}`}>
            {structureStatusText}
          </div>
        </div>

        {/* Excel precision / date-system conversion notices */}
        {dataset.conversionNotices.length > 0 && (
          <div className="mt-4 p-3.5 rounded border border-[#E5E0D6] bg-[#FAF8F4] space-y-1.5 text-xs text-[#17202A]">
            <div className="flex items-center gap-1.5 font-semibold text-[#1B365D]">
              <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Excel Typed-Value &amp; Date Conversion Notes</span>
            </div>
            <ul className="space-y-1 text-[#52606D] list-disc pl-5">
              {dataset.conversionNotices.map((notice, idx) => (
                <li key={idx}>{notice}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-4 items-end">
          <div className="md:col-span-4">
            <label htmlFor="entity-key-select" className="block text-xs font-medium text-[#52606D] mb-1.5">
              Panel Entity ID (i)
            </label>
            <select
              id="entity-key-select"
              value={panel.entityVar ?? ''}
              onChange={(e) =>
                onUpdatePanelKeys(e.target.value || null, panel.timeVar, true)
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            >
              <option value="">None (Cross-sectional / Dated cross-section)</option>
              {dataset.columns.map((c) => (
                <option key={c.stataName} value={c.stataName}>
                  {c.stataName} ({c.type}, {c.uniqueCount} unique)
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label htmlFor="time-key-select" className="block text-xs font-medium text-[#52606D] mb-1.5">
              Panel Time Index (t)
            </label>
            <select
              id="time-key-select"
              value={panel.timeVar ?? ''}
              onChange={(e) =>
                onUpdatePanelKeys(panel.entityVar, e.target.value || null, true)
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            >
              <option value="">None</option>
              {dataset.columns.map((c) => (
                <option key={c.stataName} value={c.stataName}>
                  {c.stataName} ({c.type}, {c.uniqueCount} unique)
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4 flex items-center justify-end gap-2">
            {panel.isPanel && !panel.userConfirmed ? (
              <button
                type="button"
                onClick={() => onUpdatePanelKeys(panel.entityVar, panel.timeVar, true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#1B365D] rounded hover:bg-[#132847] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] focus-visible:ring-offset-2"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Confirm Panel Keys</span>
              </button>
            ) : panel.isPanel && panel.panelKeyStatus === 'valid' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#166534]">
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  Keys confirmed &amp; valid on raw rows{panel.entityIsString ? ' (auto-encodes string ID)' : ''}
                </span>
              </span>
            ) : panel.isPanel ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B45309] text-right">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Keys confirmed, invalid on raw rows ({describeKeyValidityIssues(panel)})
                </span>
              </span>
            ) : (
              <span className="text-xs text-[#52606D]">
                OLS available without <code className="font-mono">xtset</code>
              </span>
            )}
          </div>
        </div>

        {/* Key Uniqueness Audit Breakdown */}
        {(hasKeyAuditDetails || leadingZeroColumns.length > 0 || renamedColumns.length > 0) && (
          <div className="mt-4 pt-4 border-t border-[#F0ECE4] space-y-2.5 text-xs">
            {hasKeyAuditDetails && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 py-2 px-3 rounded bg-[#FAF8F4] border border-[#E5E0D6] font-mono tabular-nums text-[11px]">
                <div>
                  <div className="font-sans text-[#52606D]">Missing-key rows</div>
                  <div className={panel.missingKeyRows > 0 ? 'text-[#991B1B] font-semibold mt-0.5' : 'text-[#17202A] font-semibold mt-0.5'}>
                    {panel.missingKeyRows}
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[#52606D]">Repeated key groups</div>
                  <div className={panel.repeatedKeyGroups > 0 ? 'text-[#B45309] font-semibold mt-0.5' : 'text-[#17202A] font-semibold mt-0.5'}>
                    {panel.repeatedKeyGroups}
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[#52606D]">Excess key rows</div>
                  <div className={panel.duplicateKeyPairs > 0 ? 'text-[#B45309] font-semibold mt-0.5' : 'text-[#17202A] font-semibold mt-0.5'}>
                    {panel.duplicateKeyPairs}
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[#52606D]">Exact duplicate rows</div>
                  <div className={panel.exactDuplicateRows > 0 ? 'text-[#B45309] font-semibold mt-0.5' : 'text-[#166534] font-semibold mt-0.5'}>
                    {panel.exactDuplicateRows}
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[#52606D]">Distinct key conflicts</div>
                  <div className={panel.distinctKeyConflictRows > 0 ? 'text-[#991B1B] font-semibold mt-0.5' : 'text-[#166534] font-semibold mt-0.5'}>
                    {panel.distinctKeyConflictRows}
                  </div>
                </div>
              </div>
            )}

            {panel.distinctKeyConflictRows > 0 && (
              <div className="flex items-start gap-2 text-[#991B1B]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <strong>Distinct Records Share Candidate Keys:</strong>{' '}
                  {panel.distinctKeyConflictRows} excess row(s) across {panel.repeatedKeyGroups} group(s) on{' '}
                  <code className="font-mono">
                    ({panel.entityVar ?? panel.candidateEntityVar}, {panel.timeVar ?? panel.candidateTimeVar})
                  </code>{' '}
                  are distinct records rather than exact duplicates
                  {panel.uniqueRecordIdVar
                    ? ` (unique record identifier detected: ${panel.uniqueRecordIdVar})`
                    : ''}
                  . <code className="font-mono">xtset</code> is guarded until unique panel keys are confirmed; OLS remains exportable.
                </span>
              </div>
            )}

            {panel.duplicateKeyPairs > 0 && panel.distinctKeyConflictRows === 0 && (
              <div className="flex items-start gap-2 text-[#B45309]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <strong>Exact Duplicates Behind Repeated Keys:</strong> All {panel.duplicateKeyPairs} excess row(s) on{' '}
                  <code className="font-mono">({panel.entityVar}, {panel.timeVar})</code> are exact full-row duplicates. Enabling{' '}
                  <code className="font-mono">duplicates drop</code> restores a unique panel key.
                </span>
              </div>
            )}

            {panel.missingKeyRows > 0 && (
              <div className="flex items-start gap-2 text-[#991B1B]">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <strong>Missing Panel Identifiers:</strong> {panel.missingKeyRows} row(s) missing entity or time key ({panel.missingEntityRows} missing entity, {panel.missingTimeRows} missing time).
                </span>
              </div>
            )}

            {leadingZeroColumns.length > 0 && (
              <div className="text-[#52606D]">
                <strong className="text-[#17202A]">Leading-Zero Parity:</strong>{' '}
                <span className="font-mono">
                  {leadingZeroColumns.map((c) => c.stataName).join(', ')}
                </span>{' '}
                preserved as zero-padded text strings in both Normalized CSV Bundle and Original Source Stata scripts.
              </div>
            )}

            {renamedColumns.length > 0 && (
              <div className="text-[#52606D]">
                <strong className="text-[#17202A]">Stata Header Mapping:</strong>{' '}
                {renamedColumns.map((c, idx) => (
                  <span key={c.stataName} className="font-mono">
                    {idx > 0 ? ', ' : ''}
                    &quot;{c.rawName}&quot; → {c.stataName}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Variable Schema, Roles, Time Cadence & Single-Source Label Editor */}
      <section className="bg-white border border-[#E5E0D6] rounded-md overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-[#E5E0D6] bg-[#FAF8F4]">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#17202A]">
              Variable Schema, Roles &amp; Publication Labels
            </h2>
            <p className="text-xs text-[#52606D] mt-0.5">
              Edit labels once for Stata &amp; LaTeX. Confirm daily/monthly/quarterly time cadences to emit Stata <code className="font-mono">%td</code>/<code className="font-mono">%tm</code>/<code className="font-mono">%tq</code> formats.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#7B8794] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              type="text"
              value={schemaSearch}
              onChange={(e) => setSchemaSearch(e.target.value)}
              placeholder="Filter variables..."
              aria-label="Filter variables in schema"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-[#CFC7B8] rounded text-[#17202A] placeholder:text-[#7B8794] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#CFC7B8] text-[11px] font-semibold text-[#52606D] bg-white">
                <th className="py-2.5 px-4">Stata Variable</th>
                <th className="py-2.5 px-4">Publication Label (Editable)</th>
                <th className="py-2.5 px-4">Type &amp; Role</th>
                <th className="py-2.5 px-4">Time Cadence</th>
                <th className="py-2.5 px-4 text-right">Non-Missing</th>
                <th className="py-2.5 px-4 text-right">Missing %</th>
                <th className="py-2.5 px-4 text-right">Unique</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0ECE4] text-xs">
              {filteredColumns.map((col) => {
                const showCadenceControl =
                  col.type === 'date' ||
                  col.role === 'time' ||
                  col.inferredTimeCadence !== 'none' ||
                  col.confirmedTimeCadence !== 'none';

                return (
                  <tr key={col.stataName} className="hover:bg-[#FAF8F4] transition-colors">
                    <td className="py-2.5 px-4 font-mono font-medium text-[#17202A] whitespace-nowrap">
                      <div>{col.stataName}</div>
                      {col.wasRenamed && (
                        <div className="text-[11px] font-normal text-[#7B8794]">
                          raw: {col.rawName}
                        </div>
                      )}
                      {col.excelPrecisionDiffCount > 0 && col.excelPrecisionExample && (
                        <div className="text-[10.5px] font-sans font-normal text-[#1B365D]">
                          Full precision: {col.excelPrecisionExample}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-4 min-w-[210px]">
                      <input
                        type="text"
                        value={col.label}
                        onChange={(e) => onUpdateColumnLabel(col.stataName, e.target.value)}
                        aria-label={`Label for ${col.stataName}`}
                        className="w-full px-2 py-1 text-xs bg-transparent border border-transparent hover:border-[#CFC7B8] focus:bg-white focus:border-[#1B365D] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1B365D] rounded text-[#17202A]"
                      />
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap text-[#52606D]">
                      <div>
                        <span className="capitalize font-medium text-[#17202A]">{col.type}</span>
                        <span className="text-[#7B8794]"> · </span>
                        <span className="capitalize text-[#52606D]">{col.role}</span>
                      </div>
                      <div className="text-[11px] mt-0.5 space-x-1.5">
                        {col.preserveLeadingZeros && (
                          <span className="text-[#1B365D]">
                            leading-0 ID{col.zeroPadWidth ? ` (${'0'.repeat(col.zeroPadWidth)})` : ''}
                          </span>
                        )}
                        {col.preserveLongId && (
                          <span className="text-[#1B365D]">long text ID (15+ digits)</span>
                        )}
                        {col.isAllMissing && (
                          <span className="text-[#991B1B] font-medium">All-missing</span>
                        )}
                        {!col.isAllMissing && col.isConstant && (
                          <span className="text-[#B45309] font-medium">Constant (0 variance)</span>
                        )}
                        {col.type === 'numeric' && !col.isAllMissing && col.nonPositiveCount > 0 && (
                          <span className="text-[#B45309]">{col.nonPositiveCount} ≤ 0</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {showCadenceControl ? (
                        <select
                          aria-label={`Confirm time cadence for ${col.stataName}`}
                          value={col.confirmedTimeCadence}
                          onChange={(e) =>
                            onUpdateTimeCadence(col.stataName, e.target.value as TimeCadence)
                          }
                          className="px-2 py-1 text-[11px] font-mono bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
                        >
                          <option value="none">Unconfirmed</option>
                          <option value="annual">Annual (YYYY)</option>
                          <option value="quarterly">Quarterly (%tq)</option>
                          <option value="monthly">Monthly (%tm)</option>
                          <option value="daily">Daily (%td)</option>
                        </select>
                      ) : (
                        <span className="text-[#9CA3AF] font-mono text-[11px]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#17202A]">
                      {col.nonMissing.toLocaleString('en-US')}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      <span className={col.missingPct > 0 ? 'text-[#B45309] font-medium' : 'text-[#52606D]'}>
                        {col.missingPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#52606D]">
                      {col.uniqueCount.toLocaleString('en-US')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Paginated Observation Preview Grid */}
      <section className="bg-white border border-[#E5E0D6] rounded-md overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-[#E5E0D6] bg-[#FAF8F4]">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#17202A]">
              Observation Preview
            </h2>
            <p className="text-xs text-[#52606D] mt-0.5 font-mono tabular-nums">
              Showing {((safePage - 1) * pageSize + 1).toLocaleString('en-US')}–
              {Math.min(safePage * pageSize, sortedRows.length).toLocaleString('en-US')} of{' '}
              {sortedRows.length.toLocaleString('en-US')} rows · Missing tokens parsed as empty:{' '}
              {dataset.missingTokens.join(', ')}
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 text-[#52606D]">
              <span>Rows</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="px-2 py-1 font-mono bg-white border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>

            <div className="flex items-center gap-1 font-mono tabular-nums">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
                className="p-1.5 border border-[#CFC7B8] bg-white rounded disabled:opacity-40 hover:bg-[#F4F1EA] cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className="px-2 text-[#52606D]">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
                className="p-1.5 border border-[#CFC7B8] bg-white rounded disabled:opacity-40 hover:bg-[#F4F1EA] cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#CFC7B8] bg-white text-[11px] font-mono text-[#52606D]">
                <th className="py-2.5 px-3 text-right text-[#7B8794] w-12">#</th>
                {dataset.columns.map((col) => (
                  <th
                    key={col.stataName}
                    className={`py-2.5 px-3 whitespace-nowrap ${
                      col.type === 'numeric' ? 'text-right' : 'text-left'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col.stataName)}
                      className="inline-flex items-center gap-1 hover:text-[#1B365D] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] rounded"
                    >
                      <span>{col.stataName}</span>
                      {sortCol === col.stataName &&
                        (sortDir === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-[#1B365D]" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-[#1B365D]" aria-hidden="true" />
                        ))}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0ECE4] text-xs">
              {pagedRows.map((row, idx) => {
                const rowNum = (safePage - 1) * pageSize + idx + 1;
                return (
                  <tr key={rowNum} className="hover:bg-[#FAF8F4] transition-colors">
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-[#9CA3AF]">
                      {rowNum}
                    </td>
                    {dataset.columns.map((col) => {
                      const val = row[col.stataName];
                      const isMissing = !val;
                      return (
                        <td
                          key={col.stataName}
                          className={`py-2 px-3 whitespace-nowrap ${
                            col.type === 'numeric' || col.preserveLeadingZeros
                              ? 'text-right font-mono tabular-nums'
                              : 'text-left'
                          } ${isMissing ? 'text-[#B45309]/70 font-mono italic' : 'text-[#17202A]'}`}
                        >
                          {isMissing ? '.' : val}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
