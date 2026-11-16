# Payment worker (DC-85)

The payment agent worker pays queued payment runs. It loops: claim the oldest queued run, pay it on the vendor portal with headless Chromium, and sleep 5 seconds when the queue is empty. It runs on Render as a **Background Worker**, separate from the FastAPI web service, built from `backend/payment-worker.Dockerfile`.

- Code: `backend/src/backend/payment_agent/worker.py` (the loop) and `agent.py` (one run).
- Image: `backend/payment-worker.Dockerfile`, based on `mcr.microsoft.com/playwright/python:v1.65.2-noble`, the official image for the playwright version in `backend/uv.lock`. It runs as the image's non-root `pwuser`, with `tini` as PID 1, and its default command is the worker.
- CI: the `payment-worker-image` job builds the image and starts Chromium inside it with a 512 MB limit on every pull request.

## Settings

The worker reads these environment variables. In `backend/.env` locally; on the Render service in production.

| Name | Required | What it is |
|------|----------|------------|
| `SUPABASE_URL` | yes | The Supabase project URL, like `https://<ref>.supabase.co`. |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Checked at start with the other Supabase settings. |
| `SUPABASE_SECRET_KEY` | yes | The service-role key: the worker claims runs and records payments with it. |
| `ANTHROPIC_API_KEY` | yes | The Claude key. Set it on the worker too; the web service's copy is not shared. |
| `PAYMENT_AGENT_MODEL` | no | The model that drives a run. Default `claude-opus-5-5`. |
| `PAYMENT_WORKER_SHUTDOWN_DELAY_SECONDS` | yes on Render | The service's shutdown delay on Render (see [Shutdown](#shutdown)). Set it to `300`. Default `30`, Render's default. |
| `LOG_LEVEL` | no | Default `INFO`. |

The worker stops at start, with the variable's name in the log, when a required setting is missing or malformed. It never logs a key.

## Run it locally

From `backend/`, against the **local** Supabase stack (`supabase start`) and test portals only. A worker pointed at the hosted project pays real queued runs.

With uv:

```sh
uv sync --locked
uv run playwright install chromium            # once per machine
uv run python -m backend.payment_agent.worker --check-browser   # Chromium starts, then exit
uv run python -m backend.payment_agent.worker --once            # run at most one queued run
uv run python -m backend.payment_agent.worker                   # loop until Ctrl+C
```

With Docker, the same image Render runs:

```sh
docker build -f payment-worker.Dockerfile -t payment-worker .
docker run --rm --memory=512m payment-worker python -m backend.payment_agent.worker --check-browser
```

To run the loop in Docker, pass the settings with `--env-file`. Inside the container, `127.0.0.1` is the container itself, so point `SUPABASE_URL` at the host (on Linux, also pass `--add-host=host.docker.internal:host-gateway`):

```sh
docker run --rm --memory=512m --env-file .env \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  payment-worker
```

`docker stop` sends SIGTERM, like a Render deploy.

## Create the worker on Render

