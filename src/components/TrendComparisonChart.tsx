import React, { useMemo, useState } from 'react';
import type {
  ColumnProfile,
  DatasetState,
  RawRow,
  SeriesAggregation,
  TimeCadence,
} from '../types/econometrics';
import { parseStrictNumeric } from '../lib/parser';
import { formatNum } from '../lib/statistics';

interface TrendComparisonChartProps {
  dataset: DatasetState;
  rows: RawRow[];
  sampleLabel: string;
  selectedVar: string;
  selectedVarLabel: string;
}

interface PeriodKey {
  canonical: string;
  slotIndex: number;
  display: string;
}

function parsePeriodToSlot(raw: string, cadence: TimeCadence): PeriodKey | null {
  const s = raw.trim();
  if (!s) return null;

  if (cadence === 'annual') {
    const m = /^(\d{4})$/.exec(s);
    if (m) {
      const y = Number(m[1]);
      return { canonical: String(y), slotIndex: y, display: String(y) };
    }
    const iso = /^(\d{4})-\d{2}-\d{2}/.exec(s);
    if (iso) {
      const y = Number(iso[1]);
      return { canonical: String(y), slotIndex: y, display: String(y) };
    }
    const num = Number(s);
    if (Number.isInteger(num) && num >= 1800 && num <= 2150) {
      return { canonical: String(num), slotIndex: num, display: String(num) };
    }
    return null;
  }

  if (cadence === 'quarterly') {
    const qm = /^(\d{4})[-/\s]?[Qq]([1-4])$/.exec(s);
    if (qm) {
      const y = Number(qm[1]);
      const q = Number(qm[2]);
      return { canonical: `${y}Q${q}`, slotIndex: y * 4 + (q - 1), display: `${y}Q${q}` };
    }
    const iso = /^(\d{4})-(\d{2})-\d{2}/.exec(s);
    if (iso) {
      const y = Number(iso[1]);
      const mo = Number(iso[2]);
      const q = Math.floor((mo - 1) / 3) + 1;
      return { canonical: `${y}Q${q}`, slotIndex: y * 4 + (q - 1), display: `${y}Q${q}` };
    }
    return null;
  }

  if (cadence === 'monthly') {
    const mm = /^(\d{4})[-/mM](\d{1,2})(?:-\d{2})?$/.exec(s);
    if (mm) {
      const y = Number(mm[1]);
      const mo = Number(mm[2]);
      if (mo >= 1 && mo <= 12) {
        const label = `${y}-${String(mo).padStart(2, '0')}`;
        return { canonical: label, slotIndex: y * 12 + (mo - 1), display: label };
      }
    }
    return null;
  }

  if (cadence === 'daily') {
    const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (dm) {
      const y = Number(dm[1]);
      const mo = Number(dm[2]);
      const d = Number(dm[3]);
      const utcMs = Date.UTC(y, mo - 1, d);
      const dayIdx = Math.floor(utcMs / 86_400_000);
      const label = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return { canonical: label, slotIndex: dayIdx, display: label };
    }
    return null;
  }

  return null;
}

