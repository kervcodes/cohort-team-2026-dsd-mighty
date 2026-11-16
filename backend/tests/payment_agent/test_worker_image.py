"""The worker's Docker image (payment-worker.Dockerfile) matches the lockfile.
CI builds and smoke-tests the image itself (the payment-worker-image job);
these catch the mismatch in seconds, with the fix in the message."""

import re
import tomllib
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
DOCKERFILE = BACKEND / "payment-worker.Dockerfile"
DOCKERIGNORE = BACKEND / ".dockerignore"


def locked_version(package: str) -> str:
    lock = tomllib.loads((BACKEND / "uv.lock").read_text())
    versions = [p["version"] for p in lock["package"] if p["name"] == package]
    assert len(versions) == 1, versions
    return versions[0]


def test_base_image_is_the_playwright_release_in_uv_lock():
    match = re.search(
        r"^ARG PLAYWRIGHT_IMAGE=mcr\.microsoft\.com/playwright/python:v(\S+?)-noble$",
        DOCKERFILE.read_text(),
        re.MULTILINE,
    )
    assert match, "payment-worker.Dockerfile must pin the Playwright Python image"
    locked = locked_version("playwright")
    assert match.group(1) == locked, (
        f"uv.lock has playwright {locked} but the worker image is based on "
        f"v{match.group(1)}; set PLAYWRIGHT_IMAGE in payment-worker.Dockerfile to "
        f"mcr.microsoft.com/playwright/python:v{locked}-noble"
    )


def test_build_context_keeps_secrets_and_tests_out():
    lines = DOCKERIGNORE.read_text().splitlines()
    rules = [line for line in lines if line and not line.startswith("#")]
    # Ignore everything, then allow back only the files the image builds from.
    assert rules[0] == "*"
    allowed = {rule[1:] for rule in rules if rule.startswith("!")}
    assert allowed == {"pyproject.toml", "uv.lock", "src/"}
