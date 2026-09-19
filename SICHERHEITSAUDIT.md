# PVPro v6.17 – Code-Audit: Schwachstellen, Zentralisierung & Verbesserungsvorschläge

**Stand:** 19.09.2026 · **Branch:** `arena/01a0b961-pvpro` · **Umfang:** `index.html`, `app.js`, `database.js`, `content.js`, `sw.js`, `manifest.json` (2.496 Zeilen)

> **Umsetzungsstand v7.0 (19.09.2026):** Alle P0-, P1- und P2-Maßnahmen dieses Berichts wurden umgesetzt und per Node-Testsuite (20 Assertions: Escaping, Schema-Validierung, Physik, EEG, Normierung) verifiziert. Details s. Changelog in `content.js` und `DEVELOPMENT_GUIDELINES.md` v7.0. Offen als dokumentiertes TODO: SRI-Hash für Chart.js nachtragen, sobald einmalig Netz verfügbar ist (Version ist bereits gepinnt); Tailwind-Build statt Play-CDN als mittelfristiger Schritt.

---

## 1. Management Summary

| Bereich | Bewertung | Kurzfazit |
|---|---|---|
| Sicherheit (XSS, Injection) | 🔴 kritisch | Gespeicherte XSS über String-Namen, Gruppen, eigene Hardware möglich; kein Escaping, keine CSP |
| Supply Chain (CDN) | 🟠 hoch | Keine SRI-Hashes, Chart.js ohne Versions-Pin, Tailwind Play-CDN (nicht für Produktion) |
| Eingabevalidierung & Robustheit | 🟠 hoch | Inkonsistentes LocalStorage-Parsing (Absturz möglich), keine Werte-Clampings, kein API-Timeout |
| Physik-/Finanz-Logik | 🟡 mittel | 2 echte Rechenfehler (Voc-Kälte-Delta, Lastprofil-Normierung) + mehrere Ungenauigkeiten |
| Zentralisierung Logik | 🟡 mittel | Module grob getrennt, aber Magic Numbers überall, tote Codepfade, implizite Render-Kaskaden |
| Zentralisierung Design | 🟡 mittel | Primary/Accent via CSS-Variablen ✓, Rest (Status, Charts, Typo) hartcodiert und dupliziert |
| PWA / Service Worker | 🟡 mittel | Install schlägt komplett fehl, wenn 1 CDN-Asset offline ist; kein Offline-Fallback für Navigation |
| Barrierefreiheit / UX | 🟢 niedrig | Kleinere Mängel (aria-Labels, Dark-Mode-Lücke, Tippfehler, alert/confirm) |

**Wichtigste Einzelmaßnahme:** `escapeHtml()`-Helper + Event-Delegation statt Inline-`onclick` (schließt XSS + ID-Injection in einem Schritt).

---

## 2. Sicherheit (Priorität 0)

### 2.1 Gespeichertes XSS (Stored Cross-Site Scripting) — KRITISCH
Alle folgenden Stellen interpolieren **ungefilterte Nutzerdaten** in `innerHTML`:

| Stelle | Nutzerkontrollierte Variable | Persistenz |
|---|---|---|
| `app.js:375` String-Titel | `str.name` | LocalStorage `pvpro_strings` |
| `app.js:405` Gruppen-Input `value="…"` | `str.group` | LocalStorage (Attribut-Breakout möglich) |
| `app.js:400` Namens-Input `value="…"` | `str.name` | dito |
| `app.js:936–939` Gruppenübersicht | `g.name` (aus `group \|\| name`) | dito |
| `app.js:1105–1145` Geräte-DB | `w.name`, `p.name`, `b.name` | LocalStorage `pvpro_user_db` (Custom-Hardware-Formular) |
| `app.js:331–332` `<optgroup label="…">` | Modell-/Seriennamen | dito |

**Angriffsbeispiel:** String-Name `"><img src=x onerror=alert(document.cookie)>` → wird bei jedem Rendern ausgeführt, überlebt Reloads (LocalStorage), trifft auch andere Geräte bei Profil-Sync.
Zusätzlich `style="background-color: ${str.color}"` (`app.js:373`) → CSS-Injection bei manipuliertem LocalStorage.

