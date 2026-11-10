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
| An analyst can never read or change another analyst's bills (routes use the service-role client, so the `submitted_by` filters are the only guard) | test | `backend/tests/test_bill_access.py`, `backend/tests/fake_supabase.py` | - |
| Every #27 bills route and every vendors route enforces the role table (active users only; only admins add or change vendors); every route either requires sign-in and has a role-table row (or is in `ANY_SIGNED_IN`), or is in the test's `OPEN_ROUTES` allowlist with a reason | test | `backend/tests/test_route_permissions.py`, `backend/tests/current_users.py` | - |
| Signed-in callers get exact 401 / 403 / 503 outcomes; a missing `app_users` row is a 403, never re-created | test | `backend/tests/test_auth.py`, `backend/tests/test_me.py` | - |
| The backend refuses to start with missing or malformed Supabase settings | test | `backend/tests/test_settings.py` | - |
| Invoice PDFs live in a private bucket that browser roles (anon, authenticated) cannot read or write | test | `backend/supabase/migrations/20261104170000_create_invoices_bucket.sql`, `backend/supabase/tests/invoices_bucket.test.sql` | - |
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
| No literal user-visible text in components | convention | - | 2026-12-31 Biome `noJsxLiterals` runs at warn, not error: literals not yet extracted (37 in 7 files) |
| Required status checks and squash-only merges on `main` | audit | - | 2026-12-31 repository admin settings, not changeable from a PR |
| The extractor never imports Supabase | test | `backend/tests/extraction/test_extraction_rules.py` | - |
| Tests never call a model: API keys are removed for every backend test, and the extractor raises without them | test | `backend/tests/conftest.py`, `backend/tests/test_model_keys.py`, `backend/tests/extraction/test_extraction_rules.py`, `backend/tests/extraction/test_extract.py` | - |
| Extraction log lines carry metadata only, never bill content or extracted values | test | `backend/tests/extraction/test_extract.py` | - |
| Every extraction check has unit tests: every `IssueCode` has an extraction that triggers it through `run_checks`, or for `MODELS_DISAGREE` (raised by the cascade) through the cascade comparison in a sibling test | test | `backend/tests/extraction/test_extraction_checks.py` | - |
