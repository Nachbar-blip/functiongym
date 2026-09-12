"""Fixtures fuer die FunctionGym-Testsuite.

Themen-Dateien werden per Glob aus gym/ gelesen — keine handgepflegte Liste.
Ein leeres gym/ laesst die Suite sauber durchlaufen (alle Tests uebersprungen).

Env-Overrides:
  FITGYM_GYM_DIR   — alternativer gym-Ordner (Glob-Quelle + file://-Basis),
                     z.B. fuer eine Wegwerf-Probe ausserhalb des Repos.
  FITGYM_BASE_URL  — http(s)-Basis-URL statt file:// (Glob bleibt lokal).
"""

import os
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

GYM_DIR = Path(os.environ.get(
    "FITGYM_GYM_DIR",
    Path(__file__).resolve().parent.parent / "gym"))

BASE_URL = os.environ.get("FITGYM_BASE_URL", GYM_DIR.as_uri())

GYM_FILES = sorted(p.name for p in GYM_DIR.glob("*.html")) if GYM_DIR.is_dir() else []


@pytest.fixture(scope="session")
def browser():
    """Ein Browser fuer die ganze Suite."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def page(browser):
    """Frischer Context pro Test — leert localStorage automatisch."""
    context = browser.new_context()
    page = context.new_page()
    yield page
    context.close()


def pytest_generate_tests(metafunc):
    """Parametrisiert alle Tests mit den gefundenen Themen-Dateien."""
    if "gym_file" in metafunc.fixturenames:
        metafunc.parametrize(
            "gym_file", GYM_FILES,
            ids=[f.replace(".html", "") for f in GYM_FILES])