**Fix:**
```js
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Anwendung: ${escapeHtml(str.name)}, value="${escapeHtml(str.group)}", Farben nur nach isHexColor()
```

### 2.2 Code-Injection über IDs in Inline-Handlern — HOCH
`onclick="toggleEditMode(${str.id})"` (`app.js:382,440,453,465,471`), `onclick="setFocus(${idx})"` (`app.js:936`), `onchange="updateInverterBattery(${w.id}, …)"` (`app.js:1123`).
IDs stammen aus LocalStorage (`pvpro_strings`, `pvpro_user_db`) und werden **nie validiert**. Ein manipulierter Wert wie `1);alert(1);//` wird als JS ausgeführt.

**Fix (empfohlen):** Inline-Handler komplett ersetzen durch **Event-Delegation**:
```html
<button data-action="toggle-edit" data-id="123">
```
```js
document.getElementById('stringsList').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]'); if(!btn) return;
  const id = Number(btn.dataset.id); if(!Number.isFinite(id)) return;
  // dispatch nach btn.dataset.action
});
```
Das beseitigt die ganze Angriffsklasse und ist Voraussetzung für eine wirksame CSP.

### 2.3 Fehlende Content Security Policy — HOCH
`index.html` hat **kein CSP-Meta**, keine `X-Frame-Options`, keine `Referrer-Policy` → Clickjacking möglich, keine zweite Verteidigungslinie gegen XSS.

**Fix:** CSP-Meta ergänzen. Achtung: Das **Tailwind Play-CDN braucht `unsafe-inline`/`unsafe-eval`** und höhlt jede CSP aus → mittelfristig auf **kompiliertes Tailwind** (Build-Step) oder selbstgehostetes CSS umsteigen. Kurzfristig mindestens:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://pvgis.mb10.org https://nominatim.openstreetmap.org https://*.europa.eu; img-src 'self' data:;">
<meta name="referrer" content="strict-origin-when-cross-origin">
```

### 2.4 Supply Chain: CDN ohne SRI, ohne Versions-Pin — HOCH
- `index.html:22` Tailwind Play-CDN: kein `integrity`, kein Versions-Pin, vom Hersteller **explizit nicht für Produktion** empfohlen (JIT im Browser, Performance, CSP-Konflikt).
- `index.html:46` + `sw.js:12`: `https://cdn.jsdelivr.net/npm/chart.js` **ohne Version** → jeder Major-Release kann die App brechen oder (bei Kompromittierung) Schadcode liefern.
- Google Fonts ohne Fallback (DSGVO: IP-Übermittlung an Google, kein lokaler Fallback bei Offline).

**Fix:** Chart.js pinnen + SRI-Hash, z. B.:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"
  integrity="sha384-…" crossorigin="anonymous"></script>
```
Fonts selbst hosten oder `font-display: swap` + System-Fallback (bereits `system-ui` als Fallback vorhanden ✓).

### 2.5 Privater PVGIS-Proxy als Single Point of Trust — MITTEL
- `https://pvgis.mb10.org` hardcoded (`app.js:735`), **kein Timeout/AbortController** → hängender Request blockiert `Promise.all` unbegrenzt.
- Antwort wird nur auf `length === 8760` geprüft, **nicht auf numerische `P`-Werte** → korruptes/ manipuliertes JSON (`P: null/"x"`) propagiert `NaN` durch die gesamte 8760h-Simulation ohne sichtbaren Fehler.
- Nur Jahr 2019 hardcoded (`startyear=endyear=2019`) → kein Mittelwert, methodisch angreifbar für Ertragsprognosen.

**Fix:** `AbortController` (Timeout 15 s), `Promise.allSettled`, Payload-Validierung (`Number.isFinite(P)`, sonst `0` + Zähler für Datenlücken im UI anzeigen).

### 2.6 Nominatim ohne Debounce/Fehlerbehandlung — NIEDRIG–MITTEL
`app.js:705`: kein Debounce, kein Fehler-Feedback (leeres `catch`), keine `Accept-Language`, Verstoßrisiko gegen OSM-Usage-Policy (kein Referer/Identifikation).

---

## 3. Robustheit & Absturzrisiken (Priorität 1)

