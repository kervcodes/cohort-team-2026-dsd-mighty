# Project Instructions

Property Bill Automation, built by DSD Mighty (Dallas Software Developers 2026 cohort). Two stacks in one repo: a Python FastAPI backend in `backend/` (uv, pytest, ruff) and a Next.js 16 (App Router) + React 19 + TypeScript strict frontend in `frontend/` (pnpm, Tailwind 4). The frontend talks to the FastAPI backend over HTTP; the backend talks to Supabase.

@frontend/AGENTS.md

## Commands

Backend, from `backend/`:

- `uv sync --locked` - install dependencies
- `uv run pytest -v` - tests
- `uv run ruff check .` - lint
- `uv run ruff format --check .` - format check (`uv run ruff format .` to fix)
- `uv run uvicorn backend.app:app --reload` - dev server

Frontend, from `frontend/`:

- `pnpm install --frozen-lockfile` - install dependencies
- `pnpm lint` - Biome (the only linter and formatter; `pnpm format` fixes)
- `pnpm run type-check` - `next typegen && tsc --noEmit`
- `pnpm test` - Jest
- `pnpm build` - `next build`
- `pnpm dev` - dev server

Repo root:

- `node scripts/check-enforcement.mjs` - the rule -> enforcer table (below)

## Layout

`backend/src/backend` FastAPI app (`api/` routers, `schemas/`), `backend/tests`, `frontend/app` routes, components, `lib/` and `types/`, `scripts/` repo tooling, `.github/workflows` CI.

## Enforcement

@ENFORCEMENT.md

Every binding rule in this project is enforced by a mechanism, named in `ENFORCEMENT.md`. The hooks and CI jobs there are the rules - do not work around them. A rule whose only enforcer is `convention`, `review` or `audit` is a defect: fix it by building the enforcer.

## When corrected

When you are corrected, do not add a sentence to this file. Fix the class of mistake at the highest rung that works - code structure, then lint / hook / test / CI, and only then prose - and add a row to `ENFORCEMENT.md`. Procedure: name the class of mistake, build the enforcer at the highest rung that stops it, then add the table row.
