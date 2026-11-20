# Folio Econometrics

Folio Econometrics is a privacy-first browser workspace for empirical researchers. All CSV and Excel (`.xlsx` / `.xls`) parsing, diagnostics, panel key checks, deterministic model suggestions, Stata 17+ `.do` bundle generation, and LaTeX `booktabs` / `threeparttable` exports run 100% client-side in the browser.

## Runtime & Clean Install

Verified environment:
- **Node.js**: `v22.23.2` (Node `20.19+` / `22` LTS supported)
- **npm**: `10.9.8`
- **Excel parser**: Official SheetJS `xlsx@0.20.3` pinned tarball (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), resolving CVE-2023-30533 and CVE-2024-22363 (`npm audit`: 0 vulnerabilities).

Clean reproducible install:

```bash
npm ci
```

(Or `npm install` when regenerating the lockfile; `package.json` and `package-lock.json` pin `xlsx@0.20.3` cleanly with no `--legacy-peer-deps` required.)

## Build Modes

### 1. Public Static Beta Build (`folio-econometrics`) — No Server, No API Key

Use this build for static hosting (Cloudflare Pages, GitHub Pages, S3/CloudFront, etc.):

```bash
VITE_PUBLIC_BUILD=true npm run build
```

(Equivalent convenience script: `npm run build:public`.)

When `VITE_PUBLIC_BUILD=true`:
- The AI Assistant UI, `AssistantDrawer` bundle, and all `/api/assistant` calls are excluded at compile time via dead-code elimination.
- The resulting `dist/` directory is 100% static HTML/CSS/JS with zero server dependencies, zero API keys, and zero external data calls.
- All core features remain active: Inspector, Diagnostics, client-side deterministic Model Suggestions, Stata 17+ `.do` + verification `.zip` bundles, and LaTeX table export.

### 2. Private AI-Enabled Build (Local / AI Studio)

```bash
# Development server (Express + Vite middleware on port 3000)
npm run dev

# Production build (default VITE_PUBLIC_BUILD unset / false)
npm run build
```

In the private build, the optional AI Assistant drawer uses the server-side `/api/assistant` route (`GEMINI_API_KEY` stays server-side only) and retains opt-in metadata sharing (`shareMetadataOptIn` starts disabled on every dataset load).

## Verification Commands

```bash
# TypeScript typecheck
npm run lint

# Regression & Stata/Excel parity suite (15 checks)
npx tsx tests/regression.ts

# Deterministic Model Suggestions suite (7 synthetic cases)
npx tsx tests/model_suggestions.ts
```

## Cloudflare Pages Deployment (`folio-econometrics`)

Configure the Cloudflare Pages project once local Stata 17+ checks are confirmed:

- **Project name**: `folio-econometrics`
- **Root directory**: `/` (repository root)
- **Framework preset**: `Vite` (or `None`)
- **Build command**: `VITE_PUBLIC_BUILD=true npm run build`
- **Build output directory**: `dist`
- **Environment variables (Production & Preview)**:
  - `VITE_PUBLIC_BUILD` = `true`
  - `NODE_VERSION` = `22` (recommended to match verified Node `v22.23.2`)
  - Do **not** set `GEMINI_API_KEY` on Cloudflare Pages.

## Post-Deploy Smoke Test Checklist

1. Open the deployed site with browser DevTools Network tab open: confirm zero requests to `/api/assistant` and no `AI Assistant` button in the UI.
2. Verify all 5 tabs (`Inspector`, `Diagnostics`, `Suggestions`, `Stata .do`, `LaTeX`) are reachable on desktop and at `375px` mobile width without horizontal clipping.
3. Click **Upload Dataset**: verify `Tab` / `Shift+Tab` stays inside the modal, **Browse files** has a single keyboard focus stop, and `Escape` closes the modal and returns focus to **Upload Dataset**.
4. In **Suggestions**, test selecting an outcome, toggling candidate regressors, and clicking **Review in Model Builder** (verify **Undo Spec Apply** restores the previous spec).
5. In **Stata .do**, download both **Housing Demo Bundle (.zip)** and **Precision & Keys Fixture (.zip)** and run their `*_verify.do` scripts in local Stata 17+.
6. In **LaTeX**, verify both compact article summary and correlation previews/source render and copy/download cleanly.
