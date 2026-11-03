# Enforcement

Every binding rule names the mechanism that enforces it. `node scripts/check-enforcement.mjs` (CI) verifies that every named file exists and that no rule rests on `convention`, `review` or `audit` alone - those are defects, allowed only as dated exceptions that expire.

Kinds: `structure` (the mistake cannot be written), `lint`, `hook`, `ci`, `test` - then, as defects, `convention`, `review`, `audit`. The ladder runs from `structure` (strongest) to `audit` (weakest); when a rule is broken, build the enforcer at the highest rung that works and add or update its row.

The checker runs by `node` from the repo root because the root has no `package.json`; enforcer cells therefore name file paths rather than `pnpm run` scripts.

| Rule | Kind | Enforcer | Exception |
|------|------|----------|-----------|
| Backend tests pass before merge | ci | `.github/workflows/ci.yml` | - |
| Backend is ruff-clean and ruff-formatted | ci | `backend/pyproject.toml`, `.github/workflows/ci.yml` | - |
| Database migrations apply to a clean database and pgTAP tests pass before merge | ci | `.github/workflows/ci.yml`, `backend/supabase/tests/` | - |
| Frontend tests pass before merge | ci | `.github/workflows/ci.yml` | - |
| TypeScript strict; frontend types check before merge | ci | `frontend/tsconfig.json`, `.github/workflows/ci.yml` | - |
| Frontend builds before merge | ci | `.github/workflows/ci.yml` | - |
| Every rule above has an enforcer that exists; no exception has expired | ci | `scripts/check-enforcement.mjs`, `.github/workflows/ci.yml` | - |
| Commit messages follow `type(scope): description` | hook | `.husky/commit-msg` | - |
| Biome is the only linter and formatter (no ESLint, no Prettier); lint passes before merge | ci | `frontend/biome.json`, `.github/workflows/ci.yml` | - |
| Staged frontend and backend files are Biome- and Ruff-fixed before commit | hook | `.husky/pre-commit`, `lint-staged.config.mjs` | - |
| No direct pushes to `main` | hook | `.husky/pre-push` | - |
| Staged TypeScript files type-check on commit | hook | `frontend/scripts/tsc-staged.sh`, `lint-staged.config.mjs` | - |
| No emoji in source; use lucide-react icons | hook | `frontend/scripts/check-no-emoji.mjs`, `lint-staged.config.mjs` | - |
| Raw HTML elements with a design-system replacement are banned outside `frontend/app/components/ui` | hook | `frontend/scripts/check-design-system.ts`, `lint-staged.config.mjs` | - |
| Every `components/ui` primitive has a manifest entry and appears on `/design-system` | lint | `frontend/scripts/check-ds-coverage.ts`, `frontend/scripts/check-ds-page.ts` | - |
| A raw `<button>` outside `components/ui` is rejected; `<Button>` passes | test | `frontend/app/lib/design-system-enforcement.test.ts` | - |
| Design-system sweep passes before push and merge | ci | `.husky/pre-push`, `.github/workflows/ci.yml` | - |
| Claude Code cannot write a raw tag outside `components/ui` | review | `frontend/scripts/check-design-system.ts` | 2026-12-31 the PreToolUse layer needs a Claude settings change that is held for the captain |
| Design-system rules other than `raw-button` are not yet enabled | review | `frontend/app/components/ui/manifest.config.ts` | 2026-12-31 enable one preset at a time as its component is built |
| No literal user-visible text in components; copy lives in `frontend/app/content/*.json` | lint | `frontend/biome.json`, `frontend/scripts/lint-literals.mjs`, `lint-staged.config.mjs` | - |
| Every page route has a content file and its text is tagged | lint | `frontend/scripts/lint-content.mjs`, `frontend/content-acceptance.config.json` | - |
| Content fields are human-accepted by hash; agents cannot accept | ci | `frontend/scripts/content-acceptance.mjs`, `frontend/app/content/.accepted.json`, `.github/workflows/ci.yml` | - |
| Sidebar text is extracted to content | review | `frontend/biome.json` | 2026-12-31 the sidebar is a dev stub in active development; Biome `noJsxLiterals` is off for it until its design settles |
| E2E smoke tests pass before merge, using mock data only (non-local requests fail the test) | test | `frontend/e2e/fixtures.ts`, `frontend/playwright.config.ts`, `.github/workflows/e2e.yml` | - |
| Pages have no serious axe accessibility violations | test | `frontend/e2e/a11y.spec.ts`, `.github/workflows/accessibility.yml` | - |
| Color contrast meets WCAG | review | `frontend/e2e/a11y.spec.ts` | 2026-12-31 every page fails axe color-contrast on current design tokens; rule disabled until tokens are fixed |
| Required status checks and squash-only merges on `main` | audit | - | 2026-12-31 repository admin settings, not changeable from a PR |
