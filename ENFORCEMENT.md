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
| Commit messages follow `type(scope): description` | review | - | 2026-12-31 no commit-msg hook until the hooks change lands |
| Frontend formatting follows Prettier (single quotes) | ci | `frontend/.prettierrc`, `.github/workflows/ci.yml` | - |
| Biome is the only linter and formatter (no ESLint, no Prettier) | convention | - | 2026-12-31 frontend still uses ESLint and Prettier until the Biome change lands |
| Required status checks and squash-only merges on `main` | audit | - | 2026-12-31 repository admin settings, not changeable from a PR |
