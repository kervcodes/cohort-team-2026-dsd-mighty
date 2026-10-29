# Property Bill Automation

A full-stack application developed by **DSD Mighty**, a team from the **Dallas Software Developers 2026 Cohort**.

Property management companies handle hundreds of bills across multiple properties, each with different vendors, due dates, payment methods, and approval requirements.

This project aims to simplify that process by building a system for collecting bills, matching them to the correct properties, detecting duplicates, managing approvals, and tracking payment workflows.

The project will start with traditional software engineering approaches, with AI-powered capabilities introduced in later development phases.

## Technology Stack

- ⚡ [**FastAPI**](https://fastapi.tiangolo.com/) for the Python backend API.
- 🐍 [**Python**](https://www.python.org/) for backend development.
- 📦 [**uv**](https://docs.astral.sh/uv/) for Python dependency management and locking.
- ✅ [**pytest**](https://docs.pytest.org/) for automated backend tests.
- 🔄 [**GitHub Actions**](https://docs.github.com/en/actions) for continuous integration.
- 📦 [**pnpm**](https://pnpm.io/) for planned frontend dependency management.
- 🖥️ **Frontend:** Not yet implemented.

## Meet the Team

Built collaboratively by members of the Dallas Software Developers 2026 cohort. 
| Team Member | GitHub | LinkedIn | Portfolio |
| :--- | :--- | :--- | :--- |
| **Kervintz Noel** | [@kervcodes](https://github.com/kervcodes) | [LinkedIn](https://www.linkedin.com/in/kervintznoel/) | [Website](https://kervintznoel.com/) |
| **Member Name** | [GitHub](https://github.com/) | — | — |
| **Member Name** | [GitHub](https://github.com/) | — | — |
| **Member Name** | [GitHub](https://github.com/) | — | — |
| **Member Name** | [GitHub](https://github.com/) | — | — |
| **Member Name** | [GitHub](https://github.com/) | — | — |


## Project Structure (To be updated)

```text
cohort-team-2026-dsd-mighty/
├── .github/
│   └── workflows/        # CI configuration
├── backend/
│   ├── src/
│   │   └── backend/      # FastAPI application package
│   ├── tests/            # Backend tests
│   ├── pyproject.toml    # Project and dependency configuration
│   └── uv.lock           # Locked Python dependencies
├── frontend/             # Reserved for the frontend application
├── .gitignore
└── README.md
```

## Getting Started

### Prerequisites

Install [Python](https://www.python.org/downloads/) and [uv](https://docs.astral.sh/uv/getting-started/installation/).

### Backend Development

From the repository root:

```bash
cd backend
uv sync
uv run uvicorn backend.app:app --reload
```

Once the server is running:

- **API:** http://127.0.0.1:8000/
- **Interactive API documentation:** http://127.0.0.1:8000/docs
- **Alternative API documentation:** http://127.0.0.1:8000/redoc

### Running Tests

From the `backend/` directory:

```bash
uv --version
uv sync --locked
uv run pytest -v
```

- `uv --version` confirms uv is installed.
- `uv sync --locked` installs dependencies and checks that `uv.lock` matches the project configuration.
- `uv run pytest -v` runs backend tests with detailed results.

**GitHub Actions workflow validation (optional):** Install [actionlint](https://github.com/rhysd/actionlint) using a prebuilt executable or a package manager. Go is not required when using the executable. From the **repository root**, run:

```bash
actionlint .github/workflows/ci.yml
```

No output and an exit code of `0` normally mean actionlint found no errors.

## Frontend Development

The frontend has not been initialized yet. Setup instructions will be added when the team chooses and configures the frontend stack.

## Pre-commit hook

A commit runs [husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged) on the files you staged:

- `frontend/` files: `biome check --write` (format, lint fixes and import sorting).
- `backend/` Python files: `ruff check --fix` and `ruff format`, through `uv`. If `uv` is not installed, the Python step is skipped with a message.

Fixes are re-staged automatically, so they land in the same commit. Problems that cannot be fixed automatically stop the commit.

**Setup:** run `pnpm install` in `frontend/`. Its `prepare` script points git at the repo-root `.husky/` folder (`core.hooksPath`), so there is nothing else to do. The hook is configured in `.husky/pre-commit` and `lint-staged.config.mjs`.

**Skipping in an emergency:** `git commit --no-verify`. CI stays read-only (`pnpm lint`, `ruff check`, `ruff format --check`) and will still fail the PR if the code is not clean, so run `pnpm format` in `frontend/` or `uv run ruff check --fix . && uv run ruff format .` in `backend/` afterwards.

## Continuous Integration

GitHub Actions configuration lives in [`.github/workflows/`](./.github/workflows/). It runs on pull requests to `main` and pushes to `main`.

- **Backend:** Set up Python and uv, install locked dependencies, and run pytest. The backend checks have passed locally; the GitHub Actions workflow is still being validated.

## Project Status

**In development — foundation setup.** The FastAPI backend and a basic test are in place. The frontend and application-specific features are not yet implemented.
