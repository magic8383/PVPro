# Entwicklungs-, Architektur- & Release-Leitfaden (PV-Planung Pro)

**Version:** 7.0 (Security & Architecture Rebuild)
**Repository:** `https://github.com/magic8383/PVPro.git`
**Standard-Branch:** `main` (Production) | `New` (Feature / Refactor Staging)

---

## 1. Arbeits-, Kommunikations- & Code-Prinzipien

* **Kompakt & Zielführend:** Alle Erklärungen, Commits und Dokumentationen sind präzise, technisch exakt und frei von überflüssigem Fluff.
* **Keine voreiligen Code-Änderungen:** Vor jedem Eingriff erfolgt eine fundierte technische Analyse im bestehenden Codebestand.
* **Review vor Umsetzung:** Geplante Änderungen, Schnittstellen-Anpassungen und Patchnotes werden vorab nachvollziehbar strukturiert.
* **Explizites Freigabe-Prinzip:** Änderungen an Berechnungs-Engines, mathematischen Modellen und API-Endpunkten erfolgen stets konsistent und synchron über alle beteiligten Module.
* **Keine Insellösungen (Single Source of Truth):**
  * **Version:** `APP_VERSION` in `version.js` (Titel/Header zur Laufzeit, SW-Cache-Name via `importScripts`).
  * **Konstanten:** Alle physikalischen, kaufmännischen und Profil-Konstanten in `CONFIG` (`database.js`). Keine Magic Numbers in `app.js`.
  * **Design & Icons:** Alle Symbole ausschließlich über Google Material Symbols (`.material-symbols-rounded`). Keine Emojis in UI/Alerts. Status-Badges nur über `badge()`, Charts nur über `stackedBarConfig()`/`makeChart()`, Monatsnamen nur über `MONTHS_SHORT`/`MONTHS_FULL`.
  * **Zentral gesteuerte Logik:** Berechnungen (Physik, Finanzen, Verbrauch, Mismatch) residieren in `app.js`. Texte, Changelog und Glossar liegen in `content.js` und rendern Zahlenwerte aus `CONFIG`. Gerätestammdaten liegen in `database.js`.
* **Sicherheits-Regeln (verbindlich):**
  * Kein `innerHTML` mit ungefilterten Nutzerdaten — immer `esc()` verwenden.
  * Keine Inline-Event-Handler (`onclick=` etc.) — immer `addEventListener` / Event-Delegation via `data-*`-Attribute (Voraussetzung für die CSP).
  * Alle LocalStorage-Zugriffe nur über `readJsonStorage`/`writeJsonStorage` + Schema-Sanitizer (`sanitizeStrings`, `sanitizeUserDB`, `sanitizeLocation`).
  * Neue CDN-Abhängigkeiten nur versionsgepinnt und mit SRI-Hash.

---

## 2. Modul-Architektur

Performante, modular aufgebaute PWA ohne Framework-Overhead:

* `index.html`: Semantisches DOM, M3 Top App Bar, Navigation, Snackbar/Dialog/Progress-Shell. Enthält **kein** Inline-JS und **keine** Inline-Handler (CSP-konform).
* `version.js`: Single Source of Truth für `APP_VERSION`.
* `tailwind.config.js`: Externe Tailwind-Play-CDN-Konfiguration (CSP-konform statt Inline-Script).
* `app.js`: State, Validierung, Physik-Engine, PVGIS mit Timeout, Chart-Rendering, PWA-Lifecycle. Strikter Modus, Event-Delegation.
* `database.js`: Stammdaten MasterDB (Module, WR, Speicher) + zentrale `CONFIG`.
* `content.js`: Wissensbasis als `buildHandbuchHTML()`-Template mit `CONFIG`-Werten und Changelog.
* `sw.js`: Service Worker (resilienter Install via `allSettled`, Network-first für APIs, Navigations-Fallback auf App-Shell).
* `manifest.json`: Web App Manifest für Installation und Standalone-Modus.
* `DEVELOPMENT_GUIDELINES.md`: Projektgovernance, Git-Workflow, Architektur und UI-Standards.

