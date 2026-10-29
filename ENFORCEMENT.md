# Enforcement

Every binding rule names the mechanism that enforces it. `node scripts/check-enforcement.mjs` (CI) verifies that every named file exists and that no rule rests on `convention`, `review` or `audit` alone - those are defects, allowed only as dated exceptions that expire.

Kinds: `structure` (the mistake cannot be written), `lint`, `hook`, `ci`, `test` - then, as defects, `convention`, `review`, `audit`. The ladder runs from `structure` (strongest) to `audit` (weakest); when a rule is broken, build the enforcer at the highest rung that works and add or update its row.

The checker runs by `node` from the repo root because the root has no `package.json`; enforcer cells therefore name file paths rather than `pnpm run` scripts.

| Rule | Kind | Enforcer | Exception |
|------|------|----------|-----------|
| Backend tests pass before merge | ci | `.github/workflows/ci.yml` | - |
| Backend is ruff-clean and ruff-formatted | ci | `backend/pyproject.toml`, `.github/workflows/ci.yml` | - |
| Frontend tests pass before merge | ci | `.github/workflows/ci.yml` | - |
| TypeScript strict; frontend types check before merge | ci | `frontend/tsconfig.json`, `.github/workflows/ci.yml` | - |
| Frontend builds before merge | ci | `.github/workflows/ci.yml` | - |
| Every rule above has an enforcer that exists; no exception has expired | ci | `scripts/check-enforcement.mjs`, `.github/workflows/ci.yml` | - |
| Commit messages follow `type(scope): description` | review | - | 2026-12-31 the pre-commit hook does not check messages; no commit-msg hook yet |
| Biome is the only linter and formatter (no ESLint, no Prettier); lint passes before merge | ci | `frontend/biome.json`, `.github/workflows/ci.yml` | - |
| Staged frontend and backend files are Biome- and Ruff-fixed before commit | hook | `.husky/pre-commit`, `lint-staged.config.mjs` | - |
| No literal user-visible text in components | convention | - | 2026-12-31 Biome `noJsxLiterals` runs at warn, not error: literals not yet extracted (14 in 3 files) |
| Required status checks and squash-only merges on `main` | audit | - | 2026-12-31 repository admin settings, not changeable from a PR |
| The extractor never imports Supabase | test | `backend/tests/extraction/test_extraction_rules.py` | - |
| Tests never call a model: API keys are removed for every backend test, and the extractor raises without them | test | `backend/tests/conftest.py`, `backend/tests/test_model_keys.py`, `backend/tests/extraction/test_extraction_rules.py`, `backend/tests/extraction/test_extract.py` | - |
| Extraction log lines carry metadata only, never bill content or extracted values | test | `backend/tests/extraction/test_extract.py` | - |
| Every extraction check has unit tests: every `IssueCode` has an extraction that triggers it through `run_checks`, or for `MODELS_DISAGREE` (raised by the cascade) through the cascade comparison in a sibling test | test | `backend/tests/extraction/test_extraction_checks.py` | - |
