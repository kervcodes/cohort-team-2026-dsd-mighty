"""The key-stripping fixture in tests/conftest.py covers tests outside
`tests/extraction/` too (see ENFORCEMENT.md)."""

import os

import dotenv
from conftest import MODEL_KEY_VARS


def test_tests_outside_extraction_run_without_model_api_keys():
    for var in MODEL_KEY_VARS:
        assert var not in os.environ
    # The guard is installed here as well, so a late .env load cannot add keys.
    assert dotenv.load_dotenv.__name__ == "guarded_load_dotenv"