| # | Problem | Stelle | Folge |
|---|---|---|---|
| R1 | `JSON.parse` ohne `try/catch` trotz vorhandenem `readJsonStorage()` | `app.js:610` (Invest), `1072` (Custom-DB), `1093` (BatMap) | Korrupter Eintrag → **kompletter App-Absturz** beim Laden |
| R2 | Implizites Global `DB = {...}` (kein `let/const`) | `app.js:45` | Fällt unter `'use strict'`/ES-Modulen sofort um; `window`-Pollution |
| R3 | Keine Werte-Clampings: `count`, `tilt`, `shading`, Preise, JAZ | `updateStringData`, `updateFieldData`, `parseCost`, Finanz-Inputs | Negative/riesige Werte → sinnlose Ergebnisse oder DoS (`count=1e9`) |
| R4 | `changeDetailMonth` bei `currentDetailMonth=null` → `null+1=1` | `app.js:990` | Detail-Charts starten nie automatisch (s. R5) |
| R5 | Detail-Charts werden nach Berechnung **nie initialisiert** (`currentDetailMonth` bleibt `null`) | `app.js:8,225,984` | Tagesauflösung leer, bis Nutzer Monats-Pfeile klickt |
| R6 | `sw.js:15` `cache.addAll()` | Service Worker | **1** fehlendes CDN-Asset → ganzer Install schlägt fehl → kein Offline-Modus |
| R7 | SW-Fetch: bei Offline + Cache-Miss → `respondWith(undefined)` | `sw.js:55–72` | Browser-Fehler statt Fallback-Seite |
| R8 | `searchLocation` rundet auf **2 Dezimalstellen** (~1 km) | `app.js:709` | Unnötig grob für PVGIS; 4–5 Stellen nehmen |
| R9 | EV-Wiederherstellung nimmt fest 18 kWh/100 km an | `app.js:535` | Gespeicherter Verbrauch wird beim Laden **verfälscht**, wenn Nutzer anderen Wert hatte (Original `km`/`kwh100` gehen in `saveConsumptionSettings` verloren) |
| R10 | `localStorage.clear()` löscht auch Theme | `app.js:103` | Reset setzt ungewollt Design zurück; gezielte Keys löschen |

---

## 4. Logikfehler in Physik & Finanzen (Priorität 1)

### 4.1 Voc-Kalttemperatur-Delta falsch (echter Rechenfehler)
`app.js:301`: `vocCold = vocStc * (1 + (-45) * tk/100)` — −10 °C gegenüber STC (25 °C) sind **−35 K, nicht −45 K**.
Bei `tk = −0,25 %/K` wird Voc um ~2,5 % **überschätzt** (konservative Seite → seltener gefährlich, aber falsch und kann fälschlich „Zerstörungsgefahr“ anzeigen).

### 4.2 Lastprofile sind nicht normiert (echter Rechenfehler)
`app.js:546`: `out.base[h] = (baseKwh*1000/8760) * saison * tageszeit` — die Gewichtungen mitteln sich **nicht** zu 1 (Tagesfaktor-Schnitt ≈ 1,058) → Jahressumme ≠ eingegebener Bedarf (ca. **+6 %** Phantomverbrauch). Gleiches Problem beim WP-Profil (`1+0.5·cos`, `app.js:549`).
**Fix:** Profil erst gewichten, dann auf Ziel-kWh **normieren** (Summe messen, skalieren).

### 4.3 Weitere physikalische/kaufmännische Ungenauigkeiten
- `tk` wird nur vom **ersten** Feld übernommen (`app.js:290`) → gemischte Modultypen falsch.
- Nur `maxIsc` geprüft, **Betriebsstrom `maxI` nie** (`app.js:303–305`); Parallelschaltung/Strangströme nicht modelliert.
- Batterie: **Laden ohne Wirkungsgrad**, nur Entladen mit `eff` (`app.js:836–866`); kein DoD/min-SoC, keine Selbstentladung, keine Alterung → Erträge systematisch optimistisch.
- Batterie-Power in `database.js` (z. B. Reserva 6,3 kWh → 6300 W ≈ 1C) unrealistisch hoch.
- EEG-Vorschau nutzt vor Berechnung pauschal **1 kWp** (`app.js:631`) statt echte kWp aus Strings → irreführende ct-Anzeige.
- EEG-Datum ohne Validierung (`app.js:635`): leeres/ungültiges Datum fällt stillschweigend auf „keine Degression“ zurück.
- Amortisation ist **statisch** (keine Degradation, Wartung, Diskontierung, Strompreissteigerung) — als solche labeln.
- `updateEEGPreview`-Werte (8,2/7,1 ct, 10 kWp, 1 %/6 Mo., 2027-Cutoff) sind **Magic Numbers**, parallel im Handbuchtext (`content.js`) wiederholt → Gesetzesänderung = 2+ Stellen + Doku-Drift.
- Deckungsanalyse-Netzbezug (`app.js:975`) über Umwegformel statt direkt gespeicherter `moFromGrid` — fragil.
- `mismatchPct` bleibt nach String-Änderung **stale** bis zur Neuberechnung (`app.js:298`) → irreführendes Badge.

