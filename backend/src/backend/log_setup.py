"""Make the app's own log lines visible.

uvicorn configures only its own loggers, so without this every `backend.*`
INFO line (extraction model, tokens and cost, request metadata) is dropped and
only warnings reach stderr through Python's last-resort handler. Render shows
the process's stderr as the service log.
"""

import logging
import os

APP_LOGGER = "backend"
DEFAULT_LEVEL = "INFO"
FORMAT = "%(levelname)s:     %(name)s - %(message)s"  # lines up with uvicorn's


def configure_logging() -> None:
    """Send `backend.*` records at `LOG_LEVEL` (default INFO) to stderr.

    Safe to call more than once. Records still propagate to the root logger,
    so pytest's `caplog` sees them; uvicorn leaves the root without handlers,
    so nothing prints twice.
    """
    logger = logging.getLogger(APP_LOGGER)
    level = os.environ.get("LOG_LEVEL", DEFAULT_LEVEL).strip().upper()
    logger.setLevel(level if level in logging.getLevelNamesMapping() else "INFO")
    if not any(getattr(h, "_backend_app", False) for h in logger.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(FORMAT))
        handler._backend_app = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
