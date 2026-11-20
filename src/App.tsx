import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareText, Undo2, Upload } from 'lucide-react';
import type {
  AssistantMessage,
  DatasetState,
  LatexConfig,
  LogTransformMode,
  ModelSpec,
  SpecProposalPatch,
  TimeCadence,
  WorkspaceTab,
} from './types/econometrics';
import { generateDemoHousingCsv } from './lib/sampleData';
import { evaluatePanelStructure, parseCsvText } from './lib/parser';
import {
  buildCleanedRowsAndImpact,
  computeCorrelationMatrix,
  computeDiagnostics,
  computeNumericSummary,
} from './lib/statistics';
import {
  createInitialModelSpec,
  validateProposalAgainstDataset,
} from './lib/specValidator';
import { InspectorView } from './components/InspectorView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { ModelSuggestionsView } from './components/ModelSuggestionsView';
import { StataWorkspaceView } from './components/StataWorkspaceView';
import { LatexWorkspaceView } from './components/LatexWorkspaceView';
import { UploadModal } from './components/UploadModal';
import type { CandidateModelRecommendation } from './lib/modelSuggestions';

const IS_PUBLIC_BUILD = import.meta.env.VITE_PUBLIC_BUILD === 'true';

const LazyAssistantDrawer = IS_PUBLIC_BUILD
  ? null
  : React.lazy(() =>
      import('./components/AssistantDrawer').then((m) => ({
        default: m.AssistantDrawer,
      }))
    );

function createDemoDataset(): DatasetState {
  const csv = generateDemoHousingCsv();
  return parseCsvText(csv, 'us_metro_housing_panel.csv', true);
}

function createInitialLatexConfig(dataset: DatasetState): LatexConfig {
  const numericVars = dataset.columns
    .filter((c) => c.type === 'numeric')
    .map((c) => c.stataName);
  return {
    tableType: 'summary',
    sampleScope: 'cleaned',
    pageFitPreset: 'compact_article',
    useResizeBox: false,
    decimals: 2,
    selectedVars: numericVars,
    caption: 'Descriptive Summary Statistics',
    label: 'tab:summary_stats',
    highlightThreshold: 0.7,
    boldHighCorrelations: true,
  };
}

const TAB_TITLES: Record<WorkspaceTab, string> = {
  inspector: 'Dataset Inspector & Schema',
  diagnostics: 'Exploratory Diagnostics & Distributions',
  suggestions: 'Model Suggestions (Client-Side Guidance)',
  stata: 'Stata Model Builder & .do Export',
  latex: 'LaTeX Publication Table Export',
};