function slotToLabel(slot: number, cadence: TimeCadence): string {
  if (cadence === 'annual') return String(slot);
  if (cadence === 'quarterly') {
    const y = Math.floor(slot / 4);
    const q = (slot % 4) + 1;
    return `${y}Q${q}`;
  }
  if (cadence === 'monthly') {
    const y = Math.floor(slot / 12);
    const mo = (slot % 12) + 1;
    return `${y}-${String(mo).padStart(2, '0')}`;
  }
  if (cadence === 'daily') {
    const dt = new Date(slot * 86_400_000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }
  return String(slot);
}

function medianOf(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export const TrendComparisonChart: React.FC<TrendComparisonChartProps> = ({
  dataset,
  rows,
  sampleLabel,
  selectedVar,
  selectedVarLabel,
}) => {
  // Determine confirmed time column (either confirmed panel timeVar or any column with confirmedTimeCadence !== 'none')
  const confirmedTimeColumns = useMemo(() => {
    const list: ColumnProfile[] = [];
    const seen = new Set<string>();
    if (dataset.panel.timeVar) {
      const col = dataset.columns.find((c) => c.stataName === dataset.panel.timeVar);
      if (col && (col.confirmedTimeCadence !== 'none' || col.inferredTimeCadence !== 'none')) {
        list.push(col);
        seen.add(col.stataName);
      }
    }
    for (const c of dataset.columns) {
      if (!seen.has(c.stataName) && c.confirmedTimeCadence !== 'none') {
        list.push(c);
        seen.add(c.stataName);
      }
    }
    return list;
  }, [dataset.columns, dataset.panel.timeVar]);

  const categoricalCols = useMemo(
    () =>
      dataset.columns.filter(
        (c) =>
          c.type === 'categorical' &&
          !c.isConstant &&
          !c.isAllMissing &&
          c.uniqueCount >= 2 &&
          c.uniqueCount <= 20
      ),
    [dataset.columns]
  );

  const [selectedTimeVar, setSelectedTimeVar] = useState<string>(
    confirmedTimeColumns[0]?.stataName ?? ''
  );
  const [aggregation, setAggregation] = useState<SeriesAggregation>('none');
  const [selectedEntity, setSelectedEntity] = useState<string>('');
  const [selectedGroupVar, setSelectedGroupVar] = useState<string>(
    categoricalCols[0]?.stataName ?? ''
  );
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  const activeTimeCol = useMemo(() => {
    if (confirmedTimeColumns.length === 0) return null;
    return (
      confirmedTimeColumns.find((c) => c.stataName === selectedTimeVar) ??
      confirmedTimeColumns[0]
    );
  }, [confirmedTimeColumns, selectedTimeVar]);

  const activeCadence: TimeCadence = useMemo(() => {
    if (!activeTimeCol) return 'none';
    if (activeTimeCol.confirmedTimeCadence !== 'none') return activeTimeCol.confirmedTimeCadence;
    if (activeTimeCol.inferredTimeCadence !== 'none') return activeTimeCol.inferredTimeCadence;
    return 'annual';
  }, [activeTimeCol]);

  const entityVar = dataset.panel.entityVar ?? dataset.panel.candidateEntityVar;
  const entityOptions = useMemo(() => {
    if (!entityVar) return [];
    const set = new Set<string>();
    for (const r of rows) {
      const v = (r[entityVar] ?? '').trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows, entityVar]);

  const activeEntity =
    selectedEntity && entityOptions.includes(selectedEntity)
      ? selectedEntity
      : entityOptions[0] ?? '';

  const activeGroupCol = useMemo(() => {
    if (categoricalCols.length === 0) return null;
    return (
      categoricalCols.find((c) => c.stataName === selectedGroupVar) ??
      categoricalCols[0]
    );
  }, [categoricalCols, selectedGroupVar]);

  // --- TIME-SERIES COMPUTATION (when a confirmed period column exists) ---
  const timeSeriesData = useMemo(() => {
    if (!activeTimeCol || activeCadence === 'none') return null;

    const buckets = new Map<number, { label: string; values: number[] }>();
    let totalObs = 0;

    for (const row of rows) {
      if (aggregation === 'entity' && entityVar) {
        if ((row[entityVar] ?? '').trim() !== activeEntity) continue;
      }
      const pKey = parsePeriodToSlot(row[activeTimeCol.stataName] ?? '', activeCadence);
      const val = parseStrictNumeric(row[selectedVar] ?? '');
      if (!pKey || val === null) continue;
      totalObs++;
      const existing = buckets.get(pKey.slotIndex);
      if (existing) {
        existing.values.push(val);
      } else {
        buckets.set(pKey.slotIndex, { label: pKey.display, values: [val] });
      }
    }

    // Check raw multi-record-per-period count BEFORE entity filtering
    const rawPeriodCounts = new Map<number, number>();
    let maxRecordsPerPeriod = 0;
    let periodsWithMultiple = 0;
    for (const row of rows) {
      const pKey = parsePeriodToSlot(row[activeTimeCol.stataName] ?? '', activeCadence);
      const val = parseStrictNumeric(row[selectedVar] ?? '');
      if (!pKey || val === null) continue;
      const nextCount = (rawPeriodCounts.get(pKey.slotIndex) ?? 0) + 1;
      rawPeriodCounts.set(pKey.slotIndex, nextCount);
      if (nextCount > maxRecordsPerPeriod) maxRecordsPerPeriod = nextCount;
    }
    for (const c of rawPeriodCounts.values()) {
      if (c > 1) periodsWithMultiple++;
    }

    const needsExplicitAggregation = maxRecordsPerPeriod > 1;
    const isBlockedByAggregation = needsExplicitAggregation && aggregation === 'none';

    const slots = Array.from(buckets.keys()).sort((a, b) => a - b);
    if (slots.length === 0) {
      return {
        needsExplicitAggregation,
        isBlockedByAggregation,
        maxRecordsPerPeriod,
        periodsWithMultiple,
        totalObs,
        timeline: [] as Array<{
          slot: number;
          label: string;
          value: number | null;
          count: number;
          isGap: boolean;
        }>,
        gapCount: 0,
      };
    }

    const minSlot = slots[0];
    const maxSlot = slots[slots.length - 1];
    const span = maxSlot - minSlot + 1;

    // Preserve explicit gaps for missing periods up to 240 slots; for wider daily spans, insert gap markers where diff > 1
    const timeline: Array<{
      slot: number;
      label: string;
      value: number | null;
      count: number;
      isGap: boolean;
    }> = [];
    let gapCount = 0;

    if (span <= 240) {
      for (let s = minSlot; s <= maxSlot; s++) {
        const b = buckets.get(s);
        if (!b || b.values.length === 0) {
          gapCount++;
          timeline.push({
            slot: s,
            label: slotToLabel(s, activeCadence),
            value: null,
            count: 0,
            isGap: true,
          });
        } else {
          let aggVal = b.values[0];
          if (aggregation === 'mean') {
            aggVal = b.values.reduce((acc, x) => acc + x, 0) / b.values.length;
          } else if (aggregation === 'median') {
            aggVal = medianOf(b.values);
          } else if (aggregation === 'sum') {
            aggVal = b.values.reduce((acc, x) => acc + x, 0);
          } else if (aggregation === 'entity') {
            aggVal = b.values.reduce((acc, x) => acc + x, 0) / b.values.length;
          }
          timeline.push({
            slot: s,
            label: b.label,
            value: aggVal,
            count: b.values.length,
            isGap: false,
          });
        }
      }
    } else {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (i > 0 && s - slots[i - 1] > 1) {
          gapCount += s - slots[i - 1] - 1;
          timeline.push({
            slot: slots[i - 1] + 1,
            label: slotToLabel(slots[i - 1] + 1, activeCadence),
            value: null,
            count: 0,
            isGap: true,
          });
        }
        const b = buckets.get(s)!;
        let aggVal = b.values[0];
        if (aggregation === 'mean' || aggregation === 'entity') {
          aggVal = b.values.reduce((acc, x) => acc + x, 0) / b.values.length;
        } else if (aggregation === 'median') {
          aggVal = medianOf(b.values);
        } else if (aggregation === 'sum') {
          aggVal = b.values.reduce((acc, x) => acc + x, 0);
        }
        timeline.push({
          slot: s,
          label: b.label,
          value: aggVal,
          count: b.values.length,
          isGap: false,
        });
      }
    }

    return {
      needsExplicitAggregation,
      isBlockedByAggregation,
      maxRecordsPerPeriod,
      periodsWithMultiple,
      totalObs,
      timeline,
      gapCount,
    };
  }, [activeTimeCol, activeCadence, rows, selectedVar, aggregation, entityVar, activeEntity]);

  // --- GROUP COMPARISON COMPUTATION (for cross-sections) ---
  const groupStats = useMemo(() => {
    if (activeTimeCol || !activeGroupCol) return [];
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const g = (row[activeGroupCol.stataName] ?? '').trim();
      const v = parseStrictNumeric(row[selectedVar] ?? '');
      if (!g || v === null) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(v);
    }
    return Array.from(groups.entries())
      .map(([group, vals]) => {
        const sorted = [...vals].sort((a, b) => a - b);
        const mean = vals.reduce((acc, x) => acc + x, 0) / vals.length;
        return {
          group,
          n: vals.length,
          mean,
          q1: quantileOf(sorted, 0.25),
          median: quantileOf(sorted, 0.5),
          q3: quantileOf(sorted, 0.75),
          min: sorted[0],
          max: sorted[sorted.length - 1],
        };
      })
      .sort((a, b) => b.mean - a.mean)
      .slice(0, 12);
  }, [activeTimeCol, activeGroupCol, rows, selectedVar]);

  // --- RENDER TIME-SERIES VIEW ---
  if (activeTimeCol && timeSeriesData) {
    const validPoints = timeSeriesData.timeline.filter((p) => p.value !== null);
    const minVal = validPoints.length > 0 ? Math.min(...validPoints.map((p) => p.value!)) : 0;
    const maxVal = validPoints.length > 0 ? Math.max(...validPoints.map((p) => p.value!)) : 1;
    const ySpan = maxVal === minVal ? Math.max(1, Math.abs(minVal) * 0.1) : maxVal - minVal;
    const yMin = minVal - ySpan * 0.08;
    const yMax = maxVal + ySpan * 0.08;

    const width = 620;
    const height = 200;
    const padLeft = 56;
    const padRight = 24;
    const padTop = 18;
    const padBottom = 34;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const tl = timeSeriesData.timeline;
    const minSlot = tl.length > 0 ? tl[0].slot : 0;
    const maxSlot = tl.length > 0 ? tl[tl.length - 1].slot : 1;
    const slotSpan = Math.max(1, maxSlot - minSlot);

    const scaleX = (slot: number) => padLeft + ((slot - minSlot) / slotSpan) * plotW;
    const scaleY = (v: number) => padTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // Split into contiguous polyline segments so gaps break the line visibly
    const segments: Array<Array<{ x: number; y: number }>> = [];
    let currentSeg: Array<{ x: number; y: number }> = [];
    for (const pt of tl) {
      if (pt.value === null) {
        if (currentSeg.length > 0) {
          segments.push(currentSeg);
          currentSeg = [];
        }
      } else {
        currentSeg.push({ x: scaleX(pt.slot), y: scaleY(pt.value) });
      }
    }
    if (currentSeg.length > 0) segments.push(currentSeg);

    const tickIndices =
      tl.length <= 6
        ? tl.map((_, idx) => idx)
        : [0, Math.floor(tl.length * 0.25), Math.floor(tl.length * 0.5), Math.floor(tl.length * 0.75), tl.length - 1];

    const hoveredPoint =
      hoveredSlot !== null ? tl.find((p) => p.slot === hoveredSlot) ?? null : null;

    return (
      <div className="bg-white border border-[#E5E0D6] rounded-md p-5 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#E5E0D6]">
          <div>
            <h4 className="font-serif text-base font-semibold text-[#17202A]">
              Period Series · {selectedVarLabel}
            </h4>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#52606D] mt-0.5 font-mono tabular-nums">
              <span>{sampleLabel}</span>
              <span aria-hidden="true">·</span>
              <span>
                Period: {activeTimeCol.stataName} ({activeCadence})
              </span>
              {timeSeriesData.gapCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#B45309]">
                    {timeSeriesData.gapCount} missing period gap(s) preserved
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {confirmedTimeColumns.length > 1 && (
              <select
                aria-label="Select time variable for series"
                value={activeTimeCol.stataName}
                onChange={(e) => setSelectedTimeVar(e.target.value)}
                className="px-2 py-1 font-mono text-xs bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                {confirmedTimeColumns.map((c) => (
                  <option key={c.stataName} value={c.stataName}>
                    {c.stataName} ({c.confirmedTimeCadence})
                  </option>
                ))}
              </select>
            )}

            {timeSeriesData.needsExplicitAggregation && (
              <select
                aria-label="Select period aggregation"
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value as SeriesAggregation)}
                className="px-2.5 py-1 text-xs font-medium bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <option value="none">Choose aggregation…</option>
                <option value="mean">Mean per period</option>
                <option value="median">Median per period</option>
                <option value="sum">Sum per period</option>
                {entityVar && entityOptions.length > 0 && (
                  <option value="entity">Single {entityVar}</option>
                )}
              </select>
            )}

            {aggregation === 'entity' && entityVar && entityOptions.length > 0 && (
              <select
                aria-label={`Filter single ${entityVar}`}
                value={activeEntity}
                onChange={(e) => setSelectedEntity(e.target.value)}
                className="px-2.5 py-1 text-xs font-mono bg-white border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                {entityOptions.map((ent) => (
                  <option key={ent} value={ent}>
                    {ent}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {timeSeriesData.isBlockedByAggregation ? (
          <div className="p-5 rounded border border-[#E5E0D6] bg-[#FAF8F4] space-y-3">
            <div className="text-xs text-[#17202A] leading-relaxed">
              <strong>Multiple observations share the same period:</strong> up to{' '}
              <span className="font-mono font-semibold">{timeSeriesData.maxRecordsPerPeriod}</span>{' '}
              records appear in a single <code className="font-mono">{activeTimeCol.stataName}</code>{' '}
              slot across {timeSeriesData.periodsWithMultiple} period(s). Choose how to aggregate or
              select a single entity before plotting a single line:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'mean', label: 'Plot Period Mean' },
                  { id: 'median', label: 'Plot Period Median' },
                  { id: 'sum', label: 'Plot Period Sum' },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setAggregation(btn.id)}
                  className="px-3 py-1.5 text-xs font-medium text-[#1B365D] bg-white border border-[#CFC7B8] rounded hover:border-[#1B365D] transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
                >
                  {btn.label}
                </button>
              ))}
              {entityVar && entityOptions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAggregation('entity')}
                  className="px-3 py-1.5 text-xs font-medium text-[#1B365D] bg-white border border-[#CFC7B8] rounded hover:border-[#1B365D] transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
                >
                  Plot Single {entityVar}
                </button>
              )}
            </div>
          </div>
        ) : validPoints.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#52606D]">
            No parseable {activeCadence} periods with non-missing <code className="font-mono">{selectedVar}</code>.
          </div>
        ) : (
          <>
            <div className="h-5 flex items-center justify-between text-xs font-mono tabular-nums text-[#52606D]">
              {hoveredPoint ? (
                hoveredPoint.isGap ? (
                  <span className="text-[#B45309]">
                    {hoveredPoint.label}: Missing period (gap preserved)
                  </span>
                ) : (
                  <span>
                    {hoveredPoint.label}:{' '}
                    <strong className="text-[#17202A]">
                      {formatNum(hoveredPoint.value!, 2)}
                    </strong>{' '}
                    ({hoveredPoint.count} obs)
                  </span>
                )
              ) : (
                <span className="text-[#7B8794]">
                  {aggregation === 'entity'
                    ? `Entity: ${activeEntity}`
                    : aggregation !== 'none'
                      ? `Aggregated (${aggregation}) across observations per ${activeCadence} period`
                      : `One observation per ${activeCadence} period`}
                </span>
              )}
              <span>
                {validPoints.length} observed period(s)
              </span>
            </div>

            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto block select-none"
              role="img"
              aria-label={`Period time series for ${selectedVarLabel} by ${activeTimeCol.stataName}`}
            >
              {[0, 0.5, 1].map((frac) => {
                const y = padTop + plotH * (1 - frac);
                const yVal = yMin + (yMax - yMin) * frac;
                return (
                  <g key={frac}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke="#EFECE6"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-[#7B8794] text-[10px] font-mono"
                    >
                      {formatNum(yVal, Math.abs(yMax) >= 100 ? 0 : 2)}
                    </text>
                  </g>
                );
              })}

              {/* Gap vertical indicators */}
              {tl
                .filter((p) => p.isGap)
                .map((p) => (
                  <line
                    key={`gap-${p.slot}`}
                    x1={scaleX(p.slot)}
                    y1={padTop}
                    x2={scaleX(p.slot)}
                    y2={padTop + plotH}
                    stroke="#FDE68A"
                    strokeWidth="2"
                    strokeDasharray="2 3"
                  />
                ))}

              {/* Broken segments across gaps */}
              {segments.map((seg, idx) =>
                seg.length > 1 ? (
                  <polyline
                    key={idx}
                    fill="none"
                    stroke="#1B365D"
                    strokeWidth="1.8"
                    points={seg.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                  />
                ) : null
              )}

              {/* Observed points */}
              {tl.map((pt) =>
                pt.value !== null ? (
                  <circle
                    key={pt.slot}
                    cx={scaleX(pt.slot)}
                    cy={scaleY(pt.value)}
                    r={hoveredSlot === pt.slot ? 4.5 : 3}
                    fill="#1B365D"
                    stroke="#FFFFFF"
                    strokeWidth="1"
                    className="cursor-pointer transition-all motion-reduce:transition-none"
                    onMouseEnter={() => setHoveredSlot(pt.slot)}
                    onMouseLeave={() => setHoveredSlot(null)}
                  />
                ) : (
                  <rect
                    key={pt.slot}
                    x={scaleX(pt.slot) - 4}
                    y={padTop}
                    width={8}
                    height={plotH}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredSlot(pt.slot)}
                    onMouseLeave={() => setHoveredSlot(null)}
                  />
                )
              )}

              {/* X baseline & period labels */}
              <line
                x1={padLeft}
                y1={padTop + plotH}
                x2={width - padRight}
                y2={padTop + plotH}
                stroke="#CFC7B8"
                strokeWidth="1"
              />
              {tickIndices.map((idx, i) => {
                const pt = tl[idx];
                if (!pt) return null;
                return (
                  <text
                    key={`${pt.slot}-${i}`}
                    x={scaleX(pt.slot)}
                    y={padTop + plotH + 16}
                    textAnchor={
                      i === 0 ? 'start' : i === tickIndices.length - 1 ? 'end' : 'middle'
                    }
                    className="fill-[#52606D] text-[10px] font-mono"
                  >
                    {pt.label}
                  </text>
                );
              })}
            </svg>
          </>
        )}
      </div>
    );
  }

  // --- RENDER CROSS-SECTIONAL GROUP COMPARISON ---
  if (activeGroupCol && groupStats.length >= 2) {
    const minVal = Math.min(...groupStats.map((g) => g.q1));
    const maxVal = Math.max(...groupStats.map((g) => g.q3));
    const span = maxVal === minVal ? 1 : maxVal - minVal;
    const domMin = minVal - span * 0.1;
    const domMax = maxVal + span * 0.1;

    return (
      <div className="bg-white border border-[#E5E0D6] rounded-md p-5 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#E5E0D6]">
          <div>
            <h4 className="font-serif text-base font-semibold text-[#17202A]">
              Cross-Section Group Comparison · {selectedVarLabel}
            </h4>
            <div className="text-xs text-[#52606D] mt-0.5 font-mono">
              {sampleLabel} · Grouped by {activeGroupCol.stataName} (IQR bar &amp; amber mean marker)
            </div>
          </div>
          {categoricalCols.length > 1 && (
            <select
              aria-label="Group comparison categorical variable"
              value={activeGroupCol.stataName}
              onChange={(e) => setSelectedGroupVar(e.target.value)}
              className="px-2.5 py-1 text-xs font-mono bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            >
              {categoricalCols.map((c) => (
                <option key={c.stataName} value={c.stataName}>
                  {c.stataName} ({c.uniqueCount} groups)
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2.5">
          {groupStats.map((g) => {
            const leftPct = ((g.q1 - domMin) / (domMax - domMin)) * 100;
            const widthPct = Math.max(1.5, ((g.q3 - g.q1) / (domMax - domMin)) * 100);
            const medPct = ((g.median - domMin) / (domMax - domMin)) * 100;
            const meanPct = ((g.mean - domMin) / (domMax - domMin)) * 100;
            return (
              <div key={g.group} className="grid grid-cols-12 items-center gap-3 text-xs">
                <div className="col-span-3 truncate font-medium text-[#17202A]" title={g.group}>
                  {g.group}{' '}
                  <span className="font-mono text-[11px] text-[#7B8794]">(n={g.n})</span>
                </div>
                <div className="col-span-6 relative h-5 flex items-center">
                  <div className="w-full h-px bg-[#E5E0D6]" />
                  <div
                    className="absolute h-3 bg-[#1B365D]/15 border border-[#1B365D] rounded-xs transition-all motion-reduce:transition-none"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  />
                  <div
                    className="absolute w-0.5 h-3.5 bg-[#1B365D]"
                    style={{ left: `${medPct}%` }}
                  />
                  <div
                    className="absolute w-2 h-2 bg-[#B45309] rotate-45 -translate-x-1"
                    style={{ left: `${meanPct}%` }}
                  />
                </div>
                <div className="col-span-3 text-right font-mono tabular-nums text-[11px] text-[#52606D]">
                  {formatNum(g.mean, 2)} <span className="text-[#9CA3AF]">({formatNum(g.median, 2)})</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
};
