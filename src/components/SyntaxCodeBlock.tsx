import React, { useMemo } from 'react';
import { Check, Copy, Download } from 'lucide-react';

interface SyntaxCodeBlockProps {
  code: string;
  language: 'stata' | 'latex';
  fileName: string;
  title?: string;
  subtitle?: string;
  onCopy: () => void;
  onDownload: () => void;
  copied?: boolean;
}

const STATA_KEYWORDS = new Set([
  'version', 'clear', 'all', 'set', 'more', 'off', 'capture', 'log', 'close',
  'import', 'delimited', 'excel', 'using', 'label', 'variable', 'duplicates',
  'report', 'drop', 'tag', 'winsor2', 'gen', 'double', 'encode', 'xtset', 'xtdescribe',
  'summarize', 'tabstat', 'pwcorr', 'estimates', 'store', 'restore', 'regress',
  'reg', 'xtreg', 'reghdfe', 'quietly', 'estat', 'vif', 'hettest', 'hausman',
  'esttab', 'ssc', 'install', 'ds', 'local', 'foreach', 'of', 'varlist',
  'rename', 'replace', 'if', 'else', 'destring', 'tostring', 'format',
  'daily', 'monthly', 'quarterly', 'mofd', 'qofd', 'has', 'numeric', 'string',
  'display', 'as', 'result', 'confirm', 'scalar', 'tab',
]);

function highlightStataLine(line: string): React.ReactNode[] {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('//')) {
    return [
      <span key="c" className="text-[#6B7280] italic">
        {line}
      </span>,
    ];
  }

  // Split trailing // comment if present
  const commentIdx = line.indexOf(' //');
  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : '';

  const tokens = codePart.split(/("[^"]*"|\b[a-zA-Z_][a-zA-Z0-9_]*\b|\b\d+(?:\.\d+)?\b)/g);
  const nodes: React.ReactNode[] = tokens.map((tok, i) => {
    if (!tok) return null;
    if (tok.startsWith('"') && tok.endsWith('"')) {
      return (
        <span key={i} className="text-[#166534]">
          {tok}
        </span>
      );
    }
    if (STATA_KEYWORDS.has(tok)) {
      return (
        <span key={i} className="text-[#1B365D] font-semibold">
          {tok}
        </span>
      );
    }
    if (/^\d+(?:\.\d+)?$/.test(tok)) {
      return (
        <span key={i} className="text-[#9A3412]">
          {tok}
        </span>
      );
    }
    return <span key={i}>{tok}</span>;
  });

  if (commentPart) {
    nodes.push(
      <span key="trail" className="text-[#6B7280] italic">
        {commentPart}
      </span>
    );
  }
  return nodes;
}

function highlightLatexLine(line: string): React.ReactNode[] {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('%')) {
    return [
      <span key="c" className="text-[#6B7280] italic">
        {line}
      </span>,
    ];
  }

  const tokens = line.split(/(\\[a-zA-Z]+|&|\\\\|\$[^$]*\$|\{[^}]*\})/g);
  return tokens.map((tok, i) => {
    if (!tok) return null;
    if (tok.startsWith('\\') && tok !== '\\\\') {
      return (
        <span key={i} className="text-[#1B365D] font-semibold">
          {tok}
        </span>
      );
    }
    if (tok === '&' || tok === '\\\\') {
      return (
        <span key={i} className="text-[#991B1B] font-medium">
          {tok}
        </span>
      );
    }
    if (tok.startsWith('$') && tok.endsWith('$')) {
      return (
        <span key={i} className="text-[#9A3412]">
          {tok}
        </span>
      );
    }
    if (tok.startsWith('{') && tok.endsWith('}')) {
      return (
        <span key={i} className="text-[#166534]">
          {tok}
        </span>
      );
    }
    return <span key={i}>{tok}</span>;
  });
}

export const SyntaxCodeBlock: React.FC<SyntaxCodeBlockProps> = ({
  code,
  language,
  fileName,
  title,
  subtitle,
  onCopy,
  onDownload,
  copied = false,
}) => {
  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <div className="bg-white border border-[#E5E0D6] rounded-md overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-[#E5E0D6] bg-[#FAF8F4]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#17202A]">
            <span className="truncate">{title || fileName}</span>
            <span className="text-xs font-mono font-normal text-[#7B8794] shrink-0">
              {lines.length} lines
            </span>
          </div>
          {subtitle && (
            <p className="text-xs text-[#52606D] mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#17202A] bg-white border border-[#CFC7B8] rounded hover:bg-[#F4F1EA] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#166534]" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[#52606D]" />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1B365D] rounded hover:bg-[#132847] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download {language === 'stata' ? '.do' : '.tex'}</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto overflow-y-auto max-h-[620px] bg-white">
        <pre className="py-3 text-[12.5px] leading-[1.6] font-mono text-[#17202A] tabular-nums">
          <code>
            {lines.map((line, idx) => (
              <div
                key={idx}
                className="flex hover:bg-[#FAF8F4] px-4 transition-colors"
              >
                <span className="w-10 pr-4 text-right select-none text-[#9CA3AF] shrink-0">
                  {idx + 1}
                </span>
                <span className="whitespace-pre">
                  {line === ''
                    ? ' '
                    : language === 'stata'
                      ? highlightStataLine(line)
                      : highlightLatexLine(line)}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
};
