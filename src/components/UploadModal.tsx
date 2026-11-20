import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FolderOpen, RotateCcw, Upload, X } from 'lucide-react';
import type { DatasetState } from '../types/econometrics';
import {
  parseCsvText,
  parseExcelSheet,
  readExcelWorkbook,
  type ParsedWorkbookHandle,
} from '../lib/parser';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDatasetLoaded: (dataset: DatasetState) => void;
  onLoadDemo: () => void;
  returnFocusRef?: React.RefObject<HTMLButtonElement | null>;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  '[href]:not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  onDatasetLoaded,
  onLoadDemo,
  returnFocusRef,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const browseBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingWorkbook, setPendingWorkbook] = useState<ParsedWorkbookHandle | null>(null);
  const [chosenSheet, setChosenSheet] = useState<string>('');

  const handleRequestClose = useCallback(() => {
    setPendingWorkbook(null);
    setError(null);
    onClose();
  }, [onClose]);

  // Capture trigger element on open, focus initial control, trap Tab / Shift+Tab,
  // close on Escape, and restore focus to the Upload Dataset trigger on close.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const focusTimer = window.setTimeout(() => {
      browseBtnRef.current?.focus();
    }, 20);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleRequestClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          if (!active || active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (!active || active === last || !dialogRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      // Restore focus cleanly to the Upload Dataset trigger button on close
      const target = returnFocusRef?.current ?? previouslyFocusedRef.current;
      if (target && typeof target.focus === 'function') {
        window.requestAnimationFrame(() => {
          target.focus();
        });
      }
    };
  }, [isOpen, handleRequestClose, returnFocusRef]);

  // Move focus cleanly inside dialog when transitioning to the worksheet selector
  useEffect(() => {
    if (!isOpen || !pendingWorkbook || !dialogRef.current) return;
    const checkedRadio = dialogRef.current.querySelector<HTMLInputElement>(
      'input[name="excel-sheet"]:checked'
    );
    if (checkedRadio) {
      checkedRadio.focus();
    }
  }, [isOpen, pendingWorkbook]);

  if (!isOpen) return null;

  const processFile = async (file: File) => {
    setError(null);
    setLoading(true);
    setPendingWorkbook(null);

    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
        const text = await file.text();
        const dataset = parseCsvText(text, file.name, false);
        onDatasetLoaded(dataset);
        handleRequestClose();
      } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const handle = readExcelWorkbook(buffer, file.name);
        const preferred =
          handle.sheetPreviews.find((s) => !s.looksLikeNotes && s.rowCount > 0)?.name ??
          handle.sheetNames[0];
        setPendingWorkbook(handle);
        setChosenSheet(preferred);
      } else {
        throw new Error('Unsupported file format. Please upload a .csv or .xlsx workbook.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to parse the selected file.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSheet = () => {
    if (!pendingWorkbook || !chosenSheet) return;
    setError(null);
    try {
      const dataset = parseExcelSheet(pendingWorkbook, chosenSheet);
      onDatasetLoaded(dataset);
      handleRequestClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to parse the selected worksheet.');
    }
  };

  const activePreview = pendingWorkbook?.sheetPreviews.find((s) => s.name === chosenSheet) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#17202A]/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleRequestClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`bg-white border border-[#CFC7B8] rounded-md w-full ${
          pendingWorkbook ? 'max-w-3xl' : 'max-w-lg'
        } shadow-lg overflow-hidden max-h-[92vh] flex flex-col`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E0D6] bg-[#FAF8F4] shrink-0">
          <div>
            <h2 id="upload-modal-title" className="font-serif text-lg font-semibold text-[#17202A]">
              Import Empirical Dataset
            </h2>
            <p className="text-xs text-[#52606D] mt-0.5">
              Parsed locally in your browser · Full Excel numeric precision &amp; zero-padded IDs preserved
            </p>
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            aria-label="Close upload dialog"
            className="p-1.5 text-[#52606D] hover:text-[#17202A] rounded hover:bg-[#EFECE6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {!pendingWorkbook ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) processFile(file);
              }}
              className={`border border-dashed rounded-md px-6 py-9 text-center transition-colors motion-reduce:transition-none ${
                dragging
                  ? 'border-[#1B365D] bg-[#1B365D]/5'
                  : 'border-[#CFC7B8] bg-[#FAF8F4]'
              }`}
            >
              <Upload className="w-7 h-7 mx-auto text-[#1B365D] mb-3" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#17202A]">
                {loading ? 'Parsing dataset...' : 'Drop a .csv or .xlsx file here'}
              </p>
              <p className="text-xs text-[#52606D] mt-1.5 max-w-sm mx-auto">
                Reads stored Excel numeric precision (ignoring rounded display formats), preserves leading-zero and long text IDs, and previews worksheets before import.
              </p>
              <div className="mt-4">
                <button
                  ref={browseBtnRef}
                  type="button"
                  disabled={loading}
                  aria-label="Browse files"
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#1B365D] rounded hover:bg-[#132847] transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] focus-visible:ring-offset-2"
                >
                  <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Browse files</span>
                </button>
              </div>
              {/* Hidden from keyboard tab order so Browse files is a single focus stop */}
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.tsv"
                tabIndex={-1}
                aria-hidden="true"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-[#1B365D] shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold text-[#17202A]">
                      Select Worksheet from {pendingWorkbook.fileName}
                    </h3>
                    <p className="text-xs text-[#52606D] mt-0.5 font-mono">
                      {pendingWorkbook.sheetPreviews.length} sheet(s) · Workbook date system:{' '}
                      {pendingWorkbook.excelDateSystem}
                    </p>
                  </div>
                </div>
              </div>

              {/* Sheet selector list with row/column counts */}
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-[#52606D] mb-1.5">
                  Available worksheets (choose the analysis table to import)
                </legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {pendingWorkbook.sheetPreviews.map((sheet) => {
                    const selected = chosenSheet === sheet.name;
                    return (
                      <label
                        key={sheet.name}
                        className={`flex items-start gap-3 px-3.5 py-2.5 rounded border cursor-pointer text-xs transition-colors motion-reduce:transition-none focus-within:ring-2 focus-within:ring-[#1B365D] ${
                          selected
                            ? 'border-[#1B365D] bg-[#1B365D]/5 text-[#17202A]'
                            : 'border-[#E5E0D6] bg-white text-[#52606D] hover:border-[#CFC7B8]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="excel-sheet"
                          value={sheet.name}
                          checked={selected}
                          onChange={() => setChosenSheet(sheet.name)}
                          className="mt-0.5 accent-[#1B365D] focus-visible:outline-none"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-semibold text-[#17202A] truncate">
                            {sheet.name}
                          </div>
                          <div className="font-mono tabular-nums text-[11px] text-[#52606D] mt-0.5">
                            {sheet.rowCount.toLocaleString('en-US')} rows × {sheet.columnCount} cols
                            {sheet.looksLikeNotes ? ' · notes/documentation' : ''}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* Sheet preview table */}
              {activePreview && (
                <div className="border border-[#E5E0D6] rounded-md overflow-hidden bg-white">
                  <div className="px-3.5 py-2 border-b border-[#E5E0D6] bg-[#FAF8F4] flex items-center justify-between text-[11px] text-[#52606D] font-mono">
                    <span>
                      Preview: <strong className="text-[#17202A]">{activePreview.name}</strong>
                    </span>
                    <span>
                      Showing up to 4 rows × 6 cols (stored values)
                    </span>
                  </div>
                  {activePreview.headers.length === 0 ? (
                    <div className="p-4 text-xs text-[#7B8794]">
                      This worksheet appears empty.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[11px] font-mono">
                        <thead>
                          <tr className="border-b border-[#CFC7B8] bg-white text-[#52606D]">
                            {activePreview.headers.map((h, i) => (
                              <th key={i} className="py-1.5 px-2.5 whitespace-nowrap font-semibold">
                                {h || `col_${i + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0ECE4] text-[#17202A]">
                          {activePreview.previewRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={activePreview.headers.length}
                                className="py-3 px-2.5 text-[#7B8794]"
                              >
                                No data rows detected beneath the header row.
                              </td>
                            </tr>
                          ) : (
                            activePreview.previewRows.map((row, rIdx) => (
                              <tr key={rIdx}>
                                {activePreview.headers.map((_, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className="py-1.5 px-2.5 whitespace-nowrap max-w-[160px] truncate"
                                  >
                                    {row[cIdx] || <span className="text-[#9CA3AF]">.</span>}
                                  </td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingWorkbook(null)}
                  className="px-3 py-1.5 text-xs font-medium text-[#52606D] hover:text-[#17202A] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] rounded"
                >
                  Choose another file
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSheet}
                  disabled={!activePreview || activePreview.rowCount === 0}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-[#1B365D] rounded hover:bg-[#132847] disabled:opacity-40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] focus-visible:ring-offset-2"
                >
                  Import Selected Sheet
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="px-3.5 py-2.5 text-xs text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-[#E5E0D6]">
            <div className="text-xs text-[#52606D]">
              Need a reference panel to test diagnostics?
            </div>
            <button
              type="button"
              onClick={() => {
                onLoadDemo();
                handleRequestClose();
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1B365D] hover:underline whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] rounded px-1"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Load Housing Panel Demo</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
