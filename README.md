# FunctionGym

FunctionGym — das Fitnessstudio für Funktionen. Interaktiver Mathe-Trainer zur Wiederholung der Funktionen-Grundlagen für den Übergang in die Oberstufe (E-Phase). Themen: Grundbegriffe, lineare, quadratische, Potenz-/Wurzel-, Exponential- und trigonometrische Funktionen plus Misch-Workout. Statisches HTML, läuft auf GitHub Pages, Fortschritt lokal im Browser (localStorage), keine Accounts.

## Projektstruktur

```
FunctionGym/
├── index.html      # Startseite mit Themenübersicht und Fortschrittsanzeige
├── fit.css         # Zentrales Stylesheet für alle Seiten
├── fit-engine.js   # Trainer-Engine: Aufgabenlogik, Auswertung, localStorage-Fortschritt
├── gym/            # Themen-Seiten (eine HTML-Datei pro Thema)
└── tests/          # Tests
```

## Tests

Playwright-Testsuite: prüft jede Themen-Seite in `gym/` statisch (Datenqualität, KaTeX, JS-Fehler) und interaktiv (Diagnose + Workout Stufe 1 komplett durchspielen).
Installation: `pip install -r tests/requirements.txt` (einmalig zusätzlich `playwright install chromium`).
Ausführung: `cd tests && pytest` — HTML-Report landet in `tests/reports/`.
