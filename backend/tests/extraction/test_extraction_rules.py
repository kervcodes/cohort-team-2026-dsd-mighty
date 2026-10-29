"""Tests that enforce rules from the DC-52 spec (see ENFORCEMENT.md)."""

import ast
import os
from pathlib import Path

import dotenv
import pytest
from conftest import MODEL_KEY_VARS

EXTRACTION_DIR = Path(__file__).resolve().parents[2] / "src" / "backend" / "extraction"


def forbidden_imports(source: str) -> list[str]:
    """Imported names that reach `supabase` or `backend.supabase_client`.

    `from backend import supabase_client` and relative forms are covered by
    also checking `module.alias` for every `from module import alias`.
    """
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names = [module, *(f"{module}.{alias.name}" for alias in node.names)]
        else:
            continue
        for name in names:
            segments = [part for part in name.split(".") if part]
            if segments and (
                segments[0] == "supabase" or "supabase_client" in segments
            ):
                found.append(name)
    return found


def test_extractor_never_imports_supabase():
    modules = sorted(EXTRACTION_DIR.rglob("*.py"))
    assert modules, f"no modules found under {EXTRACTION_DIR}"
    offenders = {
        str(path.relative_to(EXTRACTION_DIR)): forbidden_imports(path.read_text())
        for path in modules
    }
    assert {k: v for k, v in offenders.items() if v} == {}


@pytest.mark.parametrize(
    "source",
    [
        "import supabase",
        "import supabase.client",
        "from supabase import create_client",
        "from backend.supabase_client import get_supabase",
        "import backend.supabase_client",
        "from backend import supabase_client",
        "from .. import supabase_client",
        "from ..supabase_client import get_supabase",
    ],
)
def test_import_detector_catches_supabase(source: str):
    assert forbidden_imports(source)


@pytest.mark.parametrize(
    "source",
    [
        "import os",
        "from backend.schemas.bill import BillCreate",
        "from backend.extraction.schema import Issue",
        "from decimal import Decimal",
    ],
)
def test_import_detector_ignores_other_imports(source: str):
    assert forbidden_imports(source) == []


def test_run_has_no_model_api_keys():
    for var in MODEL_KEY_VARS:
        assert var not in os.environ


def test_late_dotenv_load_cannot_bring_keys_back(tmp_path: Path):
    env_file = tmp_path / ".env"
    env_file.write_text("ANTHROPIC_API_KEY=sk-test\nGEMINI_API_KEY=g-test\n")
    dotenv.load_dotenv(env_file)  # what supabase_client does at import
    for var in MODEL_KEY_VARS:
        assert var not in os.environ
