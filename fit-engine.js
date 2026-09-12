/**
 * fit-engine.js — geteilte Engine für FunctionGym
 *
 * Voraussetzungen (vom HTML VOR diesem Skript gesetzt):
 *   THEMA_KEY, THEMA_CONFIG, DIAGNOSE, THEORIE, AUFGABEN
 * Rendert in <div id="app">. KaTeX + auto-render werden vom HTML geladen.
 *
 * Ablauf: Eingangscheck (Diagnose) → Empfehlung → Technik (Theorie) → Workout (2 Stufen)
 */

(function () {
  'use strict';

  const STORAGE_KEY = THEMA_KEY;

  const DEFAULT_STATE = {
    diagnose: { richtig: 0, gesamt: 0, done: false },
    theorieGesehen: false,
    answered: [],
    totalCorrect: 0,
    totalAttempts: 0,
    stufe: 1
  };

  const STUFEN_NAMEN = { 1: 'Grund-Workout', 2: 'Fortgeschritten' };

  // ── Sitzungs-State (nicht persistiert) ──────────────────────

  let state = null;
  let phase = 'diagnose';          // 'diagnose' | 'empfehlung' | 'theorie' | 'workout'
  let currentAufgabe = null;       // aktuell angezeigte Aufgabe (ggf. mit gemischten Optionen)
  let feedbackShown = false;
  let antwortZeit = 0;             // Sperrfrist gegen Doppel-Enter
  let diagnoseIndex = 0;
  let sessionStats = { 1: { richtig: 0, gesamt: 0 }, 2: { richtig: 0, gesamt: 0 } };
  let zuordnungState = null;       // { rechtsOrder:[], selectedLinks, selectedRechts, pairs:{} }

  // ── LocalStorage ────────────────────────────────────────────

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_STATE));
    } catch (e) {
      state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
    // Korrupte Altwerte absichern, sonst crasht der Merge unten
    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
    if (typeof state.diagnose !== 'object' || state.diagnose === null || Array.isArray(state.diagnose)) {
      state.diagnose = JSON.parse(JSON.stringify(DEFAULT_STATE.diagnose));
    }
    if (!Array.isArray(state.answered)) state.answered = [];
    // fehlende Felder ergänzen (auch verschachtelt)
    for (const key of Object.keys(DEFAULT_STATE)) {
      if (state[key] === undefined) state[key] = JSON.parse(JSON.stringify(DEFAULT_STATE[key]));
    }
    for (const key of Object.keys(DEFAULT_STATE.diagnose)) {
      if (state.diagnose[key] === undefined) state.diagnose[key] = DEFAULT_STATE.diagnose[key];
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('FitGym: localStorage nicht verfügbar', e);
    }
  }

  // ── Antwort-Validierung ─────────────────────────────────────

  // Deutsche Komma-Schreibweise, Tausenderpunkte und Brucheingabe "a/b"
  function parseZahl(roh) {
    // Unicode-Minus (U+2212) wie normales Minus behandeln
    roh = String(roh).trim().replace(/\s+/g, '').replace(/−/g, '-');
    if (roh === '') return [];
    // Bruch a/b (Zähler/Nenner jeweils auch dezimal, Minus erlaubt)
    const bruch = roh.match(/^(-?\d+(?:[.,]\d+)?)\/(-?\d+(?:[.,]\d+)?)$/);
    if (bruch) {
      const z = parseFloat(bruch[1].replace(',', '.'));
      const n = parseFloat(bruch[2].replace(',', '.'));
      return (isNaN(z) || isNaN(n) || n === 0) ? [] : [z / n];
    }
    // Zwei Lesarten: Komma als Dezimaltrennzeichen und deutsche
    // Tausenderschreibweise ("1.628,89", "12.800")
    const lesarten = [];
    if (/^-?\d+(?:[.,]\d+)?$/.test(roh) || /^-?\.\d+$/.test(roh) || /^-?,\d+$/.test(roh)) {
      lesarten.push(parseFloat(roh.replace(',', '.')));
    }
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(roh)) {
      lesarten.push(parseFloat(roh.replace(/\./g, '').replace(',', '.')));
    }
    return lesarten.filter(v => !isNaN(v));
  }

  function validiereNumerisch(aufgabe, eingabe) {
    const toleranz = aufgabe.toleranz || 0;
    return parseZahl(eingabe).some(v => Math.abs(v - aufgabe.loesung) <= toleranz);
  }

  // ── Hilfsfunktionen ─────────────────────────────────────────

  function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
  }

  function shuffleIndices(n) {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    return idx;
  }

  // MC-/Multi-Optionen mischen, `korrekt` mitführen
  function mischeOptionen(aufgabe) {
    if (!aufgabe || !Array.isArray(aufgabe.optionen) || aufgabe.festeReihenfolge) return aufgabe;
    const idx = shuffleIndices(aufgabe.optionen.length);
    const kopie = Object.assign({}, aufgabe, {
      optionen: idx.map(i => aufgabe.optionen[i])
    });
    if (aufgabe.typ === 'mc') {
      kopie.korrekt = idx.indexOf(aufgabe.korrekt);
    } else if (aufgabe.typ === 'multi') {
      kopie.korrekt = aufgabe.korrekt.map(k => idx.indexOf(k)).sort((a, b) => a - b);
    }
    return kopie;
  }

  function renderMath(container) {
    if (typeof renderMathInElement === 'function' && container) {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
      });
    }
  }

  // ── UI-Bausteine ────────────────────────────────────────────

  function buildHeader() {
    const untertitel = THEMA_CONFIG.untertitel
      ? `<p>${escapeHtml(THEMA_CONFIG.untertitel)}</p>` : '';
    return `<header>
      <h1>${escapeHtml(THEMA_CONFIG.name)}</h1>
      ${untertitel}
      <a href="../index.html" class="back-link">&larr; Zur Übersicht</a>
    </header>`;
  }

  function buildStepper() {
    const schritte = [
      { key: 'diagnose', text: 'Eingangscheck', done: state.diagnose.done },
      { key: 'theorie', text: 'Technik', done: state.theorieGesehen },
      { key: 'workout', text: 'Workout', done: false }
    ];
    const aktiverKey = phase === 'empfehlung' ? 'diagnose' : phase;
    return `<div class="fit-stepper">` + schritte.map((s, i) => {
      const cls = (s.key === aktiverKey ? ' active' : '') + (s.done ? ' done' : '');
      const nr = s.done ? '' : (i + 1);
      const verbinder = i < schritte.length - 1 ? '<div class="fit-step-verbinder"></div>' : '';
      return `<button class="fit-step${cls}" data-phase="${s.key}" style="border:none;font-family:inherit;cursor:pointer">
        <span class="fit-step-nr">${nr}</span><span class="fit-step-text">${s.text}</span>
      </button>${verbinder}`;
    }).join('') + `</div>`;
  }

  function buildEingabeBereich(aufgabe) {
    if (aufgabe.typ === 'numerisch') {
      const einheit = aufgabe.einheit ? ` <span style="color:#6b7280">(in ${escapeHtml(aufgabe.einheit)})</span>` : '';
      return `<div class="fit-eingabe">
        <input type="text" id="antwortInput" placeholder="Deine Antwort..." autocomplete="off" inputmode="text">
        ${einheit}
        <br><button class="fit-btn" id="btnPruefen">Prüfen</button>
      </div>`;
    }
    if (aufgabe.typ === 'mc') {
      const labels = ['A', 'B', 'C', 'D'];
      return `<div class="fit-mc">` + aufgabe.optionen.map((opt, i) =>
        `<button class="fit-mc-option" data-index="${i}">${labels[i]}) ${opt}</button>`
      ).join('') + `</div>`;
    }
    if (aufgabe.typ === 'multi') {
      const boxen = aufgabe.optionen.map((opt, i) =>
        `<label class="fit-mc-option" style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" class="multi-check" data-index="${i}" style="width:18px;height:18px;flex-shrink:0"> <span>${opt}</span>
        </label>`
      ).join('');
      return `<div class="fit-mc">${boxen}</div>
        <div class="fit-eingabe"><button class="fit-btn" id="btnPruefen">Prüfen</button></div>`;
    }
    if (aufgabe.typ === 'zuordnung') {
      const links = aufgabe.paare.map((p, i) =>
        `<button data-li="${i}">${p.links}</button>`).join('');
      const rechts = zuordnungState.rechtsOrder.map(ri =>
        `<button data-ri="${ri}">${aufgabe.paare[ri].rechts}</button>`).join('');
      return `<div class="fit-zuordnung">
        <div class="fit-zuordnung-links">${links}</div>
        <div class="fit-zuordnung-rechts">${rechts}</div>
      </div>
      <div class="fit-eingabe"><button class="fit-btn" id="btnPruefen" style="display:none">Prüfen</button></div>`;
    }
    return '';
  }

  function buildTipp(aufgabe) {
    if (!aufgabe.tipp) return '';
    return `<div class="fit-tipp-box" id="tippBox"></div>
      <div style="text-align:center"><button class="fit-btn-ghost" id="btnTipp" style="color:var(--fit-primary);border-color:#d1d5db;background:#f8fafc">Tipp anzeigen</button></div>`;
  }

  // ── Haupt-Render ────────────────────────────────────────────

  function render(innerHtml) {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = buildHeader() + buildStepper() + innerHtml;
    renderMath(app);
    // Stepper-Klicks binden
    app.querySelectorAll('.fit-step').forEach(btn => {
      btn.addEventListener('click', () => gotoPhase(btn.dataset.phase));
    });
  }

  function gotoPhase(ziel) {
    feedbackShown = false;
    currentAufgabe = null;
    if (ziel === 'diagnose') {
      if (state.diagnose.done) { phase = 'empfehlung'; renderEmpfehlung(); }
      else startDiagnose();
    } else if (ziel === 'theorie') {
      phase = 'theorie';
      renderTheorie();
    } else {
      phase = 'workout';
      renderWorkout();
    }
  }

  // ── Phase 1: Eingangscheck ──────────────────────────────────

  // Zähler beim (Neu-)Start nullen — sonst verfälscht ein Abbruch
  // mitten in der Diagnose nach Reload die Quote (gesamt > DIAGNOSE.length)
  function startDiagnose() {
    state.diagnose = { richtig: 0, gesamt: 0, done: false };
    saveState();
    diagnoseIndex = 0;
    phase = 'diagnose';
    renderDiagnose();
  }

  function renderDiagnose() {
    if (diagnoseIndex >= DIAGNOSE.length) {
      state.diagnose.done = true;
      saveState();
      phase = 'empfehlung';
      renderEmpfehlung();
      return;
    }
    const aufgabe = mischeOptionen(DIAGNOSE[diagnoseIndex]);
    startAufgabe(aufgabe);
    render(`<div class="fit-karte">
      <div style="text-align:center;color:#6b7280;font-size:0.9rem;margin-bottom:12px">
        Eingangscheck — Aufgabe ${diagnoseIndex + 1} von ${DIAGNOSE.length}</div>
      <div class="fit-aufgabe-text">${aufgabe.frage}</div>
      ${buildEingabeBereich(aufgabe)}
      <div id="feedback"></div>
    </div>`);
    bindAufgabeEvents();
  }

  function renderEmpfehlung() {
    const d = state.diagnose;
    const quote = d.gesamt > 0 ? d.richtig / d.gesamt : 0;
    const techEmpfohlen = quote < 0.5;
    const text = d.gesamt > 0
      ? `Du hast <strong>${d.richtig} von ${d.gesamt}</strong> Aufgaben im Eingangscheck richtig gelöst.`
      : `Du hast den Eingangscheck noch nicht gemacht.`;
    const empfehlung = d.gesamt > 0
      ? (techEmpfohlen
        ? 'Empfehlung: Schau dir erst das <strong>Technik-Training</strong> an — dann läuft das Workout besser.'
        : 'Empfehlung: Du kannst <strong>direkt zum Workout</strong> — die Technik sitzt schon gut.')
      : '';
    render(`<div class="fit-empfehlung">
      <h2>Dein Ergebnis</h2>
      <p>${text}</p>
      <p>${empfehlung}</p>
      <div class="fit-empfehlung-buttons">
        <button id="btnTechnik" class="${techEmpfohlen ? 'empfohlen' : ''}">Technik-Training</button>
        <button id="btnWorkout" class="${!techEmpfohlen && d.gesamt > 0 ? 'empfohlen' : ''}">Zum Workout</button>
      </div>
      <div style="margin-top:16px">
        <button class="fit-btn-ghost" id="btnDiagnoseNeu" style="color:var(--fit-primary);border-color:#d1d5db;background:#f8fafc">Eingangscheck wiederholen</button>
      </div>
    </div>`);
    document.getElementById('btnTechnik').addEventListener('click', () => gotoPhase('theorie'));
    document.getElementById('btnWorkout').addEventListener('click', () => gotoPhase('workout'));
    document.getElementById('btnDiagnoseNeu').addEventListener('click', startDiagnose);
  }

  // ── Phase 2: Technik-Training ───────────────────────────────

  function renderTheorie() {
    const karten = THEORIE.map(t =>
      `<div class="fit-theorie"><h2>${escapeHtml(t.titel)}</h2>${t.html}</div>`
    ).join('');
    render(`${karten}
      <div style="text-align:center;margin-bottom:20px">
        <button class="fit-btn" id="btnZumWorkout">Weiter zum Workout &rarr;</button>
      </div>`);
    document.getElementById('btnZumWorkout').addEventListener('click', () => gotoPhase('workout'));
    if (!state.theorieGesehen) { state.theorieGesehen = true; saveState(); }
  }

  // ── Phase 3: Workout ────────────────────────────────────────

  function stufenAufgaben(stufe) {
    return AUFGABEN.filter(a => a.stufe === stufe);
  }

  function buildStufenSwitcher() {
    return `<div class="fit-stufen">
      <button data-stufe="1" class="${state.stufe === 1 ? 'active' : ''}">${STUFEN_NAMEN[1]}</button>
      <button data-stufe="2" class="${state.stufe === 2 ? 'active' : ''}">${STUFEN_NAMEN[2]}</button>
    </div>`;
  }

  function bindStufenSwitcher() {
    document.querySelectorAll('.fit-stufen button').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = parseInt(btn.dataset.stufe, 10);
        if (s !== state.stufe) {
          state.stufe = s;
          saveState();
          renderWorkout();
        }
      });
    });
  }

  function renderWorkout() {
    const tasks = stufenAufgaben(state.stufe);
    const offen = tasks.filter(a => !state.answered.includes(a.id));
    if (tasks.length === 0) {
      render(buildStufenSwitcher() + `<div class="fit-karte"><div class="fit-aufgabe-text">Für diese Stufe gibt es noch keine Aufgaben.</div></div>`);
      bindStufenSwitcher();
      return;
    }
    if (offen.length === 0) {
      renderAbschluss(tasks);
      return;
    }
    const aufgabe = mischeOptionen(offen[0]);
    startAufgabe(aufgabe);
    const erledigt = tasks.length - offen.length;
    render(buildStufenSwitcher() + `<div class="fit-karte">
      <div style="text-align:center;color:#6b7280;font-size:0.9rem;margin-bottom:12px">
        Aufgabe ${erledigt + 1} von ${tasks.length}</div>
      <div style="height:6px;background:#e5e7eb;border-radius:3px;margin-bottom:16px">
        <div style="height:100%;width:${Math.round(erledigt / tasks.length * 100)}%;background:linear-gradient(90deg,var(--fit-primary),var(--fit-secondary));border-radius:3px"></div>
      </div>
      <div class="fit-aufgabe-text">${aufgabe.frage}</div>
      ${buildEingabeBereich(aufgabe)}
      ${buildTipp(aufgabe)}
      <div id="feedback"></div>
    </div>`);
    bindStufenSwitcher();
    bindAufgabeEvents();
  }

  function renderAbschluss(tasks) {
    const s = sessionStats[state.stufe];
    const ergebnis = s.gesamt > 0
      ? `<div class="fit-ergebnis">
          <div class="fit-ergebnis-block richtig"><div class="wert">${s.richtig}</div><div class="label">richtig</div></div>
          <div class="fit-ergebnis-block falsch"><div class="wert">${s.gesamt - s.richtig}</div><div class="label">falsch</div></div>
        </div>
        <p>Diese Sitzung: ${s.richtig} von ${s.gesamt} richtig.</p>`
      : `<p>Alle Aufgaben dieser Stufe sind schon erledigt.</p>`;
    render(buildStufenSwitcher() + `<div class="fit-abschluss">
      <div class="fit-abschluss-emoji">&#127942;</div>
      <h2>${STUFEN_NAMEN[state.stufe]} geschafft!</h2>
      ${ergebnis}
      <div class="fit-abschluss-buttons">
        <button class="fit-btn" id="btnNochmal">Nochmal</button>
        <button class="fit-btn" id="btnAndereStufe">Andere Stufe</button>
        <a class="fit-btn" id="btnUebersicht" href="../index.html" style="text-decoration:none">Zur Übersicht</a>
      </div>
    </div>`);
    bindStufenSwitcher();
    document.getElementById('btnNochmal').addEventListener('click', () => {
      const ids = tasks.map(a => a.id);
      state.answered = state.answered.filter(id => !ids.includes(id));
      saveState();
      sessionStats[state.stufe] = { richtig: 0, gesamt: 0 };
      renderWorkout();
    });
    document.getElementById('btnAndereStufe').addEventListener('click', () => {
      state.stufe = state.stufe === 1 ? 2 : 1;
      saveState();
      renderWorkout();
    });
  }

  // ── Aufgaben-Interaktion ────────────────────────────────────

  function startAufgabe(aufgabe) {
    currentAufgabe = aufgabe;
    feedbackShown = false;
    zuordnungState = null;
    if (aufgabe.typ === 'zuordnung') {
      zuordnungState = {
        rechtsOrder: shuffleIndices(aufgabe.paare.length),
        selectedLinks: null,
        selectedRechts: null,
        pairs: {} // linksIndex → rechtsIndex (Original-Indizes)
      };
    }
  }

  function bindAufgabeEvents() {
    const btnPruefen = document.getElementById('btnPruefen');
    if (btnPruefen) btnPruefen.addEventListener('click', pruefeAntwort);

    const input = document.getElementById('antwortInput');
    if (input) {
      setTimeout(() => input.focus(), 50);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation(); // sonst löst derselbe Enter danach den document-Handler aus
          if (feedbackShown) weiter();
          else pruefeAntwort();
        }
      });
    }

    document.querySelectorAll('.fit-mc-option[data-index]').forEach(btn => {
      btn.addEventListener('click', function () {
        selectMC(parseInt(this.dataset.index, 10));
      });
    });

    if (currentAufgabe && currentAufgabe.typ === 'zuordnung') {
      document.querySelectorAll('.fit-zuordnung button').forEach(btn => {
        btn.addEventListener('click', function () { zuordnungKlick(this); });
      });
    }

    const btnTipp = document.getElementById('btnTipp');
    if (btnTipp) btnTipp.addEventListener('click', zeigeTipp);
  }

  function selectMC(index) {
    if (feedbackShown || !currentAufgabe || currentAufgabe.typ !== 'mc') return;
    document.querySelectorAll('.fit-mc-option').forEach((btn, i) =>
      btn.classList.toggle('selected', i === index));
    verarbeiteAntwort(index === currentAufgabe.korrekt, index);
  }

  function pruefeAntwort() {
    if (feedbackShown || !currentAufgabe) return;
    const a = currentAufgabe;

    if (a.typ === 'numerisch') {
      const input = document.getElementById('antwortInput');
      if (!input || input.value.trim() === '') return;
      verarbeiteAntwort(validiereNumerisch(a, input.value));
    } else if (a.typ === 'multi') {
      const gewaehlt = [];
      document.querySelectorAll('.multi-check').forEach(cb => {
        if (cb.checked) gewaehlt.push(parseInt(cb.dataset.index, 10));
      });
      gewaehlt.sort((x, y) => x - y);
      const soll = a.korrekt.slice().sort((x, y) => x - y);
      const correct = gewaehlt.length === soll.length && gewaehlt.every((v, i) => v === soll[i]);
      verarbeiteAntwort(correct);
    } else if (a.typ === 'zuordnung') {
      const z = zuordnungState;
      if (Object.keys(z.pairs).length !== a.paare.length) return;
      let alleKorrekt = true;
      document.querySelectorAll('.fit-zuordnung-links button').forEach(btn => {
        const li = parseInt(btn.dataset.li, 10);
        const richtig = z.pairs[li] === li;
        if (!richtig) alleKorrekt = false;
        const rBtn = document.querySelector(`.fit-zuordnung-rechts button[data-ri="${z.pairs[li]}"]`);
        btn.classList.remove('paired');
        btn.classList.add(richtig ? 'korrekt' : 'falsch');
        if (rBtn) { rBtn.classList.remove('paired'); rBtn.classList.add(richtig ? 'korrekt' : 'falsch'); }
      });
      verarbeiteAntwort(alleKorrekt);
    }
  }

  // ── Zuordnung: Tipp-Verbinden ───────────────────────────────

  function zuordnungKlick(btn) {
    if (feedbackShown) return;
    const z = zuordnungState;
    const istLinks = btn.dataset.li !== undefined;
    const idx = parseInt(istLinks ? btn.dataset.li : btn.dataset.ri, 10);

    // Bereits verbundenes Paar wieder antippen → lösen
    if (btn.classList.contains('paired')) {
      const li = istLinks ? idx : Object.keys(z.pairs).find(k => z.pairs[k] === idx);
      loesePaar(parseInt(li, 10));
      updateZuordnungUI();
      return;
    }

    if (istLinks) z.selectedLinks = (z.selectedLinks === idx) ? null : idx;
    else z.selectedRechts = (z.selectedRechts === idx) ? null : idx;

    // Beide Seiten gewählt → verbinden
    if (z.selectedLinks !== null && z.selectedRechts !== null) {
      z.pairs[z.selectedLinks] = z.selectedRechts;
      z.selectedLinks = null;
      z.selectedRechts = null;
    }
    updateZuordnungUI();
  }

  function loesePaar(li) {
    delete zuordnungState.pairs[li];
  }

  function updateZuordnungUI() {
    const z = zuordnungState;
    const paarNr = {}; // linksIndex → Badge-Nummer
    Object.keys(z.pairs).forEach((li, n) => { paarNr[li] = n + 1; });

    document.querySelectorAll('.fit-zuordnung-links button').forEach(btn => {
      const li = parseInt(btn.dataset.li, 10);
      const paired = z.pairs[li] !== undefined;
      btn.classList.toggle('paired', paired);
      btn.classList.toggle('selected', z.selectedLinks === li);
      if (paired) btn.dataset.paar = paarNr[li]; else delete btn.dataset.paar;
    });
    document.querySelectorAll('.fit-zuordnung-rechts button').forEach(btn => {
      const ri = parseInt(btn.dataset.ri, 10);
      const li = Object.keys(z.pairs).find(k => z.pairs[k] === ri);
      const paired = li !== undefined;
      btn.classList.toggle('paired', paired);
      btn.classList.toggle('selected', z.selectedRechts === ri);
      if (paired) btn.dataset.paar = paarNr[li]; else delete btn.dataset.paar;
    });

    const btnPruefen = document.getElementById('btnPruefen');
    if (btnPruefen) {
      btnPruefen.style.display =
        Object.keys(z.pairs).length === currentAufgabe.paare.length ? '' : 'none';
    }
  }

  // ── Antwort verarbeiten & Feedback ──────────────────────────

  function verarbeiteAntwort(correct, mcIndex) {
    feedbackShown = true;
    antwortZeit = Date.now();

    if (phase === 'diagnose') {
      state.diagnose.gesamt++;
      if (correct) state.diagnose.richtig++;
    } else {
      state.totalAttempts++;
      if (correct) state.totalCorrect++;
      state.answered.push(currentAufgabe.id);
      const s = sessionStats[state.stufe];
      s.gesamt++;
      if (correct) s.richtig++;
    }
    saveState();

    disableEingabe(correct, mcIndex);
    showFeedback(correct);
  }

  function disableEingabe(correct, mcIndex) {
    const input = document.getElementById('antwortInput');
    if (input) {
      input.disabled = true;
      input.classList.add(correct ? 'input-correct' : 'input-wrong');
    }
    const btnPruefen = document.getElementById('btnPruefen');
    if (btnPruefen) btnPruefen.disabled = true;

    if (currentAufgabe.typ === 'mc') {
      document.querySelectorAll('.fit-mc-option').forEach((btn, i) => {
        btn.disabled = true;
        if (i === currentAufgabe.korrekt) btn.classList.add('correct');
        else if (i === mcIndex && !correct) btn.classList.add('wrong');
      });
    }
    if (currentAufgabe.typ === 'multi') {
      document.querySelectorAll('.multi-check').forEach(cb => {
        cb.disabled = true;
        const i = parseInt(cb.dataset.index, 10);
        const label = cb.closest('.fit-mc-option');
        if (currentAufgabe.korrekt.includes(i)) label.classList.add('correct');
        else if (cb.checked) label.classList.add('wrong');
      });
    }
    const btnTipp = document.getElementById('btnTipp');
    if (btnTipp) btnTipp.style.display = 'none';
  }

  function showFeedback(correct) {
    const fb = document.getElementById('feedback');
    if (!fb) return;

    const icon = correct
      ? '<div class="fit-feedback-icon">&check; Richtig!</div>'
      : '<div class="fit-feedback-icon">&cross; Leider falsch.</div>';
    const loesung = currentAufgabe.loesungsweg
      ? `<div class="fit-loesungsweg"><strong>Lösungsweg:</strong> ${currentAufgabe.loesungsweg}</div>`
      : '';

    fb.innerHTML = `<div class="fit-feedback ${correct ? 'fit-feedback-richtig' : 'fit-feedback-falsch'}">
      ${icon}${loesung}
      <button class="fit-btn" id="btnWeiter">Weiter &rarr;</button>
    </div>`;
    renderMath(fb);

    const btnWeiter = document.getElementById('btnWeiter');
    btnWeiter.addEventListener('click', weiter);
    setTimeout(() => btnWeiter.focus(), 50);
  }

  function weiter() {
    if (!feedbackShown) return;
    feedbackShown = false;
    if (phase === 'diagnose') {
      diagnoseIndex++;
      renderDiagnose();
    } else {
      renderWorkout();
    }
  }

  function zeigeTipp() {
    if (!currentAufgabe || !currentAufgabe.tipp || feedbackShown) return;
    const box = document.getElementById('tippBox');
    if (!box) return;
    box.innerHTML = `<strong>Tipp:</strong> ${currentAufgabe.tipp}`;
    box.classList.add('visible');
    renderMath(box);
    const btnTipp = document.getElementById('btnTipp');
    if (btnTipp) btnTipp.style.display = 'none';
  }

  // ── Keyboard ────────────────────────────────────────────────

  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

      if (e.key === 'Enter') {
        if (feedbackShown) {
          // Sperrfrist: Autorepeat/Doppel-Enter direkt nach der Antwort abfangen
          if (e.repeat || Date.now() - antwortZeit < 400) return;
          e.preventDefault();
          weiter();
        } else if (currentAufgabe &&
          (currentAufgabe.typ === 'multi' || currentAufgabe.typ === 'zuordnung')) {
          e.preventDefault();
          pruefeAntwort();
        }
        return;
      }

      if ((e.key === 't' || e.key === 'T') && !feedbackShown) {
        zeigeTipp();
        return;
      }

      // 1–4 → MC-Auswahl
      if (!feedbackShown && currentAufgabe && currentAufgabe.typ === 'mc') {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 4 && num - 1 < currentAufgabe.optionen.length) {
          e.preventDefault();
          selectMC(num - 1);
        }
      }
    });
  }

  // ── Init ────────────────────────────────────────────────────

  function initApp() {
    loadState();
    initKeyboard();
    if (state.diagnose.done) {
      phase = 'empfehlung';
      renderEmpfehlung();
    } else {
      startDiagnose();
    }
  }

  // Lese-Hooks für Tests
  window.fitState = function () { return state; };
  window.fitAktuelleAufgabe = function () { return currentAufgabe; };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
