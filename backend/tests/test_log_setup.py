"""The app's INFO lines reach stderr, as they must on Render.

Each check runs a fresh interpreter: pytest installs its own log handlers, so
only a clean process shows what the server process prints.
"""

import logging
import os
import subprocess
import sys

from backend.log_setup import APP_LOGGER, configure_logging

EMIT = """
import logging
import backend.app  # configures logging on import, like uvicorn's import
logging.getLogger("backend.extraction.extract").info("info-marker")
logging.getLogger("backend.api.bill_extraction").warning("warning-marker")
"""


def run_app_process(**env: str) -> str:
    done = subprocess.run(
        [sys.executable, "-c", EMIT],
        capture_output=True,
        text=True,
        env={**os.environ, **env},
        check=True,
    )
    return done.stderr


def test_info_lines_from_the_app_reach_stderr_once():
    stderr = run_app_process()
    assert stderr.count("info-marker") == 1
    assert stderr.count("warning-marker") == 1
    assert "INFO:     backend.extraction.extract - info-marker" in stderr


def test_log_level_can_be_raised():
    stderr = run_app_process(LOG_LEVEL="warning")
    assert "info-marker" not in stderr
    assert "warning-marker" in stderr


def test_an_unknown_log_level_falls_back_to_info():
    assert "info-marker" in run_app_process(LOG_LEVEL="loud")


def test_configuring_twice_adds_no_second_handler():
    configure_logging()
    configure_logging()
    marked = [
        h
        for h in logging.getLogger(APP_LOGGER).handlers
        if getattr(h, "_backend_app", False)
    ]
    assert len(marked) == 1
