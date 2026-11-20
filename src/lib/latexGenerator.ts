import type {
  CorrelationMatrixData,
  DatasetState,
  LatexConfig,
  ModelSpec,
  NumericSummary,
  PanelDetection,
  SampleImpact,
} from '../types/econometrics';
import { formatNum } from './statistics';
import { formatPanelNoteSentence } from './panelStatus';

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

export function describePanelForSample(panel: PanelDetection): string {
  return formatPanelNoteSentence(panel);
}

function buildSampleNote(
  dataset: DatasetState,
  config: LatexConfig,
  spec: ModelSpec,
  impact: SampleImpact,
  samplePanel: PanelDetection,
  correlation?: CorrelationMatrixData
): string {
  const parts: string[] = [];

  if (config.sampleScope === 'cleaned') {
    const cleanDesc: string[] = [];
    if (spec.dropExactDuplicates && impact.exactDuplicatesRemoved > 0) {
      cleanDesc.push(`${impact.exactDuplicatesRemoved} exact duplicate(s) removed`);
    }
    if (spec.winsorizeVars.length > 0) {
      cleanDesc.push(
        `${spec.winsorizeVars.join(', ')} winsorized at ${spec.winsorizeLevel}%/${100 - spec.winsorizeLevel}%`
      );
    }
    parts.push(
      `Sample: Cleaned dataset (N = ${impact.afterExactDuplicatesN.toLocaleString('en-US')}${cleanDesc.length ? `; ${cleanDesc.join('; ')}` : ''}).`
    );
  } else {
    parts.push(`Sample: Raw imported dataset (N = ${dataset.rowCount.toLocaleString('en-US')} observations).`);
  }

  const panelNote = describePanelForSample(samplePanel);
  if (panelNote) {
    parts.push(panelNote);
  }

  if (config.tableType === 'correlation' && correlation) {
    if (correlation.minPairwiseN === correlation.maxPairwiseN) {
      parts.push(`Pairwise Pearson correlations computed on N = ${correlation.minPairwiseN.toLocaleString('en-US')} complete pairs.`);
    } else {
      parts.push(
        `Pairwise Pearson correlations; pairwise sample sizes vary between N = ${correlation.minPairwiseN.toLocaleString('en-US')} and N = ${correlation.maxPairwiseN.toLocaleString('en-US')}.`
      );
    }
    if (config.boldHighCorrelations) {
      parts.push(
        `Bold entries denote off-diagonal correlations with $|r| \\ge ${config.highlightThreshold.toFixed(2)}$.`
      );
    }
  }

  return parts.join(' ');
}

