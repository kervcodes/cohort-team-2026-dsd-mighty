# The payment agent worker (python -m backend.payment_agent.worker), for a
# Render Background Worker. Build from backend/:
#   docker build -f payment-worker.Dockerfile -t payment-worker .
# See docs/payment-worker.md.
#
# The base is Microsoft's Playwright image for the exact playwright version in
# uv.lock (1.65.2): its Chromium in /ms-playwright and its system libraries
# are the ones that playwright release drives. Bump this tag whenever uv.lock
# changes playwright; CI's payment-worker-image job fails until they match.
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright/python:v1.65.2-noble

# Build: install the locked dependencies and the backend package into a venv.
FROM ${PLAYWRIGHT_IMAGE} AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.24 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PYTHON=/usr/bin/python3 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /src
# Dependencies first, so a code change does not reinstall them.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
# Non-editable: the venv holds the backend package, so src/ is not shipped.
RUN uv sync --locked --no-dev --no-editable

# Runtime: the Playwright image plus the venv, run as the image's pwuser.
FROM ${PLAYWRIGHT_IMAGE}
# tini as PID 1 reaps Chromium's orphaned helper processes (Playwright's
# Docker docs recommend an init) and forwards SIGTERM to the worker only, so
# Chromium keeps working while a run wraps up.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
USER pwuser
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "backend.payment_agent.worker"]