---

## 3. Detail-Architektur & Datenfluss

### PVGIS Seriescalc & Offline-Fallback
* Ertragssimulation mit realen 8.760h-Historienstundenwerten (`seriescalc`) über `https://pvgis.mb10.org/api/v5_2/seriescalc` (URL/Timeout/Jahr in `CONFIG.pvgis`).
* Jeder Abruf mit `AbortController`-Timeout; Antwort wird auf 8.760 numerisch valide Stundenwerte geprüft. Bei Ausfall greift deterministisch `generateSyntheticPVGISData` pro Feld; betroffene Felder werden per Snackbar ausgewiesen.

### Physik- & Modul-Engine
* Temperaturabhängige Spannungen pro Modultyp: $U_{oc}$ bei -10 °C ($\Delta T = -35\,K$), $U_{mpp}$ bei +70 °C ($\Delta T = +45\,K$) über den jeweiligen $T_k$.
* Grenzprüfung gegen den Wechselrichter: $U_{max}$, $I_{sc,max}$, Betriebsstrom $I_{mpp} = P_{max}/V_{mp}$ gegen $I_{max}$, MPPT-Bereich, Startspannung.
* Stundengenaue Mismatch-Berechnung nach Flaschenhalsprinzip für gemischte Felder innerhalb eines Strings.
* MPPT-Assistent (`suggestStringConfig`): legt die Modulanzahl mittig ins MPP-Fenster (geprüft gegen $U_{max}$ und Startspannung).

### Finanz- & Lastprofil-Bilanzierung
* Haushaltslastprofile nach VDI 4655, exakt auf die eingegebenen Jahres-kWh **normiert** (`normalizeToKwh`).
* Sektorenkopplung für Wärmepumpe und E-Mobilität (Wetter-KI-Fenster in `CONFIG.consumption`).
* Batterie: nutzbare Kapazität 90 % DoD (`CONFIG.battery`), Roundtrip-Wirkungsgrad je zur Hälfte beim Laden/Entladen.
* Dynamische EEG-Mischvergütung aus `CONFIG.eeg` mit Degression und Cutoff; Amortisation als **statische** Rechnung gekennzeichnet.

---

## 4. Design System: Material Design 3 Expressive

* **Vektor-Iconografie:** Google Material Symbols Rounded. Keine Emojis.
* **Tonal Surfaces:** Light/Dark-konsistente Oberflächen; Status nur über zentralen `badge()`-Helper.
* **Feedback:** M3 Snackbar (`toast()`) statt `alert()`, M3 Dialog (`confirmDialog()`) statt `confirm()`, Fortschrittsbalken bei Berechnung, Offline-Badge, Dirty-Indikator am Speichern-Button, Live-Anlagenstats im Header.
* **Adaptive Navigation:** Mobil M3 Bottom Bar + More-Sheet, Desktop Segmented Bar; ein `data-tab`-Delegations-Listener steuert alle Navigationsflächen.
* **Barrierefreiheit:** `aria-label` auf Icon-Buttons, `:focus-visible`, `prefers-reduced-motion`, Dark Mode folgt beim Erststart dem System.

---

## 5. Git-Verbindung & Release-Workflow

* **Remote Origin:** `https://github.com/magic8383/PVPro.git`
* **Branches:**
  * `main`: Stabiler Produktionszweig.
  * `origin/New`: Feature- und Staging-Branch.
* **Release-Checkliste (v7, vereinfacht):**
  1. `APP_VERSION` in `version.js` bumpen (Titel, Header-Tag und SW-Cache-Name folgen automatisch).
  2. `?v=` Query-Strings in `index.html` synchronisieren.
  3. Changelog-Eintrag in `content.js` ergänzen, Versionszeile hier aktualisieren.
  4. Bei CDN-Updates: Version pinnen + SRI-Hash nachtragen.
  5. Git Commit mit strukturierter Nachricht und Push.
