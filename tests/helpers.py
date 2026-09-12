"""Hilfsfunktionen fuer die FunctionGym-Playwright-Tests."""

from playwright.sync_api import Page

from conftest import BASE_URL, GYM_DIR


def load_gym(page: Page, gym_file: str, timeout: int = 30000):
    """Laedt eine Themen-Seite und wartet, bis die Engine gerendert hat."""
    response = page.goto(f"{BASE_URL}/{gym_file}", timeout=timeout,
                         wait_until="networkidle")
    page.wait_for_selector("#app .fit-stepper", timeout=timeout)
    return response


def datei_inhalt(gym_file: str) -> str:
    """Roh-HTML der Themen-Datei vom Dateisystem (inkl. Kommentare)."""
    return (GYM_DIR / gym_file).read_text(encoding="utf-8")


def setup_console_error_capture(page: Page) -> list:
    """Sammelt console.error-Meldungen. VOR page.goto() aufrufen."""
    errors = []
    page.on("console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    return errors


def kritische_fehler(errors: list) -> list:
    """Filtert unkritische Meldungen (CORS, deprecated, favicon)."""
    return [e for e in errors
            if "CORS" not in e and "deprecated" not in e.lower()
            and "favicon" not in e.lower()]


def beantworte_aktuelle_aufgabe(page: Page):
    """Beantwortet die aktuell angezeigte Aufgabe korrekt.

    Nutzt den Test-Hook window.fitAktuelleAufgabe() — der liefert die Aufgabe
    inkl. gemischter Optionen, also stimmen die Indizes mit dem DOM ueberein.
    """
    aufgabe = page.evaluate("fitAktuelleAufgabe()")
    assert aufgabe, "Keine aktuelle Aufgabe (fitAktuelleAufgabe() leer)"
    typ = aufgabe["typ"]

    if typ == "numerisch":
        page.fill("#antwortInput", str(aufgabe["loesung"]).replace(".", ","))
        page.click("#btnPruefen")
    elif typ == "mc":
        page.click(f".fit-mc-option[data-index='{aufgabe['korrekt']}']")
    elif typ == "multi":
        for i in aufgabe["korrekt"]:
            page.check(f".multi-check[data-index='{i}']")
        page.click("#btnPruefen")
    elif typ == "zuordnung":
        # Korrekte Zuordnung: links-Index == rechts-Original-Index (data-ri)
        for i in range(len(aufgabe["paare"])):
            page.click(f".fit-zuordnung-links button[data-li='{i}']")
            page.click(f".fit-zuordnung-rechts button[data-ri='{i}']")
        page.click("#btnPruefen")
    else:
        raise AssertionError(f"Unbekannter Aufgabentyp: {typ}")

    # Feedback muss erscheinen und die Antwort als richtig werten
    page.wait_for_selector("#feedback .fit-feedback-richtig", timeout=5000)
    page.click("#btnWeiter")