---

## 5. Zentralisierung: Logik & Design (Priorität 2)

### 5.1 Leitfaden-Anspruch vs. Realität
Der Leitfaden (`DEVELOPMENT_GUIDELINES.md`) fordert Single Source of Truth. Befund:

| Anspruch | Realität |
|---|---|
| Berechnungen zentral in `app.js` | ✓ grob erfüllt — aber **Magic Numbers verstreut** (0.95 Systemverlust, 10 kWh/L Öl, Smart-Windows 8–18/9–16/18–21 h, VDI-Parameter, EEG-Sätze), kein `CONFIG`-Objekt |
| Texte/Changelog in `content.js` | ✓ — aber Handbuch **dupliziert Logikwerte** (EEG-Sätze, Mismatch-Erklärung) → Drift-Risiko |
| Stammdaten in `database.js` | ✓ — aber **flache Kopie teilt Objektreferenzen**: `inv.batteryId=…` mutiert `MasterDB` zur Laufzeit (`app.js:64`); **eigene Batterien fehlen im WR-Dropdown**, weil `renderDatabaseUI` (`app.js:1101`) `MasterDB.batteries` statt `DB.batteries` nutzt (Bug) |
| Design zentral | ✗ nur teilweise (s. 5.2) |
| Version synchron | ✗ manuell an **7 Stellen** (Titel, H1, 3× `?v=`, SW-Cache, Changelog, Guidelines) — Checkliste existiert, aber kein `APP_VERSION`-Single-Source |

### 5.2 Design-Zentralisierung im Detail
- ✓ **Gut:** `--color-primary/accent` als CSS-Variablen + Theme-Panel + Validierung (`isHexColor`).
- ✗ **Status-Badges** (emerald/rose/amber) als 3× kopierte Tailwind-Ketten (`app.js:343–364`) — kein `badge(status,…)`-Helper.
- ✗ **Chart-Farben** an 4 Stellen hardcoded (`#3b82f6`, `#f59e0b`, …), losgelöst vom `colors`-Array (nur String-Farben) und vom Theme.
- ✗ **Monatsnamen/Labels** 2× dupliziert (`app.js:946,975,994`); Chart-Optionen `cOpts` 3× kopiert.
- ✗ **`switchTab` (60 Zeilen)** jongliert Desktop-/Mobile-/More-Klassen als String-Literale; jede Designänderung = 3 Stellen. → Datengetriebene `setNavState()`-Funktion.
- ✗ **Dark-Mode-Lücke:** Gruppen-Cards in `renderDashboard` (`app.js:936`) nur `bg-white/bg-blue-50` — brechen Dark Mode.
- ✗ M3-Panel in String-Cards (`app.js:390`) hardcoded dunkel — auch im Light Mode dunkel (inkonsistent zu „Tonal Surfaces“).
- ✗ Guideline-Verstoß „keine Emojis“: `alert("⚠️ …")` (`app.js:769`); Spinner als Inline-SVG statt Material-Symbol.
- ✗ Typo: „**Investitionskosten**“ (`index.html:327`).
- ✗ Versionsanzeige `Pro 6.17` im H1 hardcoded.

