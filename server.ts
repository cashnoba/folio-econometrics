import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

type AssistantRoleId = 'econometrician' | 'stata_auditor' | 'referee_critic' | 'latex_editor';
type AssistantReasoningMode = 'fast' | 'general' | 'interactive' | 'deep';

const REASONING_MODEL_MAP: Record<AssistantReasoningMode, string> = {
  fast: 'gemini-3.1-flash-lite',
  general: 'gemini-4-hydrogen',
  interactive: 'gemini-4-neon',
  deep: 'gemini-4-carbon',
};

const ROLE_SYSTEM_PROMPTS: Record<AssistantRoleId, string> = {
  econometrician:
    'You are Folio Econometrics Assistant acting as a Senior Applied Microeconometrician. Give rigorous, concise, publication-grade guidance on data diagnostics, skewness transformations, winsorization, multicollinearity, panel estimators (OLS, xtreg, reghdfe), and standard error clustering.',
  stata_auditor:
    'You are Folio Econometrics Assistant acting as a Stata 17+ Reproducibility & Code Auditor. Focus on exact Stata syntax hygiene, import parity (preserving leading zeros, Excel full stored precision, and %td/%tm/%tq dates), postestimation compatibility (estat vif / estat hettest on OLS, classical Hausman FE vs RE), singleton drops in reghdfe, and clean reproducible .do workflows.',
  referee_critic:
    'You are Folio Econometrics Assistant acting as a Top-Journal Empirical Referee & Identification Critic. Scrutinize causal identification threats, omitted-variable bias, measurement error, sample attrition/listwise deletion effects, panel key validity vs. repeated cross-sections, fixed-effects absorption choices, and clustering granularity. Suggest concrete robustness checks.',
  latex_editor:
    'You are Folio Econometrics Assistant acting as an Academic LaTeX & Empirical Table Editor. Advise on publication-ready booktabs and threeparttable presentation, variable labeling, decimal precision, compact article column layout, table footnotes documenting raw vs. cleaned sample N and panel balance, and clear reporting of descriptive and correlation tables.',
};

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server. Please add it in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ASSISTANT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description:
        'Clear, academic econometric explanation grounded in the provided dataset schema and statistics. Use concise paragraphs and concrete numbers from the summary statistics. Never fabricate statistics.',
    },
    hasProposal: {
      type: Type.BOOLEAN,
      description:
        'True if you are recommending concrete updates to the interactive Model Builder (e.g., winsorization, log transforms, estimator choice, fixed effects, clustering, or diagnostic tests).',
    },
    proposal: {
      type: Type.OBJECT,
      description: 'Structured specification changes to preview and sync with the Model Builder.',
      properties: {
        summaryTitle: {
          type: Type.STRING,
          description: 'Short 4-10 word summary of the proposed econometric update.',
        },
        dropExactDuplicates: {
          type: Type.BOOLEAN,
          description: 'Whether to include exact duplicates drop in the cleaning script.',
        },
        winsorizeVars: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Exact stataName list of numeric variables to winsorize.',
        },
        winsorizeLevel: {
          type: Type.INTEGER,
          description: 'Winsorization tail cutoff: 1 (for 1%/99%) or 5 (for 5%/95%).',
        },
        logTransforms: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              variable: { type: Type.STRING, description: 'Exact stataName of numeric variable.' },
              mode: {
                type: Type.STRING,
                description: 'One of: ln, ln1p, asinh. Use asinh if values <= -1 exist, ln1p if values > -1 with <= 0, ln if strictly positive.',
              },
            },
            required: ['variable', 'mode'],
          },
        },
        estimator: {
          type: Type.STRING,
          description: 'One of: ols, fe_xtreg, fe_reghdfe, re_xtreg.',
        },
        depVar: {
          type: Type.STRING,
          description: 'Exact stataName of the dependent variable Y.',
        },
        indepVars: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Exact stataName list of independent regressors X.',
        },
        absorbVars: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Exact stataName list of fixed effect variables to absorb when estimator is fe_reghdfe.',
        },
        seType: {
          type: Type.STRING,
          description: 'One of: default, robust, cluster_entity, cluster_twoway.',
        },
        diagnostics: {
          type: Type.OBJECT,
          properties: {
            vif: { type: Type.BOOLEAN },
            breuschPagan: { type: Type.BOOLEAN },
            hausman: { type: Type.BOOLEAN },
            esttab: { type: Type.BOOLEAN },
          },
        },
      },
      required: ['summaryTitle'],
    },
  },
  required: ['reply', 'hasProposal'],
};

interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      // Do not retry client errors (400/401/403/404)
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 450 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/assistant', async (req, res) => {
    let selectedModel = REASONING_MODEL_MAP.general;
    try {
      const {
        message,
        history = [],
        datasetDigest,
        roleId = 'econometrician',
        reasoningMode = 'general',
      } = req.body as {
        message?: string;
        history?: ChatHistoryTurn[];
        datasetDigest?: Record<string, unknown> | null;
        roleId?: AssistantRoleId;
        reasoningMode?: AssistantReasoningMode;
      };

      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Please provide a question for the econometric assistant.' });
        return;
      }

      const safeRoleId: AssistantRoleId =
        roleId in ROLE_SYSTEM_PROMPTS ? roleId : 'econometrician';
      const safeReasoningMode: AssistantReasoningMode =
        reasoningMode in REASONING_MODEL_MAP ? reasoningMode : 'general';
      selectedModel = REASONING_MODEL_MAP[safeReasoningMode];

      const ai = createGeminiClient();

      const depthGuidance =
        safeReasoningMode === 'fast'
          ? 'Be crisp and direct (around 70-140 words) with immediately actionable guidance.'
          : safeReasoningMode === 'deep'
            ? 'Provide thorough, structured methodological reasoning (around 180-360 words), explicitly weighing identification assumptions, edge cases, and robustness alternatives.'
            : 'Keep reply prose scholarly, direct, and well-structured (around 120-260 words unless more detail is explicitly requested).';

      const systemInstruction = [
        ROLE_SYSTEM_PROMPTS[safeRoleId],
        'Strict rules:',
        '1. Use ONLY exact variable names (stataName) that appear in the provided dataset digest. Never invent variable names or fabricate numbers. Never propose all-missing or constant columns as outcomes or regressors.',
        '2. If a variable contains values <= 0 (nonPositiveCount > 0), warn against naive ln(x) and recommend ln1p (when all values > -1) or asinh (when values <= -1 exist).',
        '3. Respect Stata postestimation and panel constraints: note that estat vif and estat hettest require OLS (or an auxiliary OLS block), classical Hausman compares non-robust FE vs RE, and xtset requires confirmed unique non-missing panel keys (dated cross-sections should use OLS or reghdfe without xtset).',
        '4. When the user asks for transformations, cleaning scripts, winsorization, or a regression/panel specification, set hasProposal = true and populate only the fields in proposal that should change or be configured, plus a clear summaryTitle.',
        `5. ${depthGuidance}`,
        datasetDigest
          ? `\nACTIVE DATASET CONTEXT (Aggregated Metadata & Summary Stats Only — No Raw Rows):\n${JSON.stringify(datasetDigest, null, 2)}`
          : '\nNOTE: Dataset metadata sharing is currently disabled by the user for privacy. Answer general econometric and Stata methodology questions without assuming specific column names, and set hasProposal = false.',
      ].join('\n');

      const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
      const contents = [
        ...recentHistory.map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }],
        })),
        {
          role: 'user',
          parts: [{ text: message.trim() }],
        },
      ];

      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: selectedModel,
          contents,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: ASSISTANT_RESPONSE_SCHEMA,
          },
        })
      );

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'The assistant returned an empty response. Please try again.' });
        return;
      }

      let parsed: { reply: string; hasProposal: boolean; proposal?: unknown };
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { reply: rawText, hasProposal: false };
      }

      res.json({
        reply: parsed.reply ?? rawText,
        hasProposal: Boolean(parsed.hasProposal && parsed.proposal),
        proposal: parsed.hasProposal ? parsed.proposal : null,
        roleId: safeRoleId,
        reasoningMode: safeReasoningMode,
        modelUsed: selectedModel,
      });
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string };
      const status = errorObj?.status ?? 500;
      let userMessage = errorObj?.message || 'Unable to reach the Gemini econometric assistant.';

      if (status === 403 || status === 401 || userMessage.includes('API_KEY_INVALID') || userMessage.includes('PERMISSION_DENIED')) {
        userMessage = 'Gemini API authentication failed. Please verify your API key in Settings > Secrets.';
      } else if (status === 429 || userMessage.includes('RESOURCE_EXHAUSTED')) {
        userMessage = 'Gemini API rate limit or quota reached. Please retry in a moment or check Settings > Secrets (paid tier recommended for Complex/Deep modes).';
      } else if (status === 404 || userMessage.includes('NOT_FOUND')) {
        userMessage = `The configured Gemini model (${selectedModel}) was not found. Please check model availability.`;
      }

      console.error('[assistant error]', err);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: userMessage });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio Econometrics server listening on http://localhost:${PORT}`);
  });
}

startServer();