The web service is configured in the dashboard, so the worker is too. Do not add a `render.yaml` to the repo: syncing a Blueprint can change the existing manually configured service. The [Blueprint snippet](#optional-blueprint) below is for reference only.

1. In the Render dashboard, click **New** > **Background Worker**.
2. Connect the team's GitHub repository. Set **Branch** to `main`.
3. Set **Name** to `payment-worker`. Pick the same **Region** as the backend web service.
4. Set **Language** to **Docker**.
5. Leave **Root Directory** empty.
6. Under **Advanced**:
   - **Dockerfile Path**: `./backend/payment-worker.Dockerfile`
   - **Docker build context**: `./backend`. Render's docs don't name this dashboard field; in a Blueprint it is `dockerContext`.
   - **Docker Command**: leave empty (the image starts the worker).
   - **Auto-Deploy**: **After CI Checks Pass**, so an image that fails the CI job is never deployed. If it isn't offered here, set it on the service's **Settings** page after creation.
   - **Build Filters** > **+ Add Included Path**: `backend/src/**`, `backend/pyproject.toml`, `backend/uv.lock`, `backend/payment-worker.Dockerfile`, `backend/.dockerignore`. Changes elsewhere (frontend, tests, docs) then do not rebuild the worker. This also lives on **Settings** > **Build & Deploy** after creation.
7. Set **Instance Type** to **Starter** (512 MB, 0.5 CPU). See [Memory](#memory) for when to move up.
8. Under **Environment Variables**, add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `PAYMENT_AGENT_MODEL` and `PAYMENT_WORKER_SHUTDOWN_DELAY_SECONDS` (value `300`). Copy the Supabase and Anthropic values from the backend web service. A shared **Environment Group** linked to both services also works. The Dockerfile declares no build arguments, so Render's build-time copies of these variables never reach an image layer.
9. Click **Create Background Worker**. The first build pulls the Playwright base image (about 1 GB compressed) and takes a few minutes.
10. Set the shutdown delay to 300 seconds (next section).
11. Open **Logs** and check for the startup line (see [Logs](#logs)).

### Shutdown delay

On a deploy, restart or platform maintenance, Render sends the worker SIGTERM and, if it is still running after the service's shutdown delay, SIGKILL. The delay is `maxShutdownDelaySeconds`: default 30 seconds, at most 300 ([Render: deploys](https://render.com/docs/deploys)).

Render's docs give two ways to set it, the API and a Blueprint; there is no dashboard field. A teammate with a Render API key sets it once with the [Update service](https://api-docs.render.com/reference/update-service) endpoint (the service ID starts with `srv-` and is in the dashboard URL):

```sh
curl -X PATCH "https://api.render.com/v1/services/<service-id>" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"serviceDetails": {"maxShutdownDelaySeconds": 300}}'
```

Then make sure `PAYMENT_WORKER_SHUTDOWN_DELAY_SECONDS` is `300` too. The worker cannot read Render's setting, so the two must match. If the variable is larger than the real delay, Render kills a run the worker thinks still has time.

### Shutdown

On SIGTERM the worker claims nothing more. A run in progress gets the shutdown delay minus a 200-second reserve to finish on its own: 100 seconds with a 300-second delay. Most runs take less than that. Past it, the run ends the way it ends at its time limit:

- if the portal already answered a payment, the receipt and payment are saved (the run ends paid or failed);
- otherwise the run is flagged "The worker was stopped (a deploy or restart) before the run finished." with nothing paid, and an approver starts it again.

The run's deadline is checked before every model call and every tool call. The reserve covers the one call that may already be in flight at the deadline: a model call with its timeout on every retry (3 x 60 seconds) plus saving the result. So the worker exits before SIGKILL.

With the default 30-second delay there is no time left after the reserve: SIGTERM ends a run in progress at its next step, and the worker logs a warning at start.

If the worker is killed mid-run anyway (SIGKILL, a crash, running out of memory), the run stays `running`. The next claim flags it after 15 minutes and never runs it again, so nothing is paid twice. Check the vendor portal before you start such a run again.

During a deploy the new worker starts before the old one stops, so two workers can overlap for a short time. That is safe: a claim locks the run (`for update skip locked`), so each run is claimed by one worker.

### Memory

The worker runs one browser at a time: runs are sequential, every run closes its browser, and a second browser in the same process is refused. Chromium starts with `--disable-dev-shm-usage`: Docker gives `/dev/shm` only 64 MB and Render cannot raise it, so Chromium keeps that shared memory in `/tmp` instead of crashing pages. Measured in the image with a 512 MB limit, the worker with Chromium open on a page uses about 230 MB.

Start on **Starter**. Move to **Standard** (2 GB) only if memory runs out: the service's **Events** page shows an out-of-memory restart, or **Metrics** shows memory near 512 MB during runs. Change it under **Settings** > **Instance Type**.

### Logs

Open the worker in the dashboard and click **Logs**. Use **Live tail** to follow it. Lines to expect:

| Line | Meaning |
|------|---------|
| `Payment agent worker started: model ..., idle sleep 5s, heartbeat every 60s, shutdown delay 300s (a run in progress gets 100s to finish after SIGTERM)` | The worker started with these settings. |
| `Payment agent worker alive, idle (N run(s) since start)` | The heartbeat: once a minute while no run is in progress. |
| `Could not claim a payment run; retrying` | Supabase could not be reached or refused the claim; the worker retries every 5 seconds. |
| `Claimed payment run <id>` / `payment run <id> finished: paid` | A run started and ended (`paid`, `failed` or `flagged`). |
| `Got SIGTERM; claiming nothing more, a run in progress has 100s to finish` | A deploy or restart began. |
| `Payment agent worker stopped after N run(s)` | A clean exit. |

Search the logs for `worker alive` to see that it is running, or type `level:error` in the search box for errors. A run's own steps and flag reason are on the run (`GET /payment-runs/{run_id}`), not only in the log.

## Optional Blueprint

For reference only: do not commit a `render.yaml` (see above). The same worker as a Blueprint service:

```yaml
services:
  - type: worker
    name: payment-worker
    runtime: docker
    repo: https://github.com/<org>/<repo>
    branch: main
    region: <same region as the backend web service>
    plan: 0.5c-512mb # Starter; 1c-2g is Standard
    dockerfilePath: ./backend/payment-worker.Dockerfile
    dockerContext: ./backend
    maxShutdownDelaySeconds: 300
    autoDeployTrigger: checksPass
    buildFilter:
      paths:
        - backend/src/**
        - backend/pyproject.toml
        - backend/uv.lock
        - backend/payment-worker.Dockerfile
        - backend/.dockerignore
    envVars:
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_PUBLISHABLE_KEY
        sync: false
      - key: SUPABASE_SECRET_KEY
        sync: false
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: PAYMENT_AGENT_MODEL
        value: claude-opus-5-5
      - key: PAYMENT_WORKER_SHUTDOWN_DELAY_SECONDS
        value: "300"
```

## Upgrading playwright

The base image tag must match the playwright version in `backend/uv.lock`: the image's Chromium is the build that playwright release drives. When you upgrade playwright, change `PLAYWRIGHT_IMAGE` in `backend/payment-worker.Dockerfile` to the matching `mcr.microsoft.com/playwright/python:v<version>-noble` tag. `backend/tests/payment_agent/test_worker_image.py` fails until they match, and the CI image job fails if Chromium does not start.
