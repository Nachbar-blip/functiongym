"""Playwright-Tests fuer alle FunctionGym-Themen-Seiten (gym/*.html)."""

from helpers import (
    load_gym, datei_inhalt, setup_console_error_capture, kritische_fehler,
    beantworte_aktuelle_aufgabe,
)


class TestGymStatisch:
    """Statische Pruefungen der Daten-Globals und der Seite."""

    def test_seite_laedt_ohne_fehler(self, page, gym_file):
        """Seite laedt ohne console.error und ohne KaTeX-Fehler."""
        errors = setup_console_error_capture(page)
        load_gym(page, gym_file)
        critical = kritische_fehler(errors)
        assert not critical, f"{gym_file}: JS-Fehler: {critical}"
        katex = page.evaluate("document.querySelectorAll('.katex-error').length")
        assert katex == 0, f"{gym_file}: {katex} KaTeX-Fehler"

    def test_aufgaben_umfang_und_stufen(self, page, gym_file):
        """AUFGABEN hat 8-12 Eintraege, beide Stufen vertreten."""
        load_gym(page, gym_file)
        aufgaben = page.evaluate("AUFGABEN")
        assert 8 <= len(aufgaben) <= 12, f"{gym_file}: {len(aufgaben)} Aufgaben"
        stufen = {a["stufe"] for a in aufgaben}
        assert stufen == {1, 2}, f"{gym_file}: Stufen {stufen} statt {{1, 2}}"

    def test_ids_eindeutig_und_numerisch(self, page, gym_file):
        """Aufgaben-IDs sind eindeutige Numbers."""
        load_gym(page, gym_file)
        ids = page.evaluate("AUFGABEN.map(a => a.id)")
        assert all(isinstance(i, (int, float)) for i in ids), \
            f"{gym_file}: nicht-numerische IDs: {ids}"
        assert len(ids) == len(set(ids)), f"{gym_file}: doppelte IDs: {ids}"

    def test_loesungsweg_und_tipp(self, page, gym_file):
        """Jede Aufgabe hat nicht-leeren loesungsweg und tipp."""
        load_gym(page, gym_file)
        aufgaben = page.evaluate("AUFGABEN")
        for a in aufgaben:
            for feld in ("loesungsweg", "tipp"):
                wert = a.get(feld)
                assert isinstance(wert, str) and wert.strip(), \
                    f"{gym_file}: Aufgabe {a.get('id')}: {feld} fehlt/leer"

    def test_diagnose(self, page, gym_file):
        """DIAGNOSE hat 3-4 Eintraege, jede mit loesungsweg."""
        load_gym(page, gym_file)
        diagnose = page.evaluate("DIAGNOSE")
        assert 3 <= len(diagnose) <= 4, f"{gym_file}: {len(diagnose)} Diagnose-Aufgaben"
        for d in diagnose:
            wert = d.get("loesungsweg")
            assert isinstance(wert, str) and wert.strip(), \
                f"{gym_file}: Diagnose-Aufgabe ohne loesungsweg: {d.get('frage')}"

    def test_theorie(self, page, gym_file):
        """THEORIE nicht leer, jedes Element hat titel und html."""
        load_gym(page, gym_file)
        theorie = page.evaluate("THEORIE")
        assert theorie, f"{gym_file}: THEORIE ist leer"
        for t in theorie:
            for feld in ("titel", "html"):
                wert = t.get(feld)
                assert isinstance(wert, str) and wert.strip(), \
                    f"{gym_file}: Theorie-Element ohne {feld}"

    def test_typ_felder(self, page, gym_file):
        """Typ-spezifische Pflichtfelder aller Aufgaben (inkl. Diagnose)."""
        load_gym(page, gym_file)
        alle = page.evaluate("DIAGNOSE.concat(AUFGABEN)")
        for a in alle:
            typ = a.get("typ")
            wo = f"{gym_file}: Aufgabe id={a.get('id')} typ={typ}"
            if typ in ("mc", "multi"):
                assert isinstance(a.get("optionen"), list) and a["optionen"], \
                    f"{wo}: optionen fehlen"
                if typ == "mc":
                    assert isinstance(a.get("korrekt"), (int, float)), \
                        f"{wo}: korrekt muss Number sein"
                else:
                    assert isinstance(a.get("korrekt"), list) and a["korrekt"], \
                        f"{wo}: korrekt muss nicht-leeres Array sein"
            elif typ == "numerisch":
                assert isinstance(a.get("loesung"), (int, float)), \
                    f"{wo}: loesung muss numerisch sein"
            elif typ == "zuordnung":
                assert isinstance(a.get("paare"), list) and len(a["paare"]) >= 3, \
                    f"{wo}: mindestens 3 paare noetig"
            else:
                raise AssertionError(f"{wo}: unbekannter Typ")

    def test_thema_key(self, page, gym_file):
        """THEMA_KEY beginnt mit fitgym-."""
        load_gym(page, gym_file)
        key = page.evaluate("THEMA_KEY")
        assert isinstance(key, str) and key.startswith("fitgym-"), \
            f"{gym_file}: THEMA_KEY '{key}' beginnt nicht mit 'fitgym-'"

    def test_verbotene_begriffe(self, gym_file):
        """Seiten-HTML enthaelt kein 'eduki' (case-insensitive)."""
        inhalt = datei_inhalt(gym_file).lower()
        assert "eduki" not in inhalt, f"{gym_file}: verbotener Begriff 'eduki'"


class TestGymInteraktiv:
    """Diagnose und Workout Stufe 1 komplett korrekt durchspielen."""

    def test_diagnose_durchspielen(self, page, gym_file):
        """Alle Diagnose-Aufgaben korrekt -> Empfehlungsscreen erscheint."""
        load_gym(page, gym_file)
        anzahl = page.evaluate("DIAGNOSE.length")
        for _ in range(anzahl):
            beantworte_aktuelle_aufgabe(page)
        page.wait_for_selector(".fit-empfehlung", timeout=5000)
        d = page.evaluate("fitState().diagnose")
        assert d["done"] and d["richtig"] == anzahl, \
            f"{gym_file}: Diagnose-State {d} statt {anzahl}/{anzahl} richtig"

    def test_workout_stufe1_durchspielen(self, page, gym_file):
        """Workout Stufe 1 komplett korrekt -> Abschluss-Screen erscheint."""
        load_gym(page, gym_file)
        # Diagnose ueberspringen: direkt in die Workout-Phase wechseln
        page.click(".fit-step[data-phase='workout']")
        page.wait_for_selector(".fit-stufen", timeout=5000)
        anzahl = page.evaluate("AUFGABEN.filter(a => a.stufe === 1).length")
        for _ in range(anzahl):
            beantworte_aktuelle_aufgabe(page)
        page.wait_for_selector(".fit-abschluss", timeout=5000)
        s = page.evaluate("fitState()")
        assert s["totalCorrect"] == anzahl, \
            f"{gym_file}: {s['totalCorrect']}/{anzahl} richtig im Workout"