export function generateLatexTable(
  dataset: DatasetState,
  summaries: NumericSummary[],
  correlation: CorrelationMatrixData,
  config: LatexConfig,
  spec: ModelSpec,
  impact: SampleImpact
): string {
  const selectedSet = new Set(config.selectedVars);
  const filteredSummaries = summaries.filter((s) => selectedSet.has(s.stataName));
  const samplePanel = config.sampleScope === 'cleaned' ? impact.cleanedPanel : dataset.panel;
  const noteText = buildSampleNote(dataset, config, spec, impact, samplePanel, correlation);

  if (filteredSummaries.length === 0) {
    return '% Select at least one numeric variable to generate a LaTeX table.';
  }

  const isCompact = config.pageFitPreset === 'compact_article';
  const isSixCol = config.pageFitPreset === 'compact_6col';
  const needsArrayPkg = isCompact || isSixCol;
  const needsGraphicx = config.useResizeBox;

  const preamblePackages = ['\\usepackage{booktabs}', '\\usepackage{threeparttable}'];
  if (needsArrayPkg) preamblePackages.push('\\usepackage{array}');
  if (needsGraphicx) preamblePackages.push('\\usepackage{graphicx}');

  const lines: string[] = [];
  lines.push(`% Required preamble packages: ${preamblePackages.join(' ')}`);
  lines.push('\\begin{table}[htbp]');
  lines.push('  \\centering');

  if (isCompact) {
    lines.push('  \\footnotesize');
    lines.push('  \\setlength{\\tabcolsep}{3pt}');
  } else if (isSixCol) {
    lines.push('  \\footnotesize');
    lines.push('  \\setlength{\\tabcolsep}{4pt}');
  }

  const indent = needsGraphicx ? '    ' : '  ';
  if (needsGraphicx) {
    lines.push('  \\resizebox{\\linewidth}{!}{%');
  }

  lines.push(`${indent}\\begin{threeparttable}`);
  lines.push(`${indent}  \\caption{${escapeLatex(config.caption)}}`);
  lines.push(`${indent}  \\label{${config.label.replace(/[^a-zA-Z0-9:_-]/g, '') || 'tab:summary'}}`);

  if (config.tableType === 'summary') {
    if (isSixCol) {
      lines.push(`${indent}  \\begin{tabular}{@{}>{\\raggedright\\arraybackslash}p{3.4cm}rrrrrr@{}}`);
      lines.push(`${indent}    \\toprule`);
      lines.push(`${indent}    Variable & $N$ & Mean & SD & Min & Median & Max \\\\`);
      lines.push(`${indent}    \\midrule`);

      for (const s of filteredSummaries) {
        const row = [
          escapeLatex(s.label),
          s.n.toLocaleString('en-US'),
          formatNum(s.mean, config.decimals),
          formatNum(s.sd, config.decimals),
          formatNum(s.min, config.decimals),
          formatNum(s.median, config.decimals),
          formatNum(s.max, config.decimals),
        ];
        lines.push(`${indent}    ${row.join(' & ')} \\\\`);
      }
    } else {
      const colSpec = isCompact
        ? '@{}>{\\raggedright\\arraybackslash}p{2.6cm}rrrrrrrr@{}'
        : 'lrrrrrrrr';
      const medHeader = isCompact ? 'Med.' : 'Median';
      lines.push(`${indent}  \\begin{tabular}{${colSpec}}`);
      lines.push(`${indent}    \\toprule`);
      lines.push(`${indent}    Variable & $N$ & Mean & SD & Min & p25 & ${medHeader} & p75 & Max \\\\`);
      lines.push(`${indent}    \\midrule`);

      for (const s of filteredSummaries) {
        const row = [
          escapeLatex(s.label),
          s.n.toLocaleString('en-US'),
          formatNum(s.mean, config.decimals),
          formatNum(s.sd, config.decimals),
          formatNum(s.min, config.decimals),
          formatNum(s.p25, config.decimals),
          formatNum(s.median, config.decimals),
          formatNum(s.p75, config.decimals),
          formatNum(s.max, config.decimals),
        ];
        lines.push(`${indent}    ${row.join(' & ')} \\\\`);
      }
    }

    lines.push(`${indent}    \\bottomrule`);
    lines.push(`${indent}  \\end{tabular}`);
  } else {
    const activeVars = filteredSummaries.map((s) => s.stataName);
    const colSpec =
      isCompact || isSixCol
        ? `@{}>{\\raggedright\\arraybackslash}p{2.9cm}${'r'.repeat(activeVars.length)}@{}`
        : `l${'r'.repeat(activeVars.length)}`;
    lines.push(`${indent}  \\begin{tabular}{${colSpec}}`);
    lines.push(`${indent}    \\toprule`);

    const headerCells = ['Variable', ...activeVars.map((_, idx) => `(${idx + 1})`)];
    lines.push(`${indent}    ${headerCells.join(' & ')} \\\\`);
    lines.push(`${indent}    \\midrule`);

    filteredSummaries.forEach((rowSummary, i) => {
      const cells: string[] = [`(${i + 1}) ${escapeLatex(rowSummary.label)}`];
      activeVars.forEach((colVar, j) => {
        if (j > i) {
          cells.push('');
        } else if (j === i) {
          cells.push((1).toFixed(config.decimals));
        } else {
          const entry = correlation.matrix[rowSummary.stataName]?.[colVar];
          if (!entry || entry.r === null) {
            cells.push('---');
          } else {
            const formatted = entry.r.toFixed(config.decimals);
            if (config.boldHighCorrelations && Math.abs(entry.r) >= config.highlightThreshold) {
              cells.push(`\\textbf{${formatted}}`);
            } else {
              cells.push(formatted);
            }
          }
        }
      });
      lines.push(`${indent}    ${cells.join(' & ')} \\\\`);
    });

    lines.push(`${indent}    \\bottomrule`);
    lines.push(`${indent}  \\end{tabular}`);
  }

  lines.push(`${indent}  \\begin{tablenotes}[flushleft]`);
  lines.push(`${indent}    \\footnotesize`);
  lines.push(
    `${indent}    \\item \\textit{Notes:} ${escapeLatex(noteText)
      .replace(/\\\$\\|r\\\| \\\\ge /g, '$|r| \\ge ')
      .replace(/\\\$/g, '$')}`
  );
  lines.push(`${indent}  \\end{tablenotes}`);
  lines.push(`${indent}\\end{threeparttable}`);

  if (needsGraphicx) {
    lines.push('  }%');
  }

  lines.push('\\end{table}');

  return lines.join('\n');
}