export default function App() {
  const [dataset, setDataset] = useState<DatasetState>(() => createDemoDataset());
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('inspector');
  const [spec, setSpec] = useState<ModelSpec>(() => createInitialModelSpec(dataset));
  const [previousSpec, setPreviousSpec] = useState<ModelSpec | null>(null);
  const [latexConfig, setLatexConfig] = useState<LatexConfig>(() =>
    createInitialLatexConfig(dataset)
  );

  // Assistant starts collapsed by default so data grids, charts, and script preview command full desktop width
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [shareMetadataOptIn, setShareMetadataOptIn] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const mainHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const uploadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hasMountedRef = useRef(false);

  // Predictable focus and scroll position when switching workspace views
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    mainHeadingRef.current?.focus({ preventScroll: true });
  }, [activeTab]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 2800);
  }, []);

  const diagnostics = useMemo(() => computeDiagnostics(dataset), [dataset]);

  const { cleanedRows, impact } = useMemo(
    () => buildCleanedRowsAndImpact(dataset, spec),
    [dataset, spec]
  );

  const cleanedSummaries = useMemo(() => {
    const numericCols = dataset.columns.filter((c) => c.type === 'numeric');
    return numericCols.map((c) =>
      computeNumericSummary(cleanedRows, c.stataName, c.label)
    );
  }, [dataset.columns, cleanedRows]);

  const cleanedCorrelation = useMemo(() => {
    const numericCols = dataset.columns
      .filter((c) => c.type === 'numeric')
      .map((c) => c.stataName);
    return computeCorrelationMatrix(cleanedRows, numericCols);
  }, [dataset.columns, cleanedRows]);

  const handleDatasetLoaded = useCallback(
    (nextDataset: DatasetState) => {
      setDataset(nextDataset);
      setSpec(createInitialModelSpec(nextDataset));
      setPreviousSpec(null);
      setLatexConfig(createInitialLatexConfig(nextDataset));
      setMessages([]);
      setShareMetadataOptIn(false);
      setActiveTab('inspector');
      showToast(
        `Loaded ${nextDataset.fileName} (${nextDataset.rowCount.toLocaleString('en-US')} × ${nextDataset.columnCount})`
      );
    },
    [showToast]
  );

  const handleLoadDemo = useCallback(() => {
    const demo = createDemoDataset();
    handleDatasetLoaded(demo);
  }, [handleDatasetLoaded]);

  const handleUpdateColumnLabel = useCallback((stataName: string, newLabel: string) => {
    setDataset((prev) => ({
      ...prev,
      columns: prev.columns.map((c) =>
        c.stataName === stataName ? { ...c, label: newLabel } : c
      ),
    }));
  }, []);

  const handleUpdateTimeCadence = useCallback(
    (stataName: string, cadence: TimeCadence) => {
      setDataset((prev) => ({
        ...prev,
        columns: prev.columns.map((c) =>
          c.stataName === stataName
            ? {
                ...c,
                confirmedTimeCadence: cadence,
                role: cadence !== 'none' ? 'time' : c.role,
              }
            : c
        ),
      }));
      showToast(
        cadence === 'none'
          ? `Cleared confirmed time cadence for ${stataName}`
          : `Confirmed ${cadence} cadence for ${stataName}`
      );
    },
    [showToast]
  );

  const handleUpdatePanelKeys = useCallback(
    (entityVar: string | null, timeVar: string | null, confirmed: boolean) => {
      setDataset((prev) => {
        const reason =
          entityVar && timeVar
            ? `Researcher-selected entity "${entityVar}" and time "${timeVar}".`
            : 'Cross-sectional mode selected (no panel keys).';
        const nextPanel = evaluatePanelStructure(
          prev.rows,
          prev.columns,
          entityVar,
          timeVar,
          reason,
          confirmed,
          entityVar && timeVar
            ? 'panel'
            : prev.panel.candidateTimeVar
              ? 'dated_cross_section'
              : 'cross_section',
          entityVar ?? prev.panel.candidateEntityVar,
          timeVar ?? prev.panel.candidateTimeVar
        );
        return { ...prev, panel: nextPanel };
      });
      // Keep absorbed FEs / clustering cleanly aligned when panel keys change
      setSpec((prev) => {
        if (!entityVar || !timeVar) {
          return {
            ...prev,
            estimator:
              prev.estimator === 'fe_xtreg' || prev.estimator === 're_xtreg'
                ? 'ols'
                : prev.estimator,
            seType:
              prev.seType === 'cluster_entity' || prev.seType === 'cluster_twoway'
                ? 'robust'
                : prev.seType,
          };
        }
        return prev;
      });
      showToast(
        entityVar && timeVar
          ? `Panel keys confirmed (${entityVar}, ${timeVar})`
          : 'Switched to cross-sectional mode'
      );
    },
    [showToast]
  );

  const handleToggleWinsorize = useCallback(
    (varName: string) => {
      setSpec((prev) => {
        const exists = prev.winsorizeVars.includes(varName);
        const nextVars = exists
          ? prev.winsorizeVars.filter((v) => v !== varName)
          : [...prev.winsorizeVars, varName];
        return { ...prev, winsorizeVars: nextVars };
      });
      showToast(`Updated winsor2 pipeline for ${varName}`);
    },
    [showToast]
  );

  const handleToggleLogTransform = useCallback(
    (varName: string, recommendedMode: LogTransformMode) => {
      setSpec((prev) => {
        const nextLogs = { ...prev.logTransforms };
        if (nextLogs[varName]) {
          delete nextLogs[varName];
        } else {
          nextLogs[varName] = recommendedMode;
        }
        return { ...prev, logTransforms: nextLogs };
      });
      showToast(`Updated transformation for ${varName}`);
    },
    [showToast]
  );

  const handleToggleDropDuplicates = useCallback(() => {
    setSpec((prev) => ({
      ...prev,
      dropExactDuplicates: !prev.dropExactDuplicates,
    }));
  }, []);

  // Revalidate proposal right at click time against CURRENT dataset and CURRENT spec
  const handleApplyPatch = useCallback(
    (rawPatch: SpecProposalPatch, originDatasetId: string, msgId: string) => {
      if (originDatasetId !== dataset.id) {
        showToast('Proposal discarded: dataset has changed since this suggestion was generated.');
        return;
      }

      const validated = validateProposalAgainstDataset(
        dataset,
        spec,
        rawPatch,
        impact.postDedupPanelCheck
      );

      if (!validated.isValid) {
        showToast('No remaining valid changes to apply to the current specification.');
        return;
      }

      setPreviousSpec(spec);
      setSpec(validated.nextSpec);
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, applied: true } : m))
      );
      showToast('Applied validated AI specification to Model Builder (Undo available)');
    },
    [dataset, spec, impact.postDedupPanelCheck, showToast]
  );

  const handleReviewSuggestionInBuilder = useCallback(
    (
      draft: NonNullable<CandidateModelRecommendation['builderSpecDraft']>,
      title: string
    ) => {
      setPreviousSpec(spec);
      setSpec((prev) => ({
        ...prev,
        estimator: draft.estimator,
        depVar: draft.depVar,
        indepVars: draft.indepVars,
        absorbVars: draft.absorbVars ?? prev.absorbVars,
        seType: draft.seType ?? prev.seType,
      }));
      setActiveTab('stata');
      showToast(`Loaded "${title}" into Model Builder for review (Undo available)`);
    },
    [spec, showToast]
  );

  const handleUndoLastApply = useCallback(() => {
    if (!previousSpec) return;
    setSpec(previousSpec);
    setPreviousSpec(null);
    showToast('Restored previous Model Builder specification');
  }, [previousSpec, showToast]);

  const handleCopyCode = useCallback(
    async (code: string, key: string) => {
      try {
        await navigator.clipboard.writeText(code);
        setCopiedKey(key);
        showToast(
          key === 'stata'
            ? 'Stata .do script copied to clipboard'
            : 'LaTeX table copied to clipboard'
        );
        setTimeout(() => setCopiedKey(null), 1800);
      } catch {
        showToast('Clipboard copy failed; select text manually.');
      }
    },
    [showToast]
  );

  const handleDownloadCode = useCallback(
    (code: string, fileName: string) => {
      const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Downloaded ${fileName}`);
    },
    [showToast]
  );

  const handleDownloadBlob = useCallback(
    (blob: Blob, fileName: string, toastMsg: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(toastMsg);
    },
    [showToast]
  );

  const navItems: Array<{ id: WorkspaceTab; label: string }> = [
    { id: 'inspector', label: 'Inspector' },
    { id: 'diagnostics', label: 'Diagnostics' },
    { id: 'suggestions', label: 'Suggestions' },
    { id: 'stata', label: 'Stata .do' },
    { id: 'latex', label: 'LaTeX' },
  ];

  const structureSummaryText = dataset.panel.isPanel
    ? `${dataset.panel.userConfirmed ? 'Confirmed' : 'Suggested'} Panel (${dataset.panel.entityVar}, ${dataset.panel.timeVar})`
    : dataset.panel.structureKind === 'dated_cross_section'
      ? `Dated Cross-Section${dataset.panel.uniqueRecordIdVar ? ` (${dataset.panel.uniqueRecordIdVar})` : ''}`
      : 'Cross-Sectional';

  return (
    <div className="min-h-screen bg-[#FAF8F4] text-[#17202A] flex flex-col">
      {/* Top Navigation Bar — Strict 3-Zone Contract on desktop + reachable mobile sub-nav */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-[#E5E0D6]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single-line editorial wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('inspector')}
            className="font-serif text-lg sm:text-xl font-bold tracking-tight text-[#17202A] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] rounded px-1"
          >
            Folio Econometrics
          </button>

          {/* Zone 2: 4 single-line navigation links (desktop) */}
          <nav
            aria-label="Workspace Views"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] rounded-t ${
                    active
                      ? 'border-[#1B365D] text-[#1B365D] font-semibold'
                      : 'border-transparent text-[#52606D] hover:text-[#17202A]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary CTA action */}
          <div className="shrink-0">
            <button
              ref={uploadTriggerRef}
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-medium text-white bg-[#1B365D] rounded hover:bg-[#132847] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] focus-visible:ring-offset-2"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Upload Dataset</span>
            </button>
          </div>
        </div>

        {/* Narrow-viewport reachable navigation bar (all 5 tabs visible at 375px without clipping) */}
        <nav
          aria-label="Workspace Views (Compact)"
          className="md:hidden grid grid-cols-5 border-t border-[#EFECE6] bg-[#FAF8F4]"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[44px] px-1 text-[11px] font-medium border-b-2 transition-colors cursor-pointer truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B365D] ${
                  active
                    ? 'border-[#1B365D] bg-white text-[#1B365D] font-semibold'
                    : 'border-transparent text-[#52606D]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Focusable view landmark heading for predictable keyboard navigation */}
        <h1
          ref={mainHeadingRef}
          tabIndex={-1}
          className="sr-only focus:outline-none"
        >
          {TAB_TITLES[activeTab]}
        </h1>

        {/* Quiet Unboxed Dataset Context Strip + Assistant Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E5E0D6]">
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-[#52606D] min-w-0">
            <span className="font-mono font-semibold text-[#17202A] truncate max-w-xs">
              {dataset.fileName}
            </span>
            {dataset.selectedSheet && (
              <>
                <span aria-hidden="true">/</span>
                <span className="font-mono text-[#17202A]">{dataset.selectedSheet}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {dataset.rowCount.toLocaleString('en-US')} raw rows × {dataset.columnCount} vars
            </span>
            <span aria-hidden="true">·</span>
            <span>{structureSummaryText}</span>
            {spec.depVar && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-[#1B365D]">
                  Selected model complete cases (before estimation) ={' '}
                  {impact.previewCompleteCasesN.toLocaleString('en-US')}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {previousSpec && (
              <button
                type="button"
                onClick={handleUndoLastApply}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1B365D] bg-white border border-[#CFC7B8] rounded hover:bg-[#F4F1EA] transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Undo Spec Apply</span>
              </button>
            )}

            {!IS_PUBLIC_BUILD && (
              <button
                type="button"
                onClick={() => setAssistantOpen((v) => !v)}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                  assistantOpen
                    ? 'bg-[#1B365D] text-white border-[#1B365D]'
                    : 'bg-white text-[#17202A] border-[#CFC7B8] hover:border-[#1B365D]'
                }`}
              >
                <MessageSquareText className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{assistantOpen ? 'Hide Assistant' : 'AI Assistant'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Active Workspace View */}
        {activeTab === 'inspector' && (
          <InspectorView
            dataset={dataset}
            onUpdateColumnLabel={handleUpdateColumnLabel}
            onUpdatePanelKeys={handleUpdatePanelKeys}
            onUpdateTimeCadence={handleUpdateTimeCadence}
          />
        )}

        {activeTab === 'diagnostics' && (
          <DiagnosticsView
            dataset={dataset}
            diagnostics={diagnostics}
            cleanedRows={cleanedRows}
            cleanedSummaries={cleanedSummaries}
            impact={impact}
            spec={spec}
            onToggleWinsorize={handleToggleWinsorize}
            onToggleLogTransform={handleToggleLogTransform}
            onToggleDropDuplicates={handleToggleDropDuplicates}
            onJumpToStata={() => setActiveTab('stata')}
          />
        )}

        {activeTab === 'suggestions' && (
          <ModelSuggestionsView
            key={dataset.id}
            dataset={dataset}
            cleanedRows={cleanedRows}
            cleanedPanel={impact.cleanedPanel}
            currentSpec={spec}
            onReviewInModelBuilder={handleReviewSuggestionInBuilder}
            onJumpToInspector={() => setActiveTab('inspector')}
          />
        )}

        {activeTab === 'stata' && (
          <StataWorkspaceView
            dataset={dataset}
            diagnostics={diagnostics}
            spec={spec}
            impact={impact}
            onChangeSpec={setSpec}
            onCopyCode={handleCopyCode}
            onDownloadCode={handleDownloadCode}
            onDownloadBlob={handleDownloadBlob}
            copiedKey={copiedKey}
          />
        )}

        {activeTab === 'latex' && (
          <LatexWorkspaceView
            dataset={dataset}
            rawSummaries={diagnostics.summaries}
            rawCorrelation={diagnostics.correlation}
            cleanedSummaries={cleanedSummaries}
            cleanedCorrelation={cleanedCorrelation}
            spec={spec}
            impact={impact}
            config={latexConfig}
            onChangeConfig={setLatexConfig}
            onCopyCode={handleCopyCode}
            onDownloadCode={handleDownloadCode}
            copiedKey={copiedKey}
          />
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-[#E5E0D6] mt-10 py-4 px-6">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-[#7B8794]">
          <span>Folio Econometrics · Client-side CSV &amp; Excel diagnostics for reproducible research</span>
          <span>Stata 17+ .do bundle &amp; LaTeX booktabs / threeparttable export</span>
        </div>
      </footer>

      {/* Collapsible AI Econometric Assistant Drawer (omitted from static public beta builds) */}
      {!IS_PUBLIC_BUILD && LazyAssistantDrawer && (
        <React.Suspense fallback={null}>
          <LazyAssistantDrawer
            isOpen={assistantOpen}
            onClose={() => setAssistantOpen(false)}
            dataset={dataset}
            diagnostics={diagnostics}
            spec={spec}
            postDedupPanelCheck={impact.postDedupPanelCheck}
            messages={messages}
            onAddMessage={(msg) => setMessages((prev) => [...prev, msg])}
            onClearMessages={() =>
              setMessages((prev) => prev.filter((m) => m.datasetId !== dataset.id))
            }
            onApplyPatch={handleApplyPatch}
            canUndo={Boolean(previousSpec)}
            onUndoLastApply={handleUndoLastApply}
            shareMetadataOptIn={shareMetadataOptIn}
            onToggleShareMetadata={setShareMetadataOptIn}
          />
        </React.Suspense>
      )}

      {/* Upload Dataset Modal */}
      <UploadModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDatasetLoaded={handleDatasetLoaded}
        onLoadDemo={handleLoadDemo}
        returnFocusRef={uploadTriggerRef}
      />

      {/* Subtle Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-xs font-medium text-white bg-[#17202A] rounded shadow-md whitespace-nowrap"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
