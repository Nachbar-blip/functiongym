"""Hilfsfunktionen fuer die FunctionGym-Playwright-Tests."""

import re

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


def beantworte_aktuelle_aufgabe_falsch(page: Page):
    """Beantwortet die aktuell angezeigte Aufgabe absichtlich falsch."""
    aufgabe = page.evaluate("fitAktuelleAufgabe()")
    assert aufgabe, "Keine aktuelle Aufgabe (fitAktuelleAufgabe() leer)"
    typ = aufgabe["typ"]

    if typ == "numerisch":
        page.fill("#antwortInput", str(aufgabe["loesung"] + 987654))
        page.click("#btnPruefen")
    elif typ == "mc":
        falsch = next(i for i in range(len(aufgabe["optionen"]))
                      if i != aufgabe["korrekt"])
        page.click(f".fit-mc-option[data-index='{falsch}']")
    elif typ == "multi":
        # Genau eine falsche Auswahl: Komplement der korrekten Menge,
        # oder (falls alle korrekt) nur die erste Option
        alle = set(range(len(aufgabe["optionen"])))
        auswahl = alle - set(aufgabe["korrekt"]) or {0}
        for i in auswahl:
            page.check(f".multi-check[data-index='{i}']")
        page.click("#btnPruefen")
    elif typ == "zuordnung":
        # Erste beide Paare vertauschen, Rest korrekt
        n = len(aufgabe["paare"])
        ziel = list(range(n))
        ziel[0], ziel[1] = ziel[1], ziel[0]
        for i in range(n):
            page.click(f".fit-zuordnung-links button[data-li='{i}']")
            page.click(f".fit-zuordnung-rechts button[data-ri='{ziel[i]}']")
        page.click("#btnPruefen")
    else:
        raise AssertionError(f"Unbekannter Aufgabentyp: {typ}")

    page.wait_for_selector("#feedback .fit-feedback-falsch", timeout=5000)
    page.click("#btnWeiter")


def klartext(text: str) -> str:
    """Entfernt HTML-Tags, LaTeX-Befehle und Formel-Klammern aus einem Text.

    Uebrig bleibt der lesbare Inhalt samt Zahlen — die Grundlage fuer den
    Vergleich von Tipp, Frage und Antwortoptionen.
    """
    text = re.sub(r"<[^>]*>", " ", text)
    text = re.sub(r"\[a-zA-Z]+", " ", text)
    text = re.sub(r"[{}()\\[\]]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def ohne_leerzeichen(text: str) -> str:
    """Text ohne jedes Leerzeichen — fuer robusten Woertlich-Vergleich."""
    return re.sub(r"\s+", "", text)


def zahl_varianten(wert) -> list:
    """Schreibweisen, in denen ein Loesungswert im Text auftauchen kann.

    Deckt Punkt- und Komma-Dezimaltrennung sowie die auf zwei Stellen
    gerundete Form ab (etwa 2/3 als 0,67).
    """
    varianten = []
    for zahl in (wert, round(float(wert), 2)):
        roh = ("%g" % zahl) if isinstance(zahl, float) else str(zahl)
        for form in (roh, roh.replace(".", ",")):
            if form not in varianten:
                varianten.append(form)
    return varianten


def enthaelt_zahl(text: str, zahl: str) -> bool:
    """Prueft, ob `zahl` als eigenstaendige Zahl in `text` vorkommt.

    Verhindert Falschtreffer wie die 3 in 32 oder in 0,39.
    """
    muster = r"(?<![0-9,.])" + re.escape(zahl) + r"(?![0-9,.])"
    return re.search(muster, text) is not None
