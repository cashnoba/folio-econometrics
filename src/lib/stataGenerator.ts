import type { ColumnProfile, DatasetState, ModelSpec, SampleImpact } from '../types/econometrics';
import { getDiagnosticCompatibility, getTransformedVarName } from './specValidator';
import { getNormalizedCsvFileName } from './zipBundle';
import { formatPanelStataSummary } from './panelStatus';
import { parseStrictNumeric } from './parser';

function stataStringEscape(val: string): string {
  return val.replace(/"/g, "'");
}

function getEffectiveModelVar(varName: string, spec: ModelSpec): string {
  const logMode = spec.logTransforms[varName];
  if (logMode) {
    return getTransformedVarName(varName, logMode);
  }
  return varName;
}

function getStataTimeVarName(col: ColumnProfile): string {
  const base = `${col.stataName}_dt`;
  return base.length <= 32 ? base : `${col.stataName.slice(0, 29)}_dt`;
}

const STATA_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Converts a canonical date string ("2023-01-15", "2023-01", "2023Q1") into
 * a Stata 17 date-literal expression (td(15jan2023), tm(2023m1), tq(2023q1)).
 */
function toStataDateLiteral(canonical: string, cadence: ColumnProfile['confirmedTimeCadence']): string | null {
  const trimmed = canonical.trim();
  if (cadence === 'daily') {
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const year = m[1];
    const monthIdx = Number(m[2]) - 1;
    const day = Number(m[3]);
    if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return null;
    return `td(${day}${STATA_MONTHS[monthIdx]}${year})`;
  }
  if (cadence === 'monthly') {
    const m = trimmed.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
    if (!m) return null;
    const year = m[1];
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return `tm(${year}m${month})`;
  }
  if (cadence === 'quarterly') {
    const q = trimmed.match(/^(\d{4})[Qq]([1-4])$/);
    if (q) return `tq(${q[1]}q${q[2]})`;
    const iso = trimmed.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (iso) {
      const month = Number(iso[2]);
      const qtr = Math.floor((month - 1) / 3) + 1;
      return `tq(${iso[1]}q${qtr})`;
    }
  }
  return null;
}

/**
 * Audits Original Source File import parity against Folio's browser parse.
 * Whenever direct Stata CSV/XLSX ingestion has known conversion limits, surfaces
 * exact reasons and recommends the Normalized Bundle.
 */
export function getOriginalSourceLimitations(dataset: DatasetState): string[] {
  const notes: string[] = [];
  const leadingZeroCols = dataset.columns.filter((c) => c.preserveLeadingZeros);
  const longIdCols = dataset.columns.filter((c) => c.preserveLongId);
  const precisionCols = dataset.columns.filter((c) => c.excelPrecisionDiffCount > 0);
  const renamedCols = dataset.columns.filter((c) => c.wasRenamed);

  if (dataset.sourceFormat === 'xlsx') {
    if (dataset.excelDateSystem === '1904') {
      notes.push(
        'Workbook uses the Excel 1904 (Mac) date system. Direct Stata `import excel` date conversion can diverge on custom/mixed serial formats across workbooks — use the Normalized Bundle for guaranteed ISO-date parity.'
      );
    }
    if (leadingZeroCols.length > 0) {
      notes.push(
        `Zero-padded identifier(s) (${leadingZeroCols.map((c) => c.stataName).join(', ')}) rely on post-import \`tostring, format(...)\` under Original Source XLSX; mixed text/numeric Excel cells can still differ — Normalized Bundle guarantees exact string preservation via \`stringcols()\`.`
      );
    }
    if (longIdCols.length > 0) {
      notes.push(
        `Long 15+ digit identifier(s) (${longIdCols.map((c) => c.stataName).join(', ')}) require text storage in Excel; if any cell was stored numerically by Excel, direct \`import excel\` may round trailing digits — verify or use Normalized Bundle.`
      );
    }
    if (precisionCols.length > 0) {
      notes.push(
        `Stored numeric precision differs from Excel display formatting in ${precisionCols.map((c) => c.stataName).join(', ')}. Direct \`import excel\` reads stored values (without coercing numbers to formatted display text), while Normalized Bundle explicitly enforces \`asdouble\` on import.`
      );
    }
  }

  if (renamedCols.length > 0) {
    notes.push(
      `${renamedCols.length} header(s) were sanitized or deduplicated (${renamedCols.slice(0, 3).map((c) => `"${c.rawName}" -> ${c.stataName}`).join(', ')}${renamedCols.length > 3 ? ', …' : ''}). Original Source mode uses positional renaming; Normalized Bundle ships pre-normalized headers directly.`
    );
  }

  return notes;
}

function getBundleStringColumnIndices(dataset: DatasetState): number[] {
  return dataset.columns
    .filter((c) => c.type !== 'numeric' || c.preserveLeadingZeros || c.preserveLongId)
    .map((c) => c.columnIndex);
}

function emitStataTimeConversionLines(
  col: ColumnProfile,
  importMode: ModelSpec['importMode'],
  sourceFormat: DatasetState['sourceFormat']
): { varName: string; lines: string[] } {
  const outVar = getStataTimeVarName(col);
  const lines: string[] = [];
  const sample = col.sampleValues[0] ?? '';
  const cadence = col.confirmedTimeCadence;

  const isXlsxNativeDate =
    importMode === 'original_source' && sourceFormat === 'xlsx' && col.isExcelDateColumn;

  if (cadence === 'daily') {
    lines.push(`* Convert "${col.stataName}" to Stata daily date (%td)`);
    if (isXlsxNativeDate) {
      lines.push(`capture confirm numeric variable ${col.stataName}`);
      lines.push(`if _rc == 0 {`);
      lines.push(`    gen double ${outVar} = ${col.stataName}`);
      lines.push(`}`);
      lines.push(`else {`);
      lines.push(`    gen double ${outVar} = daily(${col.stataName}, "YMD")`);
      lines.push(`}`);
    } else {
      lines.push(`gen double ${outVar} = daily(${col.stataName}, "YMD")`);
    }
    lines.push(`format ${outVar} %td`);
    lines.push(`label variable ${outVar} "${stataStringEscape(col.label)} (Daily %td)"`);
  } else if (cadence === 'monthly') {
    lines.push(`* Convert "${col.stataName}" to Stata monthly period (%tm)`);
    const looksIsoDaily = /^\d{4}-\d{2}-\d{2}$/.test(sample);
    if (isXlsxNativeDate) {
      lines.push(`capture confirm numeric variable ${col.stataName}`);
      lines.push(`if _rc == 0 {`);
      lines.push(`    gen double ${outVar} = mofd(${col.stataName})`);
      lines.push(`}`);
      lines.push(`else {`);
      lines.push(
        looksIsoDaily
          ? `    gen double ${outVar} = mofd(daily(${col.stataName}, "YMD"))`
          : `    gen double ${outVar} = monthly(${col.stataName}, "YM")`
      );
      lines.push(`}`);
    } else {
      lines.push(
        looksIsoDaily
          ? `gen double ${outVar} = mofd(daily(${col.stataName}, "YMD"))`
          : `gen double ${outVar} = monthly(${col.stataName}, "YM")`
      );
    }
    lines.push(`format ${outVar} %tm`);
    lines.push(`label variable ${outVar} "${stataStringEscape(col.label)} (Monthly %tm)"`);
  } else if (cadence === 'quarterly') {
    lines.push(`* Convert "${col.stataName}" to Stata quarterly period (%tq)`);
    const looksIsoDaily = /^\d{4}-\d{2}-\d{2}$/.test(sample);
    if (isXlsxNativeDate) {
      lines.push(`capture confirm numeric variable ${col.stataName}`);
      lines.push(`if _rc == 0 {`);
      lines.push(`    gen double ${outVar} = qofd(${col.stataName})`);
      lines.push(`}`);
      lines.push(`else {`);
      lines.push(
        looksIsoDaily
          ? `    gen double ${outVar} = qofd(daily(${col.stataName}, "YMD"))`
          : `    gen double ${outVar} = quarterly(${col.stataName}, "YQ")`
      );
      lines.push(`}`);
    } else {
      lines.push(
        looksIsoDaily
          ? `gen double ${outVar} = qofd(daily(${col.stataName}, "YMD"))`
          : `gen double ${outVar} = quarterly(${col.stataName}, "YQ")`
      );
    }
    lines.push(`format ${outVar} %tq`);
    lines.push(`label variable ${outVar} "${stataStringEscape(col.label)} (Quarterly %tq)"`);
  }

  return { varName: outVar, lines };
}

/**
 * Generates reproducible, executable Stata 17+ .do scripts with:
 *  - `set type double` + `asdouble` on Normalized Bundle CSV import
 *  - `stringcols(...)` for ALL non-numeric schema columns (identifiers, leading-zero IDs,
 *    long 15+ digit IDs, categorical strings, and canonical dates)
 *  - Explicit Original Source File parity audit & recommendation for Normalized Bundle
 *  - Stata %td / %tm / %tq conversions for confirmed daily/monthly/quarterly dates
 *  - `xtset` gated strictly by commands that require it AND confirmed, valid keys post-dedup
 *  - Optional diagnostics wrapped in `capture noisily { ... }` so they can never prevent
 *    the primary model (`m_main`) and `esttab` export from completing
 */
export function generateStataDoFile(
  dataset: DatasetState,
  spec: ModelSpec,
  impact: SampleImpact
): string {
  const lines: string[] = [];
  const compat = getDiagnosticCompatibility(dataset, spec, impact.postDedupPanelCheck);
  const normalizedCsvName = getNormalizedCsvFileName(dataset);

  // Determine exact community packages needed
  const requiredPackages: Array<{ pkg: string; why: string }> = [];
  if (spec.winsorizeVars.length > 0) {
    requiredPackages.push({ pkg: 'winsor2', why: 'tail winsorization' });
  }
  if (spec.estimator === 'fe_reghdfe' && !impact.suitability.modelBlocked) {
    requiredPackages.push({ pkg: 'ftools', why: 'required dependency for reghdfe' });
    requiredPackages.push({ pkg: 'reghdfe', why: 'high-dimensional fixed effects & multi-way clustering' });
  }
  if (spec.diagnostics.esttab && !impact.suitability.modelBlocked) {
    requiredPackages.push({ pkg: 'estout', why: 'publication-ready esttab regression tables' });
  }

  lines.push('* ==============================================================================');
  lines.push('* Folio Econometrics — Reproducible Stata 17+ Analysis Script');
  lines.push(
    `* Source Dataset: ${dataset.fileName}${dataset.selectedSheet ? ` (Sheet: ${dataset.selectedSheet})` : ''}`
  );
  if (dataset.excelDateSystem) {
    lines.push(`* Excel Workbook Date System: ${dataset.excelDateSystem}`);
  }
  lines.push(
    `* Import Mode: ${
      spec.importMode === 'normalized_bundle'
        ? `Folio Normalized CSV Bundle (${normalizedCsvName})`
        : `Original Source File with Executable Import Hygiene (${dataset.fileName})`
    }`
  );
  lines.push(
    `* Raw Rows: ${impact.startingN.toLocaleString('en-US')} | Cleaned Rows: ${impact.afterExactDuplicatesN.toLocaleString('en-US')} | Variables: ${dataset.columnCount}`
  );
  lines.push(`* Raw Panel Check:     ${formatPanelStataSummary(dataset.panel, 'raw rows')}`);
  lines.push(`* Cleaned Panel Check: ${formatPanelStataSummary(impact.cleanedPanel, 'cleaned rows')}`);
  if (spec.depVar) {
    lines.push(
      `* Complete Cases Before Estimation (Selected Model Preview): ${impact.previewCompleteCasesN.toLocaleString('en-US')}`
    );
    if (spec.estimator === 'fe_reghdfe') {
      lines.push(
        '* Note: reghdfe may additionally drop singleton fixed-effect groups; compare with fitted e(N) printed below.'
      );
    }
  }
  lines.push('* Run from extracted bundle folder: cd "/path/to/folder" then do "<script>.do"');
  lines.push('* ==============================================================================');
  lines.push('');
  lines.push('version 17.0');
  lines.push('clear all');
  lines.push('set type double');
  lines.push('set more off');
  lines.push('capture log close');
  lines.push('');

  if (requiredPackages.length > 0) {
    lines.push('* ------------------------------------------------------------------------------');
    lines.push('* 0. Community Package Prerequisites (uncomment once on a fresh Stata install)');
    lines.push('* ------------------------------------------------------------------------------');
    for (const item of requiredPackages) {
      lines.push(`* ssc install ${item.pkg}, replace   // ${item.why}`);
    }
    lines.push('');
  }

  // Section 1: Executable Data Import & Browser-to-Stata Parity
  lines.push('* ------------------------------------------------------------------------------');
  lines.push('* 1. Data Ingestion & Browser-to-Stata Parity');
  lines.push('* ------------------------------------------------------------------------------');

  const leadingZeroCols = dataset.columns.filter((c) => c.preserveLeadingZeros);
  const numericCols = dataset.columns.filter((c) => c.type === 'numeric');
  const renamedCols = dataset.columns.filter((c) => c.wasRenamed);

  if (spec.importMode === 'normalized_bundle') {
    const stringColIndices = getBundleStringColumnIndices(dataset);
    const stringColsOpt =
      stringColIndices.length > 0 ? ` stringcols(${stringColIndices.join(' ')})` : '';
    lines.push(
      `* Uses Folio's normalized CSV (${normalizedCsvName}) included in the Stata Bundle (.zip).`
    );
    lines.push(
      '* Explicit `asdouble` preserves full 64-bit IEEE-754 numeric precision; `stringcols(...)`'
    );
    lines.push(
      '* preserves every text, categorical, date, leading-zero ID, and long-integer ID column.'
    );
    lines.push(
      `import delimited using "${stataStringEscape(normalizedCsvName)}", varnames(1) bindquote(strict) encoding(UTF-8) asdouble${stringColsOpt} clear`
    );
    if (stringColIndices.length > 0) {
      const stringNames = dataset.columns
        .filter((c) => stringColIndices.includes(c.columnIndex))
        .map((c) => c.stataName)
        .join(', ');
      lines.push(`* Columns forced as string via stringcols(${stringColIndices.join(' ')}): ${stringNames}`);
    }
  } else if (dataset.sourceFormat === 'xlsx') {
    const limitations = getOriginalSourceLimitations(dataset);
    if (limitations.length > 0) {
      lines.push('* ORIGINAL SOURCE XLSX PARITY NOTES (Normalized Bundle recommended for guaranteed parity):');
      for (const note of limitations) {
        lines.push(`*   - ${note}`);
      }
      lines.push('');
    }
    const safeFile = stataStringEscape(dataset.fileName);
    const sheetArg = dataset.selectedSheet
      ? ` sheet("${stataStringEscape(dataset.selectedSheet)}")`
      : '';
    lines.push('* Imports Excel with stored numeric precision (avoids rounding from display formats)');
    lines.push(`import excel using "${safeFile}",${sheetArg} firstrow clear`);
    lines.push('');
    lines.push('* Enforce Folio column names by position (prevents header collision or truncation drift)');
    lines.push('quietly ds');
    lines.push('local _folio_rawvars `r(varlist)\'');
    lines.push('local _folio_idx = 1');
    lines.push('foreach _v of local _folio_rawvars {');
    lines.push('    rename `_v\' __folio_c`_folio_idx\'');
    lines.push('    local ++_folio_idx');
    lines.push('}');
    for (const col of dataset.columns) {
      const mappingComment = col.wasRenamed
        ? `   // from raw header "${stataStringEscape(col.rawName)}"`
        : '';
      lines.push(`rename __folio_c${col.columnIndex} ${col.stataName}${mappingComment}`);
    }

    if (leadingZeroCols.length > 0) {
      lines.push('');
      lines.push('* Preserve zero-padded identifier columns as strings');
      for (const col of leadingZeroCols) {
        const padFmt = col.zeroPadWidth ? ` format(%0${col.zeroPadWidth}.0f)` : '';
        lines.push(`capture confirm numeric variable ${col.stataName}`);
        lines.push(`if _rc == 0 tostring ${col.stataName}, replace${padFmt}`);
      }
    }

    lines.push('');
    lines.push('* Normalize standard missing-value tokens on string variables identically to Folio');
    lines.push('quietly ds, has(type string)');
    lines.push('foreach _v in `r(varlist)\' {');
    lines.push(
      '    quietly replace `_v\' = "" if inlist(lower(strtrim(`_v\')), "na", "n/a", ".", "null", "nan")'
    );
    lines.push('}');

    if (numericCols.length > 0) {
      lines.push('');
      lines.push('* Destring inferred numeric columns that imported as string due to text missing tokens');
      for (const col of numericCols) {
        lines.push(`capture confirm string variable ${col.stataName}`);
        lines.push(`if _rc == 0 destring ${col.stataName}, replace ignore(",")`);
        lines.push(`capture recast double ${col.stataName}`);
      }
    }
  } else {
    const safeFile = stataStringEscape(dataset.fileName);
    lines.push('* Imports all CSV columns as string first so Folio can enforce exact positional column names,');
    lines.push('* missing-value tokens, leading-zero / long IDs, and double-precision numeric conversion.');
    lines.push(
      `import delimited using "${safeFile}", varnames(1) bindquote(strict) encoding(UTF-8) stringcols(_all) clear`
    );

    lines.push('');
    lines.push('* Enforce Folio column names by position (prevents header collision or truncation drift)');
    lines.push('quietly ds');
    lines.push('local _folio_rawvars `r(varlist)\'');
    lines.push('local _folio_idx = 1');
    lines.push('foreach _v of local _folio_rawvars {');
    lines.push('    rename `_v\' __folio_c`_folio_idx\'');
    lines.push('    local ++_folio_idx');
    lines.push('}');
    for (const col of dataset.columns) {
      const mappingComment = col.wasRenamed
        ? `   // from raw header "${stataStringEscape(col.rawName)}"`
        : '';
      lines.push(`rename __folio_c${col.columnIndex} ${col.stataName}${mappingComment}`);
    }

    lines.push('');
    lines.push('* Normalize standard missing-value tokens identically to Folio');
    lines.push('foreach _v of varlist _all {');
    lines.push(
      '    quietly replace `_v\' = "" if inlist(lower(strtrim(`_v\')), "na", "n/a", ".", "null", "nan")'
    );
    lines.push('}');

    if (numericCols.length > 0) {
      lines.push('');
      lines.push('* Convert inferred numeric columns to double precision (leaving IDs & strings intact)');
      lines.push(
        `destring ${numericCols.map((c) => c.stataName).join(' ')}, replace ignore(",")`
      );
      lines.push(`recast double ${numericCols.map((c) => c.stataName).join(' ')}`);
    }
  }

  if (spec.importMode === 'normalized_bundle' && renamedCols.length > 0) {
    lines.push('');
    lines.push('* Column normalization applied when generating the bundle CSV:');
    for (const col of renamedCols) {
      lines.push(`*   "${stataStringEscape(col.rawName)}" -> ${col.stataName}`);
    }
  }

  lines.push('');
  lines.push('* Assign single-source variable labels');
  for (const col of dataset.columns) {
    lines.push(`label variable ${col.stataName} "${stataStringEscape(col.label)}"`);
  }
  lines.push('');

  // Emit Stata time conversions & display formats (%td, %tm, %tq) for confirmed date cadences
  const convertedTimeVarMap = new Map<string, string>();
  const cadenceDateCols = dataset.columns.filter(
    (c) =>
      c.type === 'date' &&
      (c.confirmedTimeCadence === 'daily' ||
        c.confirmedTimeCadence === 'monthly' ||
        c.confirmedTimeCadence === 'quarterly')
  );

  if (cadenceDateCols.length > 0) {
    lines.push('* ------------------------------------------------------------------------------');
    lines.push('* 1b. Canonical Time Conversions & Stata Display Formats (%td / %tm / %tq)');
    lines.push('* ------------------------------------------------------------------------------');
    for (const col of cadenceDateCols) {
      const conv = emitStataTimeConversionLines(col, spec.importMode, dataset.sourceFormat);
      convertedTimeVarMap.set(col.stataName, conv.varName);
      lines.push(...conv.lines);
      lines.push('');
    }
  }

  // Section 2: Data Cleaning & Transformations
  lines.push('* ------------------------------------------------------------------------------');
  lines.push('* 2. Data Quality, Cleaning & Variable Transformations');
  lines.push('* ------------------------------------------------------------------------------');

  lines.push('duplicates report');
  if (spec.dropExactDuplicates) {
    lines.push(
      `duplicates drop   // Removes ${impact.exactDuplicatesRemoved} exact duplicate observation(s)`
    );
  } else {
    lines.push('* Exact duplicate removal disabled; inspect output of duplicates report above.');
  }
  lines.push('');

  if (spec.winsorizeVars.length > 0) {
    const lo = spec.winsorizeLevel;
    const hi = 100 - lo;
    lines.push(`* Winsorize heavy-tailed variables at ${lo}% and ${hi}% (in-place, preserving N)`);
    lines.push(`winsor2 ${spec.winsorizeVars.join(' ')}, replace cuts(${lo} ${hi})`);
    lines.push('');
  }

  const logEntries = Object.entries(spec.logTransforms);
  if (logEntries.length > 0) {
    lines.push('* Skewness & Elasticity Transformations');
    for (const [varName, mode] of logEntries) {
      const col = dataset.columns.find((c) => c.stataName === varName);
      const targetName = getTransformedVarName(varName, mode);
      const baseLabel = col ? stataStringEscape(col.label) : varName;
      if (mode === 'ln') {
        if (col && col.nonPositiveCount > 0) {
          lines.push(
            `* WARNING: ${varName} has ${col.nonPositiveCount} value(s) <= 0; strict ln() sets those to missing.`
          );
        }
        lines.push(`gen double ${targetName} = ln(${varName})`);
        lines.push(`label variable ${targetName} "Log ${baseLabel}"`);
      } else if (mode === 'ln1p') {
        if (col && col.leqNegOneCount > 0) {
          lines.push(
            `* WARNING: ${varName} has ${col.leqNegOneCount} value(s) <= -1; ln(x + 1) sets those to missing.`
          );
        } else {
          lines.push('* Using ln(x + 1) — valid for all x > -1 (0 new missing values)');
        }
        lines.push(`gen double ${targetName} = ln(${varName} + 1)`);
        lines.push(`label variable ${targetName} "Log(1 + ${baseLabel})"`);
      } else {
        lines.push('* Using inverse hyperbolic sine asinh(x) — defined for all real numbers');
        lines.push(`gen double ${targetName} = asinh(${varName})`);
        lines.push(`label variable ${targetName} "IHS ${baseLabel}"`);
      }
    }
    lines.push('');
  }

  // Section 3: Panel Encoding & Guarded xtset (ONLY when required, confirmed, unique & non-missing post-dedup!)
  const rawEntityVar = dataset.panel.entityVar ?? '';
  const rawTimeVar = dataset.panel.timeVar ?? '';
  const effectiveTimeVar = convertedTimeVarMap.get(rawTimeVar) ?? rawTimeVar;
  let effectiveEntityId = rawEntityVar;

  const needsXtset =
    !impact.suitability.modelBlocked &&
    (spec.estimator === 'fe_xtreg' ||
      spec.estimator === 're_xtreg' ||
      (spec.diagnostics.hausman && compat.hausmanMode !== 'unavailable'));

  const entityUsedInModel =
    Boolean(rawEntityVar) &&
    (needsXtset ||
      (spec.estimator === 'fe_reghdfe' && spec.absorbVars.includes(rawEntityVar)) ||
      spec.seType === 'cluster_entity' ||
      spec.seType === 'cluster_twoway');

  const needsEntityEncode = Boolean(
    rawEntityVar && dataset.panel.entityIsString && entityUsedInModel
  );

  if (needsEntityEncode) {
    effectiveEntityId = `${rawEntityVar}_id`;
    if (effectiveEntityId.length > 32) {
      effectiveEntityId = `${rawEntityVar.slice(0, 29)}_id`;
    }
  }

  if (needsEntityEncode || needsXtset) {
    lines.push('* ------------------------------------------------------------------------------');
    lines.push('* 3. Panel Identifier Encoding & Guarded xtset');
    lines.push('* ------------------------------------------------------------------------------');

    if (needsEntityEncode) {
      lines.push(`* Encode string entity identifier "${rawEntityVar}" to numeric ID`);
      lines.push(`encode ${rawEntityVar}, gen(${effectiveEntityId})`);
      lines.push(
        `label variable ${effectiveEntityId} "Encoded ${stataStringEscape(rawEntityVar)} ID"`
      );
    }

    if (needsXtset) {
      if (!dataset.panel.userConfirmed || !dataset.panel.isPanel) {
        lines.push('* xtset SKIPPED: Panel keys are not confirmed in Folio Inspector.');
      } else if (impact.postDedupPanelCheck.missingKeyRows > 0) {
        lines.push(
          `* xtset SKIPPED: ${impact.postDedupPanelCheck.missingKeyRows} row(s) have missing (${rawEntityVar}, ${rawTimeVar}) keys.`
        );
      } else if (impact.postDedupPanelCheck.duplicateKeyPairs > 0) {
        lines.push(
          `* xtset SKIPPED: ${impact.postDedupPanelCheck.repeatedKeyGroups} repeated key group(s) (${impact.postDedupPanelCheck.duplicateKeyPairs} excess rows) remain after deduplication.`
        );
        lines.push(
          '* Stata xtset aborts with r(451) on repeated time values within panel. Audit pairs below:'
        );
        lines.push(`duplicates tag ${effectiveEntityId} ${effectiveTimeVar}, gen(_dup_panel_key)`);
        lines.push('tab _dup_panel_key');
      } else {
        lines.push(`xtset ${effectiveEntityId} ${effectiveTimeVar}`);
        lines.push('xtdescribe');
      }
    } else if (spec.estimator === 'fe_reghdfe') {
      lines.push(
        '* Note: xtset is not required for reghdfe and is omitted unless Hausman testing is enabled.'
      );
    }
    lines.push('');
  }

  // Section 4: Exploratory Summary & Correlation Diagnostics (always valid even if regression is blocked)
  const validNumericVars = numericCols
    .filter((c) => !c.isAllMissing)
    .map((c) => c.stataName);

  lines.push('* ------------------------------------------------------------------------------');
  lines.push('* 4. Exploratory Summary Statistics & Multicollinearity Screening');
  lines.push('* ------------------------------------------------------------------------------');
  if (validNumericVars.length > 0) {
    const summaryVarList = validNumericVars.join(' ');
    lines.push(`summarize ${summaryVarList}, detail`);
    lines.push(`tabstat ${summaryVarList}, statistics(n mean sd min p25 median p75 max) columns(statistics)`);
    if (validNumericVars.length >= 2) {
      lines.push(`pwcorr ${summaryVarList}, obs sig star(0.05)`);
    }
  } else {
    lines.push('* No non-missing numeric variables available for summary statistics.');
  }
  lines.push('');

  // Section 5: Econometric Specification & Estimation
  lines.push('* ------------------------------------------------------------------------------');
  lines.push('* 5. Econometric Estimation');
  lines.push('* ------------------------------------------------------------------------------');

  if (!spec.depVar || spec.indepVars.length === 0) {
    lines.push('* Select a dependent variable (Y) and at least one independent regressor (X)');
    lines.push('* in the Model Builder to generate your regression estimation commands.');
    lines.push('');
    return lines.join('\n');
  }

  if (impact.suitability.modelBlocked) {
    lines.push('* MODEL EXPORT BLOCKED — Resolve the following suitability issue(s) before fitting:');
    for (const reason of impact.suitability.blockingReasons) {
      lines.push(`*   - ${reason}`);
    }
    lines.push('* Descriptive diagnostics above remain valid and executable.');
    lines.push('');
    return lines.join('\n');
  }

  const depModelVar = getEffectiveModelVar(spec.depVar, spec);
  const indepModelVars = spec.indepVars.map((v) => getEffectiveModelVar(v, spec));
  const rhs = indepModelVars.join(' ');

  const resolvedAbsorbVars = spec.absorbVars.map((v) => {
    if (v === rawEntityVar && needsEntityEncode) return effectiveEntityId;
    if (convertedTimeVarMap.has(v)) return convertedTimeVarMap.get(v)!;
    return v;
  });

  let vceOption = '';
  if (spec.seType === 'robust') {
    vceOption = 'vce(robust)';
  } else if (spec.seType === 'cluster_entity' && effectiveEntityId) {
    vceOption = `vce(cluster ${effectiveEntityId})`;
  } else if (spec.seType === 'cluster_twoway' && effectiveEntityId && effectiveTimeVar) {
    vceOption =
      spec.estimator === 'fe_reghdfe'
        ? `vce(cluster ${effectiveEntityId} ${effectiveTimeVar})`
        : `vce(cluster ${effectiveEntityId})`;
  }

  lines.push('estimates clear');
  lines.push('');

  if (spec.estimator === 'ols') {
    const optStr = vceOption ? `, ${vceOption}` : '';
    lines.push('* Baseline OLS Specification (no xtset required)');
    lines.push(`regress ${depModelVar} ${rhs}${optStr}`);
    lines.push('estimates store m_main');
  } else if (spec.estimator === 'fe_xtreg') {
    const optStr = vceOption ? `, fe ${vceOption}` : ', fe';
    lines.push('* Panel Entity Fixed Effects (Within Estimator)');
    lines.push(`xtreg ${depModelVar} ${rhs}${optStr}`);
    lines.push('estimates store m_main');
  } else if (spec.estimator === 're_xtreg') {
    const optStr = vceOption ? `, re ${vceOption}` : ', re';
    lines.push('* Panel Random Effects (GLS Estimator)');
    lines.push(`xtreg ${depModelVar} ${rhs}${optStr}`);
    lines.push('estimates store m_main');
  } else {
    const absorbClause =
      resolvedAbsorbVars.length > 0
        ? `absorb(${resolvedAbsorbVars.join(' ')})`
        : 'noabsorb';
    const optParts = [absorbClause];
    if (vceOption) optParts.push(vceOption);
    lines.push('* High-Dimensional Fixed Effects (reghdfe)');
    lines.push(`reghdfe ${depModelVar} ${rhs}, ${optParts.join(' ')}`);
    lines.push('estimates store m_main');
  }

  lines.push('');
  lines.push('* Report fitted estimation sample e(N) separately from Folio pre-estimation preview');
  lines.push(
    `display as result "Folio Verification — Pre-estimation complete-case preview = ${impact.previewCompleteCasesN.toLocaleString('en-US')}"`
  );
  lines.push(
    'display as result "Folio Verification — Fitted e(N)                        = " %12.0fc e(N)'
  );
  if (spec.estimator === 'fe_reghdfe') {
    lines.push('capture confirm scalar e(N_full)');
    lines.push('if _rc == 0 {');
    lines.push(
      '    display as result "Folio Verification — Singletons dropped by reghdfe     = " %12.0fc (e(N_full) - e(N))'
    );
    lines.push('}');
    lines.push(
      `if e(N) < ${impact.previewCompleteCasesN} display as text "Note: Fitted e(N) is smaller than pre-estimation complete cases because reghdfe drops singleton FE groups or collinear observations."`
    );
  } else {
    lines.push(
      `if e(N) != ${impact.previewCompleteCasesN} display as text "Note: Difference between fitted e(N) and pre-estimation complete cases reflects estimator-specific exclusions (e.g., collinearity or singleton groups)."`
    );
  }
  lines.push('');

  // Section 6: Guarded Optional Post-Estimation Diagnostics
  // Every optional diagnostic runs inside `capture noisily { ... }` so a diagnostic failure
  // can NEVER prevent the primary model (`m_main`) and `esttab` export from completing.
  const anyDiag =
    (spec.diagnostics.vif && compat.vifMode !== 'unavailable') ||
    (spec.diagnostics.breuschPagan && compat.bpMode !== 'unavailable') ||
    (spec.diagnostics.hausman && compat.hausmanMode !== 'unavailable');

  if (anyDiag) {
    lines.push('* ------------------------------------------------------------------------------');
    lines.push('* 6. Optional Post-Estimation Diagnostics (capture-guarded; never halts export)');
    lines.push('* ------------------------------------------------------------------------------');

    if (spec.diagnostics.vif && compat.vifMode !== 'unavailable') {
      lines.push('* Optional Diagnostic: Variance Inflation Factors (rule of thumb: VIF < 10)');
      lines.push('capture noisily {');
      if (compat.vifMode === 'direct') {
        lines.push('    estat vif');
      } else {
        lines.push('    * Auxiliary OLS block for VIF (estat vif is only supported after regress)');
        lines.push(`    quietly regress ${depModelVar} ${rhs}`);
        lines.push('    estat vif');
      }
      lines.push('}');
      lines.push(
        'if _rc != 0 display as error "Optional VIF diagnostic returned r(" _rc "); continuing to main export."'
      );
      lines.push('');
    }

    if (spec.diagnostics.breuschPagan && compat.bpMode !== 'unavailable') {
      lines.push('* Optional Diagnostic: Breusch-Pagan / Cook-Weisberg Heteroskedasticity Test');
      lines.push('capture noisily {');
      if (compat.bpMode === 'direct') {
        lines.push('    estat hettest');
      } else {
        lines.push('    * Auxiliary homoskedastic OLS block (estat hettest rejects vce(robust)/cluster)');
        lines.push(`    quietly regress ${depModelVar} ${rhs}`);
        lines.push('    estat hettest');
      }
      lines.push('}');
      lines.push(
        'if _rc != 0 display as error "Optional Breusch-Pagan diagnostic returned r(" _rc "); continuing to main export."'
      );
      lines.push('');
    }

    if (spec.diagnostics.hausman && compat.hausmanMode !== 'unavailable') {
      lines.push('* Optional Diagnostic: Hausman Specification Test (Fixed Effects vs. Random Effects)');
      if (compat.hausmanMode === 'classical_block') {
        lines.push('* Note: Classical hausman requires non-robust/non-clustered FE and RE models.');
        lines.push('* Under clustered errors, consider Mundlak (correlated random effects) or xtoverid.');
      }
      lines.push('capture noisily {');
      lines.push(`    quietly xtreg ${depModelVar} ${rhs}, fe`);
      lines.push('    estimates store fe_hausman');
      lines.push(`    quietly xtreg ${depModelVar} ${rhs}, re`);
      lines.push('    estimates store re_hausman');
      lines.push('    hausman fe_hausman re_hausman, sigmamore');
      lines.push('}');
      lines.push(
        'if _rc != 0 display as error "Optional Hausman diagnostic returned r(" _rc "); continuing to main export."'
      );
      lines.push('');
    }

    lines.push('* Restore primary model estimates as active result before table export');
    lines.push('estimates restore m_main');
    lines.push('');
  }

  // Section 7: Publication Table Export (esttab)
  if (spec.diagnostics.esttab) {
    lines.push('* ------------------------------------------------------------------------------');
    lines.push('* 7. Publication Table Export (esttab)');
    lines.push('* ------------------------------------------------------------------------------');
    const feNote =
      spec.estimator === 'fe_reghdfe' && resolvedAbsorbVars.length > 0
        ? `Fixed effects: ${resolvedAbsorbVars.join(', ')}.`
        : spec.estimator === 'fe_xtreg'
          ? 'Entity fixed effects included.'
          : '';
    lines.push(
      'esttab m_main using "regression_results.tex", replace booktabs label se star(* 0.10 ** 0.05 *** 0.01) ///'
    );
    lines.push(
      '    b(3) se(3) stats(N r2_a, fmt(%9.0fc %9.3f) labels("Observations" "Adj. R-squared")) ///'
    );
    lines.push(
      `    title("Econometric Estimation Results") addnotes("Standard errors in parentheses. ${stataStringEscape(feNote)}")`
    );
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generates a standalone Stata 17+ verification do-file (`*_verify.do`) containing
 * literal `assert` statements for imported row counts, variable storage types, double
 * precision cell values, leading-zero & long text IDs, missingness, renamed headers,
 * converted %td/%tm/%tq dates, duplicate & key checkpoints, and pre-estimation
 * complete-case counts (plus printing fitted e(N) separately).
 */
export function generateStataVerificationDoFile(
  dataset: DatasetState,
  spec: ModelSpec,
  impact: SampleImpact
): string {
  const lines: string[] = [];
  const normalizedCsvName = getNormalizedCsvFileName(dataset);
  const stringColIndices = getBundleStringColumnIndices(dataset);
  const stringColsOpt =
    stringColIndices.length > 0 ? ` stringcols(${stringColIndices.join(' ')})` : '';

  lines.push('* ==============================================================================');
  lines.push('* Folio Econometrics — Standalone Stata 17+ Verification Suite');
  lines.push(
    `* Dataset: ${dataset.fileName}${dataset.selectedSheet ? ` (Sheet: ${dataset.selectedSheet})` : ''}`
  );
  lines.push(`* Bundle CSV: ${normalizedCsvName}`);
  lines.push('* Run from the extracted bundle folder: do "<stem>_verify.do"');
  lines.push('* Fails immediately with a nonzero return code if any assertion disagrees.');
  lines.push('* ==============================================================================');
  lines.push('');
  lines.push('version 17.0');
  lines.push('clear all');
  lines.push('set type double');
  lines.push('set more off');
  lines.push('');

  lines.push('* 1. Import Normalized Bundle CSV with explicit double precision & stringcols');
  lines.push(
    `import delimited using "${stataStringEscape(normalizedCsvName)}", varnames(1) bindquote(strict) encoding(UTF-8) asdouble${stringColsOpt} clear`
  );
  lines.push('');

  lines.push('* 2. Assert exact imported observation count & variable schema');
  lines.push(`assert _N == ${dataset.rowCount}`);
  for (const col of dataset.columns) {
    lines.push(`confirm variable ${col.stataName}`);
    if (col.type === 'numeric' && !col.isAllMissing) {
      lines.push(`confirm numeric variable ${col.stataName}`);
      const hasFractional = dataset.rows.some((r) => {
        const num = parseStrictNumeric(r[col.stataName] ?? '');
        return num !== null && !Number.isInteger(num);
      });
      if (hasFractional) {
        lines.push(`assert "\`: type ${col.stataName}'" == "double"`);
      }
    } else if (col.type !== 'numeric') {
      lines.push(`confirm string variable ${col.stataName}`);
    }
  }
  lines.push('');

  lines.push('* 3. Assert exact missing-value counts per variable');
  for (const col of dataset.columns) {
    lines.push(`quietly count if missing(${col.stataName})`);
    lines.push(`assert r(N) == ${col.missingCount}`);
  }
  lines.push('');

  lines.push('* 4. Assert literal imported cell values (full double precision & exact text IDs)');
  for (const col of dataset.columns) {
    if (col.isAllMissing) continue;
    // Find first non-missing row (1-based Stata index)
    let firstIdx = -1;
    let firstVal = '';
    for (let i = 0; i < dataset.rows.length; i++) {
      const v = (dataset.rows[i][col.stataName] ?? '').trim();
      if (v !== '') {
        firstIdx = i + 1;
        firstVal = v;
        break;
      }
    }
    if (firstIdx < 0) continue;

    if (col.type === 'numeric') {
      const num = parseStrictNumeric(firstVal);
      if (num !== null) {
        if (Math.abs(num) < 1e-15) {
          lines.push(`assert abs(${col.stataName}[${firstIdx}]) < 1e-12`);
        } else {
          lines.push(`assert reldif(${col.stataName}[${firstIdx}], ${firstVal}) < 1e-12`);
        }
      }
    } else {
      lines.push(`assert ${col.stataName}[${firstIdx}] == "${stataStringEscape(firstVal)}"`);
    }
  }
  lines.push('');

  // 5. Confirmed date/period conversions
  const convertedTimeVarMap = new Map<string, string>();
  const cadenceDateCols = dataset.columns.filter(
    (c) =>
      c.type === 'date' &&
      (c.confirmedTimeCadence === 'daily' ||
        c.confirmedTimeCadence === 'monthly' ||
        c.confirmedTimeCadence === 'quarterly')
  );

  if (cadenceDateCols.length > 0) {
    lines.push('* 5. Assert Stata date/period conversions (%td / %tm / %tq)');
    for (const col of cadenceDateCols) {
      const conv = emitStataTimeConversionLines(col, 'normalized_bundle', dataset.sourceFormat);
      convertedTimeVarMap.set(col.stataName, conv.varName);
      lines.push(...conv.lines);
      const expectedFmt =
        col.confirmedTimeCadence === 'daily'
          ? '%td'
          : col.confirmedTimeCadence === 'monthly'
            ? '%tm'
            : '%tq';
      lines.push(`assert "\`: format ${conv.varName}'" == "${expectedFmt}"`);

      // Literal check on first non-missing date cell
      for (let i = 0; i < dataset.rows.length; i++) {
        const v = (dataset.rows[i][col.stataName] ?? '').trim();
        if (v !== '') {
          const lit = toStataDateLiteral(v, col.confirmedTimeCadence);
          if (lit) {
            lines.push(`assert ${conv.varName}[${i + 1}] == ${lit}`);
          }
          break;
        }
      }
      lines.push('');
    }
  }

  // 6. Exact duplicates & cleaned-row panel key checkpoints
  lines.push('* 6. Assert duplicate removal & cleaned panel key checkpoints');
  if (spec.dropExactDuplicates) {
    lines.push('duplicates drop');
    lines.push(`assert _N == ${impact.afterExactDuplicatesN}`);
  } else {
    lines.push(`* Exact duplicate removal disabled; raw row count retained (_N == ${dataset.rowCount})`);
    lines.push(`assert _N == ${dataset.rowCount}`);
  }

  const rawEntityVar = dataset.panel.entityVar ?? '';
  const rawTimeVar = dataset.panel.timeVar ?? '';
  const effectiveTimeVar = convertedTimeVarMap.get(rawTimeVar) ?? rawTimeVar;
  let effectiveEntityId = rawEntityVar;
  const needsEntityEncode = Boolean(rawEntityVar && dataset.panel.entityIsString);

  if (rawEntityVar && rawTimeVar && impact.cleanedPanel.isPanel) {
    if (needsEntityEncode) {
      effectiveEntityId = `${rawEntityVar}_id`;
      if (effectiveEntityId.length > 32) {
        effectiveEntityId = `${rawEntityVar.slice(0, 29)}_id`;
      }
      lines.push(`encode ${rawEntityVar}, gen(${effectiveEntityId})`);
    }

    lines.push(
      `quietly count if missing(${effectiveEntityId}) | missing(${effectiveTimeVar})`
    );
    lines.push(`assert r(N) == ${impact.cleanedPanel.missingKeyRows}`);

    if (impact.cleanedPanel.panelKeyStatus === 'valid') {
      lines.push(`duplicates tag ${effectiveEntityId} ${effectiveTimeVar}, gen(_folio_v_dup)`);
      lines.push('quietly count if _folio_v_dup > 0');
      lines.push('assert r(N) == 0');
      lines.push('drop _folio_v_dup');
      lines.push(`quietly levelsof ${effectiveEntityId}`);
      lines.push(`assert r(r) == ${impact.cleanedPanel.numEntities}`);
      lines.push(`quietly levelsof ${effectiveTimeVar}`);
      lines.push(`assert r(r) == ${impact.cleanedPanel.numPeriods}`);
      if (impact.cleanedPanel.balanceStatus === 'strongly_balanced') {
        lines.push(
          `assert _N == ${impact.cleanedPanel.numEntities * impact.cleanedPanel.numPeriods}   // Strongly balanced ${impact.cleanedPanel.numEntities} x ${impact.cleanedPanel.numPeriods}`
        );
      }
    } else {
      lines.push(
        `* Cleaned rows have invalid panel keys (${impact.cleanedPanel.repeatedKeyGroups} repeated groups, ${impact.cleanedPanel.duplicateKeyPairs} excess rows); xtset omitted.`
      );
    }
  }
  lines.push('');

  // 7. Cleaning transforms, pre-estimation complete-case assertion & fitted e(N) printout
  if (spec.depVar && spec.indepVars.length > 0 && !impact.suitability.modelBlocked) {
    lines.push('* 7. Assert pre-estimation complete-case count & display fitted e(N)');

    if (spec.winsorizeVars.length > 0) {
      const lo = spec.winsorizeLevel;
      const hi = 100 - lo;
      lines.push('capture which winsor2');
      lines.push('if _rc != 0 {');
      lines.push('    display as error "Required package winsor2 not installed. Run: ssc install winsor2, replace"');
      lines.push('    exit 199');
      lines.push('}');
      lines.push(`winsor2 ${spec.winsorizeVars.join(' ')}, replace cuts(${lo} ${hi})`);
    }

    for (const [varName, mode] of Object.entries(spec.logTransforms)) {
      const targetName = getTransformedVarName(varName, mode);
      if (mode === 'ln') {
        lines.push(`gen double ${targetName} = ln(${varName})`);
      } else if (mode === 'ln1p') {
        lines.push(`gen double ${targetName} = ln(${varName} + 1)`);
      } else {
        lines.push(`gen double ${targetName} = asinh(${varName})`);
      }
    }

    const depModelVar = getEffectiveModelVar(spec.depVar, spec);
    const indepModelVars = spec.indepVars.map((v) => getEffectiveModelVar(v, spec));
    const resolvedAbsorbVars = spec.absorbVars.map((v) => {
      if (v === rawEntityVar && needsEntityEncode) return effectiveEntityId;
      if (convertedTimeVarMap.has(v)) return convertedTimeVarMap.get(v)!;
      return v;
    });

    const ccVars = new Set<string>([depModelVar, ...indepModelVars]);
    if (spec.estimator === 'fe_xtreg' || spec.estimator === 're_xtreg') {
      if (effectiveEntityId) ccVars.add(effectiveEntityId);
      if (effectiveTimeVar) ccVars.add(effectiveTimeVar);
    }
    if (spec.estimator === 'fe_reghdfe') {
      for (const fe of resolvedAbsorbVars) ccVars.add(fe);
    }
    if (spec.seType === 'cluster_entity' && effectiveEntityId) {
      ccVars.add(effectiveEntityId);
    }
    if (spec.seType === 'cluster_twoway') {
      if (effectiveEntityId) ccVars.add(effectiveEntityId);
      if (effectiveTimeVar) ccVars.add(effectiveTimeVar);
    }

    lines.push('gen byte _folio_cc = 1');
    lines.push(`foreach _v of varlist ${Array.from(ccVars).join(' ')} {`);
    lines.push('    quietly replace _folio_cc = 0 if missing(`_v\')');
    lines.push('}');
    lines.push('quietly count if _folio_cc == 1');
    lines.push(
      `assert r(N) == ${impact.previewCompleteCasesN}   // Exact match to Folio pre-estimation complete-case preview`
    );
    lines.push('drop _folio_cc');
    lines.push('');

    // Fit primary model and report fitted e(N) separately
    let vceOption = '';
    if (spec.seType === 'robust') {
      vceOption = 'vce(robust)';
    } else if (spec.seType === 'cluster_entity' && effectiveEntityId) {
      vceOption = `vce(cluster ${effectiveEntityId})`;
    } else if (spec.seType === 'cluster_twoway' && effectiveEntityId && effectiveTimeVar) {
      vceOption =
        spec.estimator === 'fe_reghdfe'
          ? `vce(cluster ${effectiveEntityId} ${effectiveTimeVar})`
          : `vce(cluster ${effectiveEntityId})`;
    }

    if (spec.estimator === 'fe_xtreg' || spec.estimator === 're_xtreg') {
      if (impact.postDedupPanelCheck.isSafeForXtset) {
        lines.push(`xtset ${effectiveEntityId} ${effectiveTimeVar}`);
      }
      const modeOpt = spec.estimator === 'fe_xtreg' ? 'fe' : 're';
      const optStr = vceOption ? `, ${modeOpt} ${vceOption}` : `, ${modeOpt}`;
      lines.push(`xtreg ${depModelVar} ${indepModelVars.join(' ')}${optStr}`);
    } else if (spec.estimator === 'fe_reghdfe') {
      lines.push('capture which reghdfe');
      lines.push('if _rc != 0 {');
      lines.push('    display as error "Required package reghdfe not installed. Run: ssc install ftools, replace ; ssc install reghdfe, replace"');
      lines.push('    exit 199');
      lines.push('}');
      const absorbClause =
        resolvedAbsorbVars.length > 0
          ? `absorb(${resolvedAbsorbVars.join(' ')})`
          : 'noabsorb';
      const optParts = [absorbClause];
      if (vceOption) optParts.push(vceOption);
      lines.push(`reghdfe ${depModelVar} ${indepModelVars.join(' ')}, ${optParts.join(' ')}`);
    } else {
      const optStr = vceOption ? `, ${vceOption}` : '';
      lines.push(`regress ${depModelVar} ${indepModelVars.join(' ')}${optStr}`);
    }

    lines.push(`assert e(N) > 0 & e(N) <= ${impact.previewCompleteCasesN}`);
    lines.push(
      `display as result "Verification — Pre-estimation complete cases: ${impact.previewCompleteCasesN} | Fitted e(N): " %12.0fc e(N)`
    );
    if (spec.estimator === 'fe_reghdfe') {
      lines.push('capture confirm scalar e(N_full)');
      lines.push(
        'if _rc == 0 display as result "Verification — Singletons dropped by reghdfe: " %12.0fc (e(N_full) - e(N))'
      );
    }
    lines.push('');
  }

  lines.push('display as result "PASS: All Folio Econometrics Stata 17+ verification assertions succeeded."');
  lines.push('');
  return lines.join('\n');
}
