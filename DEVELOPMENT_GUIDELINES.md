# Entwicklungs- & Release-Leitfaden (PV-Planung Pro)

## 1. Arbeits- & Kommunikationsprinzipien
* **Kompakt & Zielführend:** Antworten kurz, präzise und ohne Tutorials oder Fluff halten.
* **Keine voreiligen Code-Änderungen:** Vor jeder Modifikation erfolgt eine fundierte technische Ursachenanalyse.
* **Review vor Umsetzung:** Geplante Patchnotes werden vorab zur Abstimmung vorgelegt.
* **Explizites Freigabe-Prinzip:** Generierung und Einbau von Code erfolgen ausschließlich nach ausdrücklichem „Go“.

## 2. Modul-Architektur
* `index.html`: DOM-Gerüst und Layout.
* `app.js`: Berechnungs-Engine, API-Handling, State Management, Chart-Rendering, PWA-Lifecycle.
* `database.js`: Datenstamm (Module, Wechselrichter, Speicher).
* `content.js`: Glossar, Texte, Changelog.
* `sw.js`: Service Worker für Caching und Offline-Betrieb.
* `manifest.json`: Web App Manifest für Installation und PWA-Metadaten.
* `DEVELOPMENT_GUIDELINES.md`: Projektrichtlinien und Governance.
