# Property Bill Automation

Property Bill Automation is a full-stack project built by **DSD Mighty**, a team in the Dallas Software Developers 2026 cohort.

Property management teams handle bills across multiple properties, vendors, due dates, and approval rules. This application brings those steps into one workflow: capture bill details, route bills for approval, and track payment runs.

## What it does

- Manage properties, vendors, and vendor accounts.
- Upload invoices and extract bill details with an AI provider.
- Review extracted information before creating or updating a bill.
- Track bill statuses and approval decisions.
- Record payments and review payment runs.
- Keep an audit trail of important changes.
- Use a browser-based payment agent with demo vendor portals.

The payment agent is intended for the project demo. It is not connected to real banking or payment networks.

## Architecture and technology

| Area | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Backend | Python 3.12, FastAPI, Pydantic |
| Database and authentication | Supabase, PostgreSQL |
| Invoice extraction | Anthropic or Google Gemini |
| Payment workflow | Playwright |
| Python dependencies and tests | uv, pytest, Ruff |
| Frontend dependencies and checks | pnpm, Jest, Biome |
| CI | GitHub Actions |

The frontend calls the FastAPI backend. The backend uses Supabase for data, authentication, and invoice storage.

## Repository layout

```text
.
├── .github/workflows/       # CI workflows
├── backend/
│   ├── src/backend/
│   │   ├── api/             # FastAPI routes
│   │   └── payment_agent/   # Payment-run worker
│   ├── supabase/
│   │   ├── migrations/      # Database migrations
│   │   └── seed.sql         # Local demo data
│   └── tests/
├── frontend/
│   └── app/                 # Next.js application
├── docs/
├── scripts/
└── README.md
```

## Run locally

### Prerequisites

Install:

- Python 3.12
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 22
- [pnpm](https://pnpm.io/installation/)
- [Docker](https://docs.docker.com/get-docker/)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### 1. Start Supabase

From the repository root:

```bash
cd backend
supabase start
```

The local Supabase stack uses Docker. The project’s migrations and seed data are applied to the local database.

Use `supabase status` to find the local API URL, publishable key, and secret key.

### 2. Configure the backend

Copy `backend/.env.example` to `backend/.env`. Fill in the local Supabase URL and keys from `supabase status`:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=your-local-publishable-key
SUPABASE_SECRET_KEY=your-local-secret-key
```

Keep `SUPABASE_SECRET_KEY` on the backend. Never put it in the frontend or commit it.

For AI invoice extraction, add the key for the provider you want to use:

```dotenv
ANTHROPIC_API_KEY=your-anthropic-key
# or
GEMINI_API_KEY=your-gemini-key
```

### 3. Run the backend

From `backend/`:

```bash
uv sync --locked
uv run uvicorn backend.app:app --reload
```

The API is available at:

- API root: <http://127.0.0.1:8000/>
- Interactive API documentation: <http://127.0.0.1:8000/docs>
- Alternative API documentation: <http://127.0.0.1:8000/redoc>

### 4. Configure and run the frontend

Copy `frontend/.env.example` to `frontend/.env.local`. Set the local Supabase URL and anon key from `supabase status`, then point the frontend to the backend:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

From `frontend/`:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000/>.

### Payment agent worker

The worker runs payment jobs through browser-based demo vendor portals. Install Chromium once from `backend/`:

```bash
uv run playwright install chromium
```

Run the worker with:

```bash
uv run python -m backend.payment_agent.worker
```

To process one queued run and then exit:

```bash
uv run python -m backend.payment_agent.worker --once
```

Use demo data and demo vendor portals when exploring this workflow.

## Checks

Run backend tests and lint/format checks from `backend/`:

```bash
uv run pytest -v
uv run ruff check .
uv run ruff format --check .
```

Run frontend checks from `frontend/`:

```bash
pnpm test
pnpm lint
pnpm run type-check
pnpm build
```

Some backend tests use a local Supabase instance and are opt-in. See the test markers and CI workflow for details.

GitHub Actions runs backend, database, frontend, and repository-enforcement checks on pull requests and pushes to `main`.

## Project status

This project is under active development. Features and local setup may change as the team develops the application.

## Team

Built collaboratively by **DSD Mighty**, Dallas Software Developers 2026 cohort.

| Developer | GitHub | LinkedIn | Portfolio | Project contributions |
| --- | --- | --- | --- | --- |
| **Kervintz Noel** | [@kervcodes](https://github.com/kervcodes) | [LinkedIn](https://www.linkedin.com/in/kervintznoel/) | [Portfolio](https://www.kervintznoel.com/) | Application and vendor management features |
| **Mai Vang** | [@vmaineng](https://github.com/vmaineng) | — | — | Frontend bill and dashboard workflows |
| **Michael Edquilan** | [@littilemike11](https://github.com/littilemike11) | — | — | Admin user management and tests |
| **Pranil Lama** | [@Pranillama](https://github.com/Pranillama) | — | — | Payment recording and AI payment agent |
| **Trillium Smith** | [@trillium](https://github.com/trillium) | — | — | Vendor accounts, portal credentials, and bill matching |