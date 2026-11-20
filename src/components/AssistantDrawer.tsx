import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Lock,
  RotateCcw,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import type {
  AssistantMessage,
  AssistantReasoningMode,
  AssistantRoleId,
  DatasetState,
  DiagnosticsReport,
  ModelSpec,
  PostDedupPanelCheck,
  SpecProposalPatch,
} from '../types/econometrics';
import {
  buildDatasetDigestForAI,
  validateProposalAgainstDataset,
} from '../lib/specValidator';

interface AssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  dataset: DatasetState;
  diagnostics: DiagnosticsReport;
  spec: ModelSpec;
  postDedupPanelCheck: PostDedupPanelCheck;
  messages: AssistantMessage[];
  onAddMessage: (msg: AssistantMessage) => void;
  onClearMessages: () => void;
  onApplyPatch: (rawPatch: SpecProposalPatch, originDatasetId: string, msgId: string) => void;
  canUndo: boolean;
  onUndoLastApply: () => void;
  shareMetadataOptIn: boolean;
  onToggleShareMetadata: (optIn: boolean) => void;
}

const ROLE_OPTIONS: Array<{
  id: AssistantRoleId;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'econometrician',
    label: 'Applied Microeconometrician',
    shortLabel: 'Econometrician',
    description: 'Diagnostics, transformations, panel estimators & clustered SEs',
  },
  {
    id: 'stata_auditor',
    label: 'Stata 17+ Code Auditor',
    shortLabel: 'Stata Auditor',
    description: 'Import hygiene, %td/%tm/%tq dates, postestimation guards & .do scripts',
  },
  {
    id: 'referee_critic',
    label: 'Identification & Referee Critic',
    shortLabel: 'Referee Critic',
    description: 'Causal threats, attrition bias, FE absorption & robustness checks',
  },
  {
    id: 'latex_editor',
    label: 'LaTeX Publication Editor',
    shortLabel: 'LaTeX Editor',
    description: 'Booktabs/threeparttable layout, sample notes & variable labeling',
  },
];

const REASONING_OPTIONS: Array<{
  id: AssistantReasoningMode;
  label: string;
  model: string;
  hint: string;
}> = [
  {
    id: 'fast',
    label: 'Fast',
    model: 'gemini-3.1-flash-lite',
    hint: 'Quick syntax checks & concise lookups',
  },
  {
    id: 'general',
    label: 'General',
    model: 'gemini-4-hydrogen',
    hint: 'Balanced diagnostics & model sync',
  },
  {
    id: 'interactive',
    label: 'Complex',
    model: 'gemini-4-neon',
    hint: 'Multi-step specification & script iteration',
  },
  {
    id: 'deep',
    label: 'Deep',
    model: 'gemini-4-carbon',
    hint: 'Deep identification & econometric reasoning',
  },
];

