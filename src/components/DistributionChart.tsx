import React, { useState } from 'react';
import type { NumericSummary, OutlierMethod } from '../types/econometrics';
import { formatNum } from '../lib/statistics';

interface DistributionChartProps {
  summary: NumericSummary;
  outlierMethod: OutlierMethod;
  /** Optional shared domain across comparable samples (e.g., raw vs. cleaned) so axes never jump */
  fixedDomain?: {
    min: number;
    max: number;
    maxBinCount?: number;
  };
  sampleBadge?: string;
}

export const DistributionChart: React.FC<DistributionChartProps> = ({
  summary,
  outlierMethod,
  fixedDomain,
  sampleBadge,
}) => {
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);
  const [hoveredOutlier, setHoveredOutlier] = useState<number | null>(null);

  if (summary.n === 0 || summary.histogram.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-[#52606D] border border-[#E5E0D6] rounded bg-white">
        No non-missing numeric observations available for {summary.stataName}.
      </div>
    );
  }

  const width = 620;
  const histHeight = 165;
  const boxHeight = 68;
  const padLeft = 48;
  const padRight = 24;
  const padTop = 18;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = histHeight - padTop - padBottom;

  const { boxplot, histogram } = summary;
  const rawMin = fixedDomain ? fixedDomain.min : boxplot.min;
  const rawMax = fixedDomain ? fixedDomain.max : boxplot.max;
  const domainMin = rawMin;
  const domainMax = rawMax === rawMin ? rawMin + 1 : rawMax;
  const scaleX = (val: number) =>
    padLeft + ((val - domainMin) / (domainMax - domainMin)) * plotW;

  const localMaxCount = Math.max(...histogram.map((b) => b.count), 1);
  const maxCount = Math.max(fixedDomain?.maxBinCount ?? 0, localMaxCount, 1);
  const activeOutliers =
    outlierMethod === 'iqr' ? boxplot.outliersIqr : boxplot.outliersZ;

  const ticks = [
    domainMin,
    domainMin + (domainMax - domainMin) * 0.25,
    domainMin + (domainMax - domainMin) * 0.5,
    domainMin + (domainMax - domainMin) * 0.75,
    domainMax,
  ];

  const skewLabel =
    Math.abs(summary.skewness) >= 1
      ? summary.skewness > 0
        ? 'Strongly Right-Skewed'
        : 'Strongly Left-Skewed'
      : Math.abs(summary.skewness) >= 0.5
        ? summary.skewness > 0
          ? 'Moderately Right-Skewed'
          : 'Moderately Left-Skewed'
        : 'Approximately Symmetric';

  return (
    <div className="bg-white border border-[#E5E0D6] rounded-md p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-[#E5E0D6]">
        <div>
          <h4 className="font-serif text-base font-semibold text-[#17202A]">
            {summary.label}
          </h4>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#52606D] mt-0.5 font-mono tabular-nums">
            <span>{summary.stataName}</span>
            {sampleBadge && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#1B365D] font-medium">{sampleBadge}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>N = {summary.n.toLocaleString('en-US')}</span>
            <span aria-hidden="true">·</span>
            <span>Skewness = {formatNum(summary.skewness, 2)} ({skewLabel})</span>
          </div>
        </div>
        <div className="text-xs text-[#52606D] font-mono tabular-nums">
          {outlierMethod === 'iqr'
            ? `IQR Flags: ${summary.iqrOutlierCount} (${summary.iqrExtremeCount} extreme 3×IQR)`
            : `|z| > 3 Flags: ${summary.zOutlierCount}`}
        </div>
      </div>

      {/* Hover inspection line */}
      <div className="h-6 flex items-center justify-between text-xs text-[#52606D] font-mono tabular-nums mt-2">
        {hoveredBin !== null && histogram[hoveredBin] ? (
          <span>
            Bin [{formatNum(histogram[hoveredBin].x0, 2)}, {formatNum(histogram[hoveredBin].x1, 2)}]:{' '}
            <strong className="text-[#17202A]">{histogram[hoveredBin].count}</strong> obs (
            {((histogram[hoveredBin].count / summary.n) * 100).toFixed(1)}%)
          </span>
        ) : hoveredOutlier !== null ? (
          <span className="text-[#991B1B]">
            Flagged Outlier Value: <strong>{formatNum(hoveredOutlier, 2)}</strong>
          </span>
        ) : (
          <span className="text-[#7B8794]">
            Hover bars or outlier markers to inspect bin frequencies and tail values
            {fixedDomain ? ' · Scales locked across samples' : ''}
          </span>
        )}
        <span className="text-[#52606D]">
          Mean {formatNum(boxplot.mean, 2)} · Median {formatNum(boxplot.median, 2)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${histHeight + boxHeight}`}
        className="w-full h-auto block select-none"
        role="img"
        aria-label={`Histogram and boxplot for ${summary.label}`}
      >
        {/* Horizontal gridlines */}
        {[0, 0.5, 1].map((frac) => {
          const y = padTop + plotH * (1 - frac);
          const countLabel = Math.round(maxCount * frac);
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
                {countLabel}
              </text>
            </g>
          );
        })}

        {/* Histogram bars */}
        {histogram.map((bin, idx) => {
          const x0 = scaleX(bin.x0);
          const x1 = scaleX(bin.x1);
          const barW = Math.max(2, x1 - x0 - 1.5);
          const barH = (bin.count / maxCount) * plotH;
          const y = padTop + plotH - barH;
          const isHovered = hoveredBin === idx;

          return (
            <rect
              key={idx}
              x={x0 + 0.75}
              y={y}
              width={barW}
              height={barH}
              fill={isHovered ? '#1B365D' : '#4A6587'}
              fillOpacity={isHovered ? 0.95 : 0.78}
              rx={1}
              className="transition-all duration-200 motion-reduce:transition-none cursor-pointer"
              onMouseEnter={() => setHoveredBin(idx)}
              onMouseLeave={() => setHoveredBin(null)}
            />
          );
        })}

        {/* Mean reference dashed line */}
        <line
          x1={scaleX(boxplot.mean)}
          y1={padTop}
          x2={scaleX(boxplot.mean)}
          y2={padTop + plotH}
          stroke="#B45309"
          strokeWidth="1.25"
          strokeDasharray="3 3"
        />

        {/* Histogram baseline */}
        <line
          x1={padLeft}
          y1={padTop + plotH}
          x2={width - padRight}
          y2={padTop + plotH}
          stroke="#CFC7B8"
          strokeWidth="1"
        />

        {/* Boxplot band */}
        <g transform={`translate(0, ${histHeight})`}>
          <text
            x={padLeft - 8}
            y={26}
            textAnchor="end"
            className="fill-[#7B8794] text-[10px] font-sans"
          >
            Boxplot
          </text>

          {/* Whisker line */}
          <line
            x1={scaleX(boxplot.lowerWhisker)}
            y1={22}
            x2={scaleX(boxplot.upperWhisker)}
            y2={22}
            stroke="#52606D"
            strokeWidth="1.25"
          />
          {/* Whisker caps */}
          <line
            x1={scaleX(boxplot.lowerWhisker)}
            y1={15}
            x2={scaleX(boxplot.lowerWhisker)}
            y2={29}
            stroke="#52606D"
            strokeWidth="1.25"
          />
          <line
            x1={scaleX(boxplot.upperWhisker)}
            y1={15}
            x2={scaleX(boxplot.upperWhisker)}
            y2={29}
            stroke="#52606D"
            strokeWidth="1.25"
          />

          {/* IQR Box (Q1 to Q3) */}
          <rect
            x={scaleX(boxplot.q1)}
            y={11}
            width={Math.max(2, scaleX(boxplot.q3) - scaleX(boxplot.q1))}
            height={22}
            fill="#FAF8F4"
            stroke="#1B365D"
            strokeWidth="1.5"
            rx={1.5}
          />

          {/* Median Line */}
          <line
            x1={scaleX(boxplot.median)}
            y1={11}
            x2={scaleX(boxplot.median)}
            y2={33}
            stroke="#1B365D"
            strokeWidth="2.25"
          />

          {/* Mean diamond marker */}
          <polygon
            points={`${scaleX(boxplot.mean)},17 ${scaleX(boxplot.mean) + 4},22 ${scaleX(boxplot.mean)},27 ${scaleX(boxplot.mean) - 4},22`}
            fill="#B45309"
          />

          {/* Highlighted Outlier points */}
          {activeOutliers.map((val, idx) => (
            <circle
              key={idx}
              cx={scaleX(val)}
              cy={22}
              r={hoveredOutlier === val ? 4.5 : 3.2}
              fill="#991B1B"
              fillOpacity={0.85}
              stroke="#FFFFFF"
              strokeWidth="0.8"
              className="cursor-pointer transition-all motion-reduce:transition-none"
              onMouseEnter={() => setHoveredOutlier(val)}
              onMouseLeave={() => setHoveredOutlier(null)}
            />
          ))}

          {/* X-axis ticks */}
          <line
            x1={padLeft}
            y1={46}
            x2={width - padRight}
            y2={46}
            stroke="#E5E0D6"
            strokeWidth="1"
          />
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={scaleX(t)}
                y1={46}
                x2={scaleX(t)}
                y2={50}
                stroke="#CFC7B8"
                strokeWidth="1"
              />
              <text
                x={scaleX(t)}
                y={62}
                textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
                className="fill-[#52606D] text-[10px] font-mono"
              >
                {formatNum(t, Math.abs(domainMax) >= 100 ? 0 : 2)}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {/* Quiet legend */}
      <div className="flex flex-wrap items-center gap-4 pt-3 mt-1 border-t border-[#F0ECE4] text-[11px] text-[#52606D]">
        <span>Solid navy bar: IQR (p25–p75) &amp; Median</span>
        <span aria-hidden="true">·</span>
        <span className="text-[#B45309]">Amber diamond / dashed line: Mean</span>
        <span aria-hidden="true">·</span>
        <span className="text-[#991B1B]">
          Crimson dots: {outlierMethod === 'iqr' ? '1.5×IQR outliers' : '|z| > 3 outliers'}
        </span>
      </div>
    </div>
  );
};