### 5.3 Code-Hygiene
- Toter Code: `generateHourlyFromPVGISMonthly` (`app.js:1321`, 40 Zeilen, nie aufgerufen).
- Doppelte Abschnittsnummern/Kommentare („5. VERBRAUCH“, „6. FINANZEN“, „5. INVESTITION“).
- `window.onload = initDatabase` (`app.js:1319`) überschreibt Handler — `addEventListener('DOMContentLoaded', …)` nehmen.
- `alert/confirm` blockieren (schlechte Mobile-UX) → M3-Snackbar/Dialog.
- Implizite Render-Kaskaden (`updatePhysicsOnly → renderStringsUI + renderDatabaseUI`, `renderDashboard → calculateFinances → updateEEGPreview`) ohne zentrales State-Update — schwer nachvollziehbar, kein Dirty-Flag/Scheduling.
- Inkonsistente Persistenz: `saveConfiguration` speichert nur Strings/Ort/Verbrauch; Finanzen/Invest/BatMap speichern sich nebenbei an anderen Stellen.

---

## 6. Maßnahmenplan (priorisiert)

### P0 — Sicherheit (sofort)
1. `escapeHtml()` einführen; alle `${…}` mit Nutzerdaten in Templates escapen (Namen, Gruppen, Geräte, Farben validieren).
2. Inline-`onclick/onchange` → Event-Delegation mit `data-action/data-id` + `Number`-Validierung.
3. IDs aus LocalStorage beim Laden validieren (`Number.isFinite`, Schema-Check, Fallback auf Neuaufbau).
4. Alle `JSON.parse(localStorage…)` auf `readJsonStorage()` umstellen (R1).
5. Chart.js pinnen + SRI; CSP-Meta + Referrer-Policy setzen; Tailwind-Build statt Play-CDN planen.

### P1 — Korrektheit & Robustheit (nächster Release)
6. Voc-Delta −35 K; `maxI`-Prüfung ergänzen; `tk` pro Feld mischen (stromgewichtet oder Worst-Case).
7. Lastprofile normieren (exakte Jahressumme = Eingabe); EV `km` + `kWh/100` getrennt persistieren.
8. Batterie: Lade-Wirkungsgrad + DoD/min-SoC einführen; Power-Werte in `database.js` realistisch prüfen.
9. PVGIS: Timeout (AbortController), `allSettled`, `P`-Validierung + Datenlücken-Anzeige; Nominatim-Debounce + Fehlermeldung.
10. `currentDetailMonth` nach Berechnung initialisieren (z. B. aktueller Monat); `MasterDB`-Mutation via `structuredClone` verhindern; WR-Dropdown auf `DB.batteries` umstellen.
11. SW: `addAll` → Einzel-`add` mit `catch`; Navigations-Fallback (Offline-Seite); `skipWaiting`-Hinweis-UX.

### P2 — Zentralisierung (Refactoring)
12. `CONFIG`-Objekt (EEG, Physik-Temps, Verluste, Smart-Windows, VDI) in `database.js`/`config.js`; Handbuchtexte mit Platzhaltern daraus rendern (Doku-Drift beenden).
13. UI-Helper: `badge()`, `fmtKWh/€/%`, `chartFactory`, `MONTHS`-Konstante, `setNavState()`; `APP_VERSION` als Single Source.
14. `'use strict'` + `type="module"`; toten Code + doppelte Kommentare entfernen; `DOMContentLoaded`-Listener.
15. Persistenz vereinheitlichen (ein `saveAll()`/Autosave mit Dirty-Indikator statt 4 Nebenwege).

### P3 — UX/Design-Finish
16. M3-Snackbar/Dialog statt `alert/confirm`; Offline-Indikator-Badge; Ladezustand pro String.
17. Dark-Mode-Cards fixen, Typo fixen, Emoji entfernen, `aria-label`s, `:focus-visible`, `prefers-reduced-motion`.

---

## 7. Positiv hervorzuheben
- Saubere Modulaufteilung (HTML/Engine/Daten/Content/SW) mit dokumentierter Governance.
- Teilweise bereits gehärtetes LocalStorage-Handling (`readJsonStorage`, `isHexColor`) — muss nur **konsequent** angewendet werden.
- Durchdachte Physik-Engine (Mismatch-Flaschenhals, Temperatur-Spannungen, 8760h-Matrix, Sektorenkopplung).
- Offline-Fallback-Engine verhindert Totalausfall; SW-Strategie (Network-first für APIs, SWR für Assets) grundsätzlich richtig.
- Theme-System mit CSS-Variablen ist der richtige Zentralisierungsansatz — ausbauen statt neu erfinden.