export const AssistantDrawer: React.FC<AssistantDrawerProps> = ({
  isOpen,
  onClose,
  dataset,
  diagnostics,
  spec,
  postDedupPanelCheck,
  messages,
  onAddMessage,
  onClearMessages,
  onApplyPatch,
  canUndo,
  onUndoLastApply,
  shareMetadataOptIn,
  onToggleShareMetadata,
}) => {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [roleId, setRoleId] = useState<AssistantRoleId>('econometrician');
  const [reasoningMode, setReasoningMode] = useState<AssistantReasoningMode>('general');
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  // Track active dataset ID and active fetch controller so delayed responses
  // from a previous dataset are immediately aborted and discarded.
  const activeDatasetIdRef = useRef<string>(dataset.id);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    activeDatasetIdRef.current = dataset.id;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSending(false);
  }, [dataset.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const digest = useMemo(
    () => buildDatasetDigestForAI(dataset, diagnostics, spec),
    [dataset, diagnostics, spec]
  );

  // Only render messages belonging to the active dataset
  const activeMessages = useMemo(
    () => messages.filter((m) => m.datasetId === dataset.id),
    [messages, dataset.id]
  );

  const activeRoleMeta =
    ROLE_OPTIONS.find((r) => r.id === roleId) ?? ROLE_OPTIONS[0];
  const activeReasoningMeta =
    REASONING_OPTIONS.find((m) => m.id === reasoningMode) ?? REASONING_OPTIONS[1];

  const starterPrompts = useMemo(() => {
    const primaryVar = diagnostics.summaries[0]?.stataName ?? 'outcome';
    const skewedVar =
      [...diagnostics.summaries].sort((a, b) => Math.abs(b.skewness) - Math.abs(a.skewness))[0]
        ?.stataName ?? primaryVar;

    if (roleId === 'stata_auditor') {
      return [
        'Audit my current Stata specification for postestimation compatibility (VIF, Breusch-Pagan, Hausman)',
        'Write a cleaning script to winsorize extreme outliers at 1% and 99% and handle exact duplicates',
        'Check whether xtset is safe on this dataset or if reghdfe / OLS is safer',
      ];
    }

    if (roleId === 'referee_critic') {
      return [
        'Critique the current specification for omitted-variable bias, attrition, and clustering choices',
        'What robustness checks and alternative fixed-effects structures would a referee ask for?',
        `Evaluate whether ${skewedVar} outliers or functional form could drive main results`,
      ];
    }

    if (roleId === 'latex_editor') {
      return [
        'Recommend publication-ready variable labels and table notes for Table 1 (Summary Statistics)',
        'Which variables should be included in the main descriptive table vs. an online appendix?',
        'How should I explain raw vs. cleaned sample differences and panel balance in threeparttable notes?',
      ];
    }

    return [
      `Check if ${skewedVar} is skewed and suggest a transformation`,
      'Write a cleaning script to winsorize extreme outliers at 1% and 99%',
      dataset.panel.isPanel
        ? 'Suggest a fixed-effects specification with clustered SEs and diagnostics'
        : 'Suggest an OLS specification with robust SEs and VIF/Breusch-Pagan tests',
    ];
  }, [diagnostics.summaries, dataset.panel.isPanel, roleId]);

  if (!isOpen) return null;

  const canSendContext = dataset.isDemo || shareMetadataOptIn;

  const handleSend = async (promptText?: string) => {
    const text = (promptText ?? input).trim();
    if (!text || sending) return;

    const originDatasetId = dataset.id;
    const requestedRole = roleId;
    const requestedMode = reasoningMode;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMsg: AssistantMessage = {
      id: `u_${Date.now()}`,
      datasetId: originDatasetId,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    onAddMessage(userMsg);
    if (!promptText) setInput('');
    setSending(true);

    setTimeout(() => {
      scrollEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 30);

    try {
      const historyPayload = activeMessages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const resp = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          history: historyPayload,
          datasetDigest: canSendContext ? digest : null,
          roleId: requestedRole,
          reasoningMode: requestedMode,
        }),
      });

      // Discard stale response if user switched datasets while request was in flight
      if (activeDatasetIdRef.current !== originDatasetId) {
        return;
      }

      const data = (await resp.json()) as {
        reply?: string;
        hasProposal?: boolean;
        proposal?: SpecProposalPatch | null;
        roleId?: AssistantRoleId;
        reasoningMode?: AssistantReasoningMode;
        modelUsed?: string;
        error?: string;
      };

      if (activeDatasetIdRef.current !== originDatasetId) {
        return;
      }

      if (!resp.ok || data.error) {
        throw new Error(data.error || `Assistant request failed (${resp.status})`);
      }

      onAddMessage({
        id: `a_${Date.now()}`,
        datasetId: originDatasetId,
        role: 'assistant',
        content: data.reply || 'No response text was returned.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        assistantRoleId: data.roleId ?? requestedRole,
        reasoningMode: data.reasoningMode ?? requestedMode,
        modelUsed: data.modelUsed ?? activeReasoningMeta.model,
        rawPatch: data.hasProposal && data.proposal && canSendContext ? data.proposal : null,
        applied: false,
      });

      setTimeout(() => {
        scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } catch (err: unknown) {
      // Ignore intentional aborts caused by switching datasets
      if ((err as { name?: string })?.name === 'AbortError') {
        return;
      }
      if (activeDatasetIdRef.current !== originDatasetId) {
        return;
      }
      onAddMessage({
        id: `err_${Date.now()}`,
        datasetId: originDatasetId,
        role: 'assistant',
        content:
          err instanceof Error
            ? err.message
            : 'Unable to reach the econometric assistant. Please retry.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        error: true,
      });
    } finally {
      if (activeDatasetIdRef.current === originDatasetId) {
        setSending(false);
        abortControllerRef.current = null;
      }
    }
  };

  const handleClear = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSending(false);
    onClearMessages();
  };

  return (
    <aside
      aria-label="AI Econometric Assistant"
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[436px] bg-white border-l border-[#CFC7B8] shadow-xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-[#E5E0D6] bg-[#FAF8F4]">
        <div className="min-w-0">
          <h2 className="font-serif text-base font-semibold text-[#17202A]">
            Econometric Assistant
          </h2>
          <p className="text-[11px] text-[#52606D] truncate">
            Bound to {dataset.fileName} · Live validated sync
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canUndo && (
            <button
              type="button"
              onClick={onUndoLastApply}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#1B365D] bg-white border border-[#CFC7B8] rounded hover:bg-[#F4F1EA] cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            >
              <Undo2 className="w-3 h-3" aria-hidden="true" />
              <span>Undo</span>
            </button>
          )}
          {activeMessages.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear conversation thread"
              title="Reset conversation thread"
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#52606D] bg-white border border-[#CFC7B8] rounded hover:text-[#17202A] hover:bg-[#F4F1EA] cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse Econometric Assistant"
            className="p-1.5 text-[#52606D] hover:text-[#17202A] rounded hover:bg-[#EFECE6] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Role & Reasoning-Mode Controls */}
      <div className="px-5 py-3 border-b border-[#E5E0D6] bg-white space-y-2.5">
        <div>
          <label
            htmlFor="assistant-role-select"
            className="block text-[11px] font-medium text-[#52606D] mb-1"
          >
            Assistant Role
          </label>
          <select
            id="assistant-role-select"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value as AssistantRoleId)}
            className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F4] border border-[#CFC7B8] rounded text-[#17202A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-[#7B8794] mt-1">{activeRoleMeta.description}</p>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="font-medium text-[#52606D]">Reasoning Depth</span>
            <span className="font-mono text-[#7B8794]">{activeReasoningMeta.model}</span>
          </div>
          <div
            role="group"
            aria-label="Assistant reasoning mode"
            className="grid grid-cols-4 gap-1 p-0.5 bg-[#F4F1EA] border border-[#E5E0D6] rounded"
          >
            {REASONING_OPTIONS.map((opt) => {
              const selected = reasoningMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setReasoningMode(opt.id)}
                  className={`py-1 px-1.5 text-[11px] font-medium rounded transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] ${
                    selected
                      ? 'bg-white text-[#1B365D] shadow-xs font-semibold'
                      : 'text-[#52606D] hover:text-[#17202A]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[#7B8794] mt-1">{activeReasoningMeta.hint}</p>
        </div>
      </div>

      {/* Privacy Opt-In & Payload Inspector Bar */}
      <div className="px-5 py-2.5 border-b border-[#E5E0D6] bg-[#FAF8F4]/70 space-y-2">
        {!dataset.isDemo ? (
          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <div className="flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 text-[#1B365D] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="text-xs font-semibold text-[#17202A]">
                  Share dataset metadata with Gemini
                </div>
                <div className="text-[11px] text-[#52606D]">
                  Opt-in for uploaded files. Sends only variable names &amp; aggregated stats (never raw rows).
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={shareMetadataOptIn}
              onChange={(e) => onToggleShareMetadata(e.target.checked)}
              className="mt-1 accent-[#1B365D]"
            />
          </label>
        ) : (
          <div className="flex items-center justify-between text-[11px] text-[#52606D]">
            <span>Demo dataset metadata attached (0 raw rows sent).</span>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setShowPayload((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#1B365D] hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] rounded"
          >
            <Eye className="w-3 h-3" aria-hidden="true" />
            <span>{showPayload ? 'Hide Metadata Payload' : 'Inspect Metadata Payload'}</span>
            {showPayload ? (
              <ChevronUp className="w-3 h-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            )}
          </button>

          {showPayload && (
            <pre className="mt-2 p-2.5 max-h-40 overflow-auto text-[10.5px] font-mono bg-white border border-[#E5E0D6] rounded text-[#52606D]">
              {canSendContext
                ? JSON.stringify(digest, null, 2)
                : '// Metadata sharing is disabled. Only your typed question will be sent.'}
            </pre>
          )}
        </div>
      </div>

      {/* Scrollable Chat Thread */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {activeMessages.length === 0 && (
          <div className="space-y-4">
            <p className="text-xs text-[#52606D] leading-relaxed">
              Multi-turn assistant grounded in your dataset&apos;s schema and diagnostics. Switch specialist roles or reasoning depth above at any point; specification proposals are revalidated live against your Model Builder before applying.
            </p>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-[#52606D]">
                Suggested Prompts ({activeRoleMeta.shortLabel})
              </div>
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => handleSend(prompt)}
                  className="w-full text-left px-3.5 py-2.5 text-xs text-[#17202A] bg-[#FAF8F4] border border-[#E5E0D6] rounded hover:border-[#1B365D] hover:bg-white transition-colors motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeMessages.map((msg) => {
          // Dynamically revalidate rawPatch against the CURRENT dataset & CURRENT spec
          const liveProposal =
            msg.rawPatch && msg.datasetId === dataset.id
              ? validateProposalAgainstDataset(dataset, spec, msg.rawPatch, postDedupPanelCheck)
              : null;

          const msgRoleLabel = msg.assistantRoleId
            ? ROLE_OPTIONS.find((r) => r.id === msg.assistantRoleId)?.shortLabel ?? 'Assistant'
            : 'Assistant';
          const msgModeLabel = msg.reasoningMode
            ? REASONING_OPTIONS.find((m) => m.id === msg.reasoningMode)?.label
            : null;

          return (
            <div key={msg.id} className="space-y-2">
              <div
                className={`rounded-md px-3.5 py-3 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#1B365D] text-white ml-8'
                    : msg.error
                      ? 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] mr-4'
                      : 'bg-[#FAF8F4] text-[#17202A] border border-[#E5E0D6] mr-4'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div
                  className={`mt-1.5 text-[10px] font-mono ${
                    msg.role === 'user' ? 'text-white/70 text-right' : 'text-[#7B8794]'
                  }`}
                >
                  {msg.role === 'user'
                    ? `Researcher · ${msg.timestamp}`
                    : `${msgRoleLabel}${msgModeLabel ? ` · ${msgModeLabel}` : ''} · ${msg.timestamp}`}
                </div>
              </div>

              {/* Live-Revalidated Specification Diff Proposal Card */}
              {liveProposal && (liveProposal.isValid || msg.applied || liveProposal.validationNotes.length > 0) && (
                <div className="mr-4 bg-white border border-[#CFC7B8] rounded-md p-3.5 space-y-2.5">
                  <div>
                    <div className="text-[11px] font-mono text-[#1B365D] font-semibold">
                      Proposed Model Builder Sync
                    </div>
                    <div className="text-xs font-semibold text-[#17202A] mt-0.5">
                      {liveProposal.rawTitle}
                    </div>
                  </div>

                  {liveProposal.diffs.length > 0 ? (
                    <div className="divide-y divide-[#F0ECE4] border-t border-b border-[#EFECE6] text-[11px]">
                      {liveProposal.diffs.map((d, idx) => (
                        <div key={idx} className="py-1.5 space-y-0.5">
                          <div className="font-medium text-[#52606D]">{d.field}</div>
                          <div className="font-mono flex flex-wrap items-center gap-1.5 text-[#17202A]">
                            <span className="text-[#7B8794] line-through">{d.before}</span>
                            <ArrowRight className="w-3 h-3 text-[#1B365D] shrink-0" aria-hidden="true" />
                            <span className="font-semibold text-[#1B365D]">{d.after}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#52606D] border-t border-[#EFECE6] pt-2">
                      Current Model Builder already matches all valid settings in this proposal.
                    </div>
                  )}

                  {liveProposal.validationNotes.length > 0 && (
                    <div className="space-y-1 text-[11px] text-[#B45309]">
                      {liveProposal.validationNotes.map((note, idx) => (
                        <div key={idx} className="flex items-start gap-1.5">
                          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    {!liveProposal.isValid ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#166534]">
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{msg.applied ? 'Applied to Model Builder' : 'Already Active'}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onApplyPatch(msg.rawPatch!, msg.datasetId, msg.id)}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-[#1B365D] rounded hover:bg-[#132847] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
                      >
                        Apply to Model Builder
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {sending && (
          <div className="mr-4 bg-[#FAF8F4] border border-[#E5E0D6] rounded-md px-3.5 py-3 text-xs text-[#52606D]">
            {activeRoleMeta.shortLabel} ({activeReasoningMeta.label}) analyzing…
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-4 border-t border-[#E5E0D6] bg-[#FAF8F4]"
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              canSendContext
                ? `Ask the ${activeRoleMeta.shortLabel}…`
                : 'Enable metadata sharing above for dataset-specific sync, or ask general methodology questions…'
            }
            className="flex-1 px-3 py-2 text-xs bg-white border border-[#CFC7B8] rounded text-[#17202A] placeholder:text-[#7B8794] resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D]"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="Send question"
            className="p-2.5 text-white bg-[#1B365D] rounded hover:bg-[#132847] disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B365D] focus-visible:ring-offset-1"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </aside>
  );
};
