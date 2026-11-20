import type { PanelDetection } from '../types/econometrics';

/**
 * Shared canonical panel key-validity and balance formatters so Inspector,
 * Diagnostics, Sample Impact, Stata .do comments, and LaTeX table notes
 * never conflate invalid panel keys with unbalanced panels or weakly/strongly
 * balanced panels.
 */

export function describeKeyValidityIssues(panel: PanelDetection): string {
  const parts: string[] = [];
  if (panel.missingKeyRows > 0) {
    parts.push(
      `${panel.missingKeyRows} missing-key row${panel.missingKeyRows === 1 ? '' : 's'} (${panel.missingEntityRows} entity, ${panel.missingTimeRows} time)`
    );
  }
  if (panel.duplicateKeyPairs > 0) {
    const origin =
      panel.distinctKeyConflictRows === 0 && panel.exactDuplicateRows > 0
        ? '; all from exact duplicate rows'
        : panel.distinctKeyConflictRows > 0
          ? `; ${panel.distinctKeyConflictRows} distinct-record conflict${panel.distinctKeyConflictRows === 1 ? '' : 's'}`
          : '';
    parts.push(
      `${panel.repeatedKeyGroups} repeated key group${panel.repeatedKeyGroups === 1 ? '' : 's'}, ${panel.duplicateKeyPairs} excess row${panel.duplicateKeyPairs === 1 ? '' : 's'}${origin}`
    );
  }
  return parts.join('; ');
}

export function formatBalanceLabel(panel: PanelDetection): string {
  switch (panel.balanceStatus) {
    case 'strongly_balanced':
      return 'Strongly balanced';
    case 'weakly_balanced':
      return `Weakly balanced (${panel.minPeriodsPerEntity} periods/unit across ${panel.numPeriods} distinct periods)`;
    case 'unbalanced':
      return `Unbalanced (${panel.minPeriodsPerEntity}–${panel.maxPeriodsPerEntity} periods/unit)`;
    case 'undefined_invalid_keys':
      return 'Balance undefined (invalid keys)';
    case 'not_applicable':
    default:
      return 'Not a panel';
  }
}

/**
 * Concise status badge/headline for Inspector & Sample Impact, always separating
 * researcher confirmation from actual key validity on the current rows.
 */
export function formatPanelStatusHeadline(panel: PanelDetection, rowScopeLabel = 'current rows'): string {
  if (!panel.isPanel || !panel.entityVar || !panel.timeVar) {
    if (panel.structureKind === 'dated_cross_section') {
      return `Dated Cross-Section${panel.uniqueRecordIdVar ? ` · Record ID: ${panel.uniqueRecordIdVar}` : ''}`;
    }
    return `Cross-Section${panel.uniqueRecordIdVar ? ` · Record ID: ${panel.uniqueRecordIdVar}` : ''}`;
  }

  const confirmPrefix = panel.userConfirmed ? 'Keys confirmed' : 'Keys unconfirmed';

  if (panel.panelKeyStatus !== 'valid') {
    const issue = describeKeyValidityIssues(panel);
    return `${confirmPrefix}, invalid on ${rowScopeLabel} (${issue}) · Balance undefined`;
  }

  const balanceLabel = formatBalanceLabel(panel);
  return `${confirmPrefix} & valid · ${balanceLabel} (${panel.numEntities} units × ${panel.numPeriods} periods)`;
}

/**
 * Canonical panel description sentence used in BOTH LaTeX preview notes and
 * exported LaTeX \begin{tablenotes} (word-for-word parity).
 */
export function formatPanelNoteSentence(panel: PanelDetection): string {
  if (panel.isPanel && panel.entityVar && panel.timeVar) {
    if (panel.panelKeyStatus !== 'valid') {
      const issue = describeKeyValidityIssues(panel);
      const confirmText = panel.userConfirmed ? 'confirmed' : 'unconfirmed';
      return `Panel keys (${panel.entityVar}, ${panel.timeVar}; ${confirmText}) are invalid on this sample (${issue}); panel balance is undefined until keys are unique and non-missing.`;
    }

    let balanceDesc = '';
    if (panel.balanceStatus === 'strongly_balanced') {
      balanceDesc = 'strongly balanced';
    } else if (panel.balanceStatus === 'weakly_balanced') {
      balanceDesc = `weakly balanced (every unit observed in ${panel.minPeriodsPerEntity} periods across ${panel.numPeriods} distinct periods)`;
    } else {
      balanceDesc = `unbalanced (${panel.minPeriodsPerEntity}–${panel.maxPeriodsPerEntity} periods per unit)`;
    }

    return `Panel structure: ${panel.numEntities} units (${panel.entityVar}) across ${panel.numPeriods} periods (${panel.timeVar}); valid keys, ${balanceDesc}.`;
  }

  if (panel.structureKind === 'dated_cross_section') {
    const conflictNote =
      panel.distinctKeyConflictRows > 0 && panel.candidateEntityVar && panel.candidateTimeVar
        ? ` Candidate key (${panel.candidateEntityVar}, ${panel.candidateTimeVar}) has ${panel.repeatedKeyGroups} repeated group(s) with ${panel.distinctKeyConflictRows} distinct-record conflict(s).`
        : '';
    return `Observation structure: dated cross-section${panel.uniqueRecordIdVar ? ` (unique record ID: ${panel.uniqueRecordIdVar})` : ''}.${conflictNote}`;
  }

  return '';
}

/**
 * Compact phrase for Stata .do header comments.
 */
export function formatPanelStataSummary(panel: PanelDetection, rowScopeLabel: string): string {
  if (!panel.isPanel || !panel.entityVar || !panel.timeVar) {
    if (panel.structureKind === 'dated_cross_section') {
      return `Dated cross-section${panel.uniqueRecordIdVar ? ` (record ID: ${panel.uniqueRecordIdVar})` : ''} — xtset not applicable`;
    }
    return 'Cross-section — xtset not applicable';
  }
  const confirmText = panel.userConfirmed ? 'confirmed' : 'unconfirmed';
  if (panel.panelKeyStatus !== 'valid') {
    return `(${panel.entityVar}, ${panel.timeVar}) [${confirmText}] — INVALID on ${rowScopeLabel}: ${describeKeyValidityIssues(panel)} (balance undefined; xtset blocked)`;
  }
  return `(${panel.entityVar}, ${panel.timeVar}) [${confirmText}] — valid keys, ${formatBalanceLabel(panel)} (${panel.numEntities} units x ${panel.numPeriods} periods)`;
}
