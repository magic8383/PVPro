'use strict';
// ==========================================
// PVPro 7.0 – App-Engine
// State, Physik, PVGIS, Charts, PWA.
// Architektur-Regeln (s. DEVELOPMENT_GUIDELINES.md):
// - Kein innerHTML mit ungefilterten Nutzerdaten (esc()!)
// - Keine Inline-Handler (Event-Delegation via data-Attribute)
// - Konstanten nur aus CONFIG (database.js)
// ==========================================

// ---------- 0. BASIS-HELFER ----------
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function clamp(num, min, max) {
    const n = Number(num);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

function clampInt(num, min, max) {
    return Math.round(clamp(num, min, max));
}

function fmtIntDE(num) {
    return Math.round(Number(num) || 0).toLocaleString('de-DE');
}

function fmtMoney(num) {
    return (Number(num) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function debounce(fn, wait) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTHS_FULL = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START_HOUR = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016];

// ---------- 1. SNACKBAR & DIALOG (statt alert/confirm) ----------
let snackTimer = null;
function toast(msg, tone = 'info') {
    const snack = $('snack'), label = $('snackMsg'), icon = $('snackIcon');
    if (!snack || !label) { console.log('[PVPro]', msg); return; }
    label.textContent = msg;
    const tones = {
        info: ['bg-slate-900 text-white border-slate-700', 'info', 'text-sky-400'],
        success: ['bg-emerald-950 text-emerald-100 border-emerald-800', 'check_circle', 'text-emerald-400'],
        warn: ['bg-amber-950 text-amber-100 border-amber-800', 'warning', 'text-amber-400'],
        error: ['bg-rose-950 text-rose-100 border-rose-800', 'error', 'text-rose-400']
    };
    const [box, ic, icColor] = tones[tone] || tones.info;
    snack.className = `fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-8 z-[70] max-w-[92vw] md:max-w-xl flex items-center gap-2.5 pl-4 pr-5 py-3 rounded-2xl border shadow-2xl text-sm font-semibold transition-all ${box}`;
    if (icon) { icon.textContent = ic; icon.className = `material-symbols-rounded text-xl shrink-0 ${icColor}`; }
    snack.classList.remove('hidden');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => snack.classList.add('hidden'), 3800);
}

let dlgResolve = null;
function confirmDialog({ title = 'Bitte bestätigen', msg = '', ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) {
    return new Promise((resolve) => {
        const back = $('dlgBackdrop'), box = $('dlg');
        if (!back || !box) { resolve(window.confirm(msg || title)); return; }
        dlgResolve = resolve;
        $('dlgTitle').textContent = title;
        $('dlgMsg').textContent = msg;
        const okBtn = $('dlgOk'), cancelBtn = $('dlgCancel');
        okBtn.innerHTML = '';
        const okIcon = document.createElement('span');
        okIcon.className = 'material-symbols-rounded text-base';
        okIcon.textContent = danger ? 'delete_forever' : 'check';
        okBtn.append(okIcon, document.createTextNode(' ' + ok));
        okBtn.className = `flex-1 font-bold px-4 py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5 text-sm ${danger ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-primary hover:bg-primary-hover text-white'}`;
        cancelBtn.textContent = cancel;
        back.classList.remove('hidden');
        box.classList.remove('hidden');
        requestAnimationFrame(() => box.classList.remove('scale-95', 'opacity-0'));
    });
}
function closeDialog(result) {
    const back = $('dlgBackdrop'), box = $('dlg');
    if (back) back.classList.add('hidden');
    if (box) { box.classList.add('hidden', 'scale-95', 'opacity-0'); }
    if (dlgResolve) { dlgResolve(result); dlgResolve = null; }
}

// ---------- 2. STORAGE ----------
function readJsonStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const value = JSON.parse(raw);
        return value ?? fallback;
    } catch (error) {
        console.warn(`Ungültige LocalStorage-Daten für ${key}; Standardwert wird verwendet.`, error);
        return fallback;
    }
}

function writeJsonStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn(`LocalStorage-Schreiben für ${key} fehlgeschlagen.`, error);
        toast('Speichern fehlgeschlagen (Speicher voll oder blockiert).', 'error');
        return false;
    }
}

function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

// ---------- 3. GLOBALER STATE ----------
let DB = { panels: [], batteries: [], inverters: [] };
let flatPanels = [], flatInverters = [], flatBatteries = [];
const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#84cc16'];
let LocationData = { lat: 48.06, lon: 8.46, name: 'Villingen-Schwenningen' };
let YieldDataCache = null, ConsumptionCache = null, FlowCache = null, activeGroupIndex = null;
let strings = [], currentDetailMonth = null, isCalculating = false;
const ChartRegistry = {};

const DEFAULT_THEME = { primary: '#3b82f6', accent: '#10b981', dark: false };

function getThemeSettings() {
    const stored = readJsonStorage('pvpro_theme', {});
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return {
        primary: isHexColor(stored.primary) ? stored.primary : DEFAULT_THEME.primary,
        accent: isHexColor(stored.accent) ? stored.accent : DEFAULT_THEME.accent,
        dark: typeof stored.dark === 'boolean' ? stored.dark : systemDark
    };
}

// ---------- 4. VALIDIERUNG (Schema-Checks für gespeicherte Daten) ----------
function sanitizeStrings(raw) {
    if (!Array.isArray(raw)) return [];
    const L = CONFIG.limits;
    const fallbackPanel = flatPanels[0]?.id;
    const fallbackInv = flatInverters[0];
    return raw.filter((s) => s && typeof s === 'object').map((s, idx) => {
        const inv = flatInverters.find((i) => i.id === Number(s.inverterId)) || fallbackInv;
        const mppts = inv?.mppts || [{ id: 1 }];
        const mpptOk = mppts.some((m) => m.id === Number(s.mpptId)) ? Number(s.mpptId) : mppts[0].id;
        let fields = Array.isArray(s.fields) && s.fields.length > 0 ? s.fields : [{
            id: Date.now() + idx, panelId: fallbackPanel, count: clampInt(s.panels, L.countMin, L.countMax) || 1, tilt: 30
        }];
        fields = fields.filter((f) => f && typeof f === 'object').map((f, fi) => ({
            id: Number.isFinite(Number(f.id)) ? Number(f.id) : Date.now() + idx * 100 + fi,
            panelId: flatPanels.some((p) => p.id === Number(f.panelId)) ? Number(f.panelId) : fallbackPanel,
            count: clampInt(f.count, L.countMin, L.countMax) || 1,
            tilt: clamp(Number(f.tilt), L.tiltMin, L.tiltMax)
        }));
        if (fields.length === 0) fields = [{ id: Date.now() + idx, panelId: fallbackPanel, count: 1, tilt: 30 }];
        return {
            id: Number.isFinite(Number(s.id)) ? Number(s.id) : Date.now() + idx,
            name: String(s.name ?? 'String').slice(0, L.nameLen) || 'String',
            group: String(s.group ?? '').slice(0, L.nameLen),
            shading: clamp(Number(s.shading), L.shadingMin, L.shadingMax),
            azimuth: clamp(Number(s.azimuth), L.azimuthMin, L.azimuthMax),
            inverterId: inv ? inv.id : 0,
            mpptId: mpptOk,
            color: isHexColor(s.color) ? s.color : PALETTE[idx % PALETTE.length],
            fields
        };
    });
}

function sanitizeUserDB(raw) {
    const out = { panels: [], batteries: [], inverters: [] };
    if (!raw || typeof raw !== 'object') return out;
    const num = (v, fb, min, max) => {
        const n = Number(v);
        return Number.isFinite(n) ? clamp(n, min, max) : fb;
    };
    if (Array.isArray(raw.panels)) {
        out.panels = raw.panels.filter((p) => p && p.name).map((p) => ({
            id: Number(p.id) || (Date.now() % 100000),
            name: String(p.name).slice(0, 80),
            pmax: num(p.pmax, 400, 1, 2000), voc: num(p.voc, 40, 1, 200),
            vmp: num(p.vmp, 30, 1, 200), isc: num(p.isc, 10, 0.1, 50),
            tempVoc: Number.isFinite(Number(p.tempVoc)) ? clamp(Number(p.tempVoc), -1, 0) : -0.25
        }));
    }
    if (Array.isArray(raw.inverters)) {
        out.inverters = raw.inverters.filter((w) => w && w.name).map((w) => {
            const mppts = Array.isArray(w.mppts) && w.mppts.length > 0
                ? w.mppts.slice(0, 8).map((m, i) => ({
                    id: Number(m.id) || (i + 1), name: String(m.name || `MPPT ${i + 1}`).slice(0, 30),
                    maxIsc: num(m.maxIsc, 20, 1, 100), maxI: num(m.maxI, 15, 1, 100)
                }))
                : [{ id: 1, name: 'MPPT 1', maxIsc: 20, maxI: 15 }];
            return {
                id: Number(w.id) || (Date.now() % 100000),
                name: String(w.name).slice(0, 80),
                acMax: num(w.acMax, 5000, 100, 100000), startV: num(w.startV, 80, 1, 1500),
                maxV: num(w.maxV, 1000, 10, 1500), minMppV: num(w.minMppV, 130, 1, 1500),
                maxMppV: num(w.maxMppV, 800, 1, 1500), batteryId: Number(w.batteryId) || 1, mppts
            };
        });
    }
    if (Array.isArray(raw.batteries)) {
        out.batteries = raw.batteries.filter((b) => b && b.name).map((b) => ({
            id: Number(b.id) || (Date.now() % 100000),
            name: String(b.name).slice(0, 80),
            cap: num(b.cap, 5, 0.1, 500), power: num(b.power, 5000, 100, 100000),
            eff: Number.isFinite(Number(b.eff)) ? clamp(Number(b.eff), 0.5, 1) : 0.95
        }));
    }
    return out;
}

function sanitizeLocation(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = Number(raw.lat), lon = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : LocationData.name;
    return { lat, lon, name };
}

// ---------- 5. INITIALISIERUNG ----------
function initApp() {
    try {
        loadThemeSettings();
        stampVersion();

        // Deep-Copy: MasterDB darf zur Laufzeit nie mutiert werden
        DB = {
            panels: structuredClone(MasterDB.panels),
            batteries: structuredClone(MasterDB.batteries),
            inverters: structuredClone(MasterDB.inverters)
        };

        const userDB = sanitizeUserDB(readJsonStorage('pvpro_user_db', { panels: [], batteries: [], inverters: [] }));
        if (userDB.panels.length > 0) DB.panels.push({ series: 'Eigene Module', models: userDB.panels });
        if (userDB.inverters.length > 0) DB.inverters.push({ series: 'Eigene WR', models: userDB.inverters });
        if (userDB.batteries.length > 0) DB.batteries.push({ series: 'Eigene Batterien', models: userDB.batteries });

        flatPanels = DB.panels.flatMap((s) => s.models || []);
        flatInverters = DB.inverters.flatMap((s) => s.models || []);
        flatBatteries = DB.batteries.flatMap((s) => s.models || []);

        const batMap = readJsonStorage('pvpro_batmap', {});
        flatInverters.forEach((inv) => {
            const mapped = Number(batMap[inv.id]);
            if (Number.isFinite(mapped) && flatBatteries.some((b) => b.id === mapped)) inv.batteryId = mapped;
        });

        strings = sanitizeStrings(readJsonStorage('pvpro_strings', []));

        const loc = sanitizeLocation(readJsonStorage('pvpro_loc', null));
        if (loc) LocationData = loc;
        const locInp = $('locSearchInput'); if (locInp) locInp.value = LocationData.name;
        const locTxt = $('locNameText'); if (locTxt) locTxt.textContent = LocationData.name;

        const faqTab = $('tab-faq');
        if (faqTab && typeof HandbuchHTML !== 'undefined') faqTab.innerHTML = HandbuchHTML;

        bindStaticEvents();
        loadConsumptionSettings();
        loadFinanceSettings();
        loadInvestSettings();
        updatePhysicsOnly();
        clearDirty();
        updateOnlineBadge();
        window.addEventListener('online', updateOnlineBadge);
        window.addEventListener('offline', updateOnlineBadge);
    } catch (e) { console.error('Init Error:', e); }
}

function stampVersion() {
    const v = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '';
    document.title = `PV-Planung Pro ${v} (Material Expressive 3)`;
    const tag = $('versionTag');
    if (tag) tag.textContent = `Pro ${v}`;
}

// ---------- 6. DIRTY-TRACKING & ZENTRALES SPEICHERN ----------
let isDirty = false;
function markDirty() {
    isDirty = true;
    const btn = $('btnHeaderSave');
    if (btn) btn.classList.add('animate-pulse', 'ring-2', 'ring-amber-300');
    const dot = $('saveDot');
    if (dot) dot.classList.remove('hidden');
}
function clearDirty() {
    isDirty = false;
    const btn = $('btnHeaderSave');
    if (btn) btn.classList.remove('animate-pulse', 'ring-2', 'ring-amber-300');
    const dot = $('saveDot');
    if (dot) dot.classList.add('hidden');
}

function saveConfiguration() {
    writeJsonStorage('pvpro_strings', strings);
    writeJsonStorage('pvpro_loc', LocationData);
    saveConsumptionSettings();
    saveFinanceSettings();
    persistInvest();
    persistBatMap();
    clearDirty();
    toast('Konfiguration gespeichert.', 'success');
}

async function clearLocalStorage() {
    const ok = await confirmDialog({
        title: 'Zurücksetzen?', msg: 'Alle Strings, Einstellungen und eigene Hardware werden gelöscht. Das Design bleibt erhalten.', ok: 'Alles löschen', danger: true
    });
    if (!ok) return;
    const theme = localStorage.getItem('pvpro_theme');
    localStorage.clear();
    if (theme) localStorage.setItem('pvpro_theme', theme);
    location.reload();
}

function persistBatMap() {
    const map = {};
    flatInverters.forEach((inv) => { map[inv.id] = inv.batteryId; });
    writeJsonStorage('pvpro_batmap', map);
}

// ---------- 7. NAVIGATION, SHEET, SWIPE, ACCORDION ----------
const tabOrder = ['system', 'verbrauch', 'invest', 'finance', 'uebersicht', 'auswertung', 'database', 'faq'];
const NAV_MAIN = ['system', 'verbrauch', 'finance', 'auswertung'];
const NAV_MORE = ['invest', 'uebersicht', 'database', 'faq'];

const SEG_ACTIVE = 'm3-segment-btn active snap-start shrink-0 px-3.5 py-1.5 text-xs md:text-sm font-bold rounded-xl bg-primary text-white shadow-sm flex items-center gap-1.5 transition-all';
const SEG_IDLE = 'm3-segment-btn snap-start shrink-0 px-3.5 py-1.5 text-xs md:text-sm font-medium rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/60 flex items-center gap-1.5 transition-all';
const PILL_ACTIVE = 'm3-bnav-pill px-4 py-1 rounded-full bg-primary/20 text-primary dark:bg-primary/30 dark:text-primary transition-all flex items-center justify-center';
const PILL_IDLE = 'm3-bnav-pill px-4 py-1 rounded-full bg-transparent text-slate-400 transition-all flex items-center justify-center';
const ICON_ACTIVE = 'material-symbols-rounded text-xl text-primary font-bold fill-1';
const ICON_IDLE = 'material-symbols-rounded text-xl text-slate-400';
const LABEL_ACTIVE = 'm3-bnav-label text-[10px] font-bold text-primary mt-0.5 tracking-tight';
const LABEL_IDLE = 'm3-bnav-label text-[10px] font-medium text-slate-400 mt-0.5 tracking-tight';

function paintSegmentBtn(btn, active, accent) {
    btn.className = active ? SEG_ACTIVE : SEG_IDLE;
    if (!active && accent) btn.classList.add('text-accent');
    const icon = btn.querySelector('.material-symbols-rounded');
    if (icon) icon.classList.toggle('fill-1', active);
}

function paintBottomBtn(btn, active) {
    if (!btn) return;
    const pill = btn.querySelector('.m3-bnav-pill');
    const icon = btn.querySelector('.material-symbols-rounded');
    const label = btn.querySelector('.m3-bnav-label');
    if (pill) pill.className = active ? PILL_ACTIVE : PILL_IDLE;
    if (icon) icon.className = active ? ICON_ACTIVE : ICON_IDLE;
    if (label) label.className = active ? LABEL_ACTIVE : LABEL_IDLE;
}

function switchTab(tabId) {
    if (!tabOrder.includes(tabId)) return;
    const current = document.querySelector('.tab-content.active');
    if (current) current.classList.remove('active');
    const target = $('tab-' + tabId);
    if (target) target.classList.add('active');

    tabOrder.forEach((id) => {
        const btn = $('btn-' + id);
        if (btn) paintSegmentBtn(btn, id === tabId, id === 'auswertung');
    });
    NAV_MAIN.forEach((id) => paintBottomBtn($('bnav-' + id), id === tabId));
    paintBottomBtn($('bnav-more'), NAV_MORE.includes(tabId));

    closeMoreSheet();

    const btn = $('btn-' + tabId);
    const scroller = $('navScroller');
    if (btn && scroller) {
        try { scroller.scrollTo({ left: btn.offsetLeft - window.innerWidth / 2 + 50, behavior: 'smooth' }); }
        catch (e) { scroller.scrollLeft = btn.offsetLeft - window.innerWidth / 2 + 50; }
    }
    if (tabId === 'auswertung' && currentDetailMonth !== null) updateDetailCharts(currentDetailMonth);
    const main = $('mainScroll');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
}

function openMoreSheet() {
    const sheet = $('m3MoreSheet'), backdrop = $('m3SheetBackdrop');
    if (sheet && backdrop) {
        backdrop.classList.remove('hidden');
        sheet.classList.remove('translate-y-full');
    }
}

function closeMoreSheet() {
    const sheet = $('m3MoreSheet'), backdrop = $('m3SheetBackdrop');
    if (sheet && backdrop && !sheet.classList.contains('translate-y-full')) {
        sheet.classList.add('translate-y-full');
        setTimeout(() => backdrop.classList.add('hidden'), 250);
    }
}

function toggleAcc(id) {
    const el = $(id);
    if (!el) return;
    if (el.classList.contains('open')) el.classList.remove('open');
    else { $$('.acc-content').forEach((e) => e.classList.remove('open')); el.classList.add('open'); }
}

let touchStartX = 0, touchStartY = 0;
function bindSwipe() {
    document.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
        const t = e.target.nodeType === 3 ? e.target.parentNode : e.target;
        if (t.closest('input, select, button, canvas, .overflow-x-auto, a, dialog')) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) {
            const current = document.querySelector('.tab-content.active');
            if (!current) return;
            const cIdx = tabOrder.indexOf(current.id.replace('tab-', ''));
            if (cIdx === -1) return;
            if (dx < 0 && cIdx < tabOrder.length - 1) switchTab(tabOrder[cIdx + 1]);
            else if (dx > 0 && cIdx > 0) switchTab(tabOrder[cIdx - 1]);
        }
    }, { passive: true });
}

// ---------- 8. STATISCHE EVENT-BINDINGS (keine Inline-Handler) ----------
function on(id, evt, fn) {
    const el = $(id);
    if (el) el.addEventListener(evt, fn);
}

function bindStaticEvents() {
    bindSwipe();

    // Navigation (Delegation über data-tab)
    document.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-tab]');
        if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
        const accBtn = e.target.closest('[data-acc]');
        if (accBtn) { toggleAcc(accBtn.dataset.acc); }
    });
    on('bnav-more', 'click', openMoreSheet);
    on('m3SheetBackdrop', 'click', closeMoreSheet);
    on('sheetClose', 'click', closeMoreSheet);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeMoreSheet(); closeDialog(false); }
    });

    // Header
    on('btnHeaderSave', 'click', saveConfiguration);
    on('btnReset', 'click', clearLocalStorage);
    on('btnThemePanel', 'click', toggleThemePanel);
    on('btnPwaInstall', 'click', installPwaApp);
    on('btnThemeDarkMode', 'click', toggleDarkMode);
    on('themePrimaryColor', 'input', (e) => previewThemeColors(e.target.value, null));
    on('themeAccentColor', 'input', (e) => previewThemeColors(null, e.target.value));
    on('themePrimaryColor', 'change', (e) => updateThemeColors(e.target.value, null));
    on('themeAccentColor', 'change', (e) => updateThemeColors(null, e.target.value));

    // Standort
    on('btnLocEdit', 'click', () => $('locEditBox')?.classList.toggle('hidden'));
    on('btnLocSearch', 'click', searchLocation);
    on('locSearchInput', 'keydown', (e) => { if (e.key === 'Enter') searchLocation(); });

    // Strings
    on('btnAddString', 'click', addString);
    bindStringsListEvents();
    bindDatabaseEvents();
    on('stringBreakdown', 'click', (e) => {
        const card = e.target.closest('[data-focus]');
        if (card) setFocus(Number(card.dataset.focus));
    });

    // Verbrauch
    on('cons_base_kwh', 'input', () => { updateConsumptionEstimate(); updateHouseHint(); markDirty(); });
    on('cons_house', 'change', () => { updateConsumptionEstimate(); markDirty(); });
    ['it', 'ac', 'wp', 'bw', 'ev'].forEach((id) => on(`cons_${id}_active`, 'change', () => toggleConsGroup(id)));
    ['cons_it_w', 'cons_ac_kwh', 'cons_wp_kwh', 'cons_bw_kwh', 'cons_ev_km', 'cons_ev_kwh100'].forEach((id) =>
        on(id, 'input', () => { updateConsumptionEstimate(); markDirty(); }));
    on('cons_bw_smart', 'change', () => { updateConsumptionEstimate(); markDirty(); });
    on('cons_ev_smart', 'change', () => { updateConsumptionEstimate(); markDirty(); });

    // Investition (Delegation)
    on('tab-invest', 'input', (e) => {
        if (e.target && e.target.id && e.target.id.startsWith('inv_cost_')) { calcInvestTotal(); markDirty(); }
    });
    on('tab-invest', 'change', (e) => {
        if (e.target && e.target.id && e.target.id.startsWith('inv_cost_')) { calcInvestTotal(); markDirty(); }
    });

    // Finanzen
    ['fin_grid_price', 'fin_sys_cost', 'fin_gas_price', 'fin_wp_jaz', 'fin_petrol_price', 'fin_ice_cons'].forEach((id) =>
        on(id, 'input', () => { updateEEGPreview(); markDirty(); }));
    on('fin_eeg_date', 'change', () => { updateEEGPreview(); markDirty(); });
    on('btnCalculateMain', 'click', calculateYieldAPI);

    // Detail-Monate
    on('detailPrev', 'click', () => changeDetailMonth(-1));
    on('detailNext', 'click', () => changeDetailMonth(1));

    // Datenbank / Custom-Hardware
    on('btnCustomDbToggle', 'click', toggleCustomDbForm);
    on('cdb_type', 'change', updateCustomDbFields);
    on('btnSaveCustom', 'click', saveCustomDevice);

    // Dialog
    on('dlgOk', 'click', () => closeDialog(true));
    on('dlgCancel', 'click', () => closeDialog(false));
    on('dlgBackdrop', 'click', () => closeDialog(false));
}

// ---------- 9. STRINGS: CRUD + MPPT-ASSISTENT ----------
function newStringId() { return Date.now() + Math.floor(Math.random() * 1000); }

function addString() {
    strings.push({
        id: newStringId(), name: `String ${strings.length + 1}`, group: '', shading: 0, azimuth: 180,
        inverterId: flatInverters[0]?.id || 0, mpptId: 1,
        color: PALETTE[strings.length % PALETTE.length],
        fields: [{ id: newStringId(), panelId: flatPanels[0]?.id || 0, count: 5, tilt: 30 }]
    });
    updatePhysicsOnly();
    markDirty();
}

async function removeString(id) {
    const str = strings.find((s) => s.id === id);
    const ok = await confirmDialog({
        title: 'String löschen?', msg: `"${str?.name || ''}" wird entfernt.`, ok: 'Löschen', danger: true
    });
    if (!ok) return;
    strings = strings.filter((s) => s.id !== id);
    updatePhysicsOnly();
    markDirty();
}

function addField(id) {
    strings.find((s) => s.id === id)?.fields.push({ id: newStringId(), panelId: flatPanels[0]?.id || 0, count: 1, tilt: 30 });
    updatePhysicsOnly();
    markDirty();
}

function removeField(sId, fId) {
    const str = strings.find((s) => s.id === sId);
    if (!str || str.fields.length <= 1) { toast('Ein String braucht mindestens ein Modulfeld.', 'warn'); return; }
    str.fields = str.fields.filter((f) => f.id !== fId);
    updatePhysicsOnly();
    markDirty();
}

function toggleEditMode(strId) {
    $('edit-' + strId)?.classList.toggle('hidden');
}

function reopenEditor(id) {
    const el = $('edit-' + id);
    if (el) el.classList.remove('hidden');
}

function updateStringData(id, key, val) {
    const str = strings.find((s) => s.id === id);
    if (!str) return;
    const L = CONFIG.limits;
    if (key === 'name' || key === 'group') str[key] = String(val ?? '').slice(0, L.nameLen);
    else if (key === 'color') { if (isHexColor(val)) str.color = val; }
    else if (key === 'shading') str.shading = clamp(Number(val), L.shadingMin, L.shadingMax);
    else if (key === 'azimuth') str.azimuth = clamp(Number(val), L.azimuthMin, L.azimuthMax);
    else if (key === 'inverterId') {
        const inv = flatInverters.find((i) => i.id === Number(val));
        if (inv) { str.inverterId = inv.id; str.mpptId = inv.mppts?.[0]?.id ?? 1; }
    }
    else if (key === 'mpptId') {
        const inv = flatInverters.find((i) => i.id === Number(str.inverterId));
        if (inv?.mppts?.some((m) => m.id === Number(val))) str.mpptId = Number(val);
    }
    updatePhysicsOnly();
    reopenEditor(id);
    markDirty();
}

function updateFieldData(sId, fId, key, val) {
    const str = strings.find((s) => s.id === sId);
    if (!str) return;
    const f = str.fields.find((x) => x.id === fId);
    if (!f) return;
    const L = CONFIG.limits;
    if (key === 'panelId') {
        if (flatPanels.some((p) => p.id === Number(val))) f.panelId = Number(val);
    }
    else if (key === 'count') f.count = clampInt(val, L.countMin, L.countMax) || 1;
    else if (key === 'tilt') f.tilt = clamp(Number(val), L.tiltMin, L.tiltMax);
    updatePhysicsOnly();
    reopenEditor(sId);
    markDirty();
}

// Smart: Modulanzahl mittig ins MPP-Fenster legen
function suggestStringConfig(sId) {
    const str = strings.find((s) => s.id === sId);
    if (!str || str.fields.length === 0) return;
    const inv = flatInverters.find((i) => i.id === Number(str.inverterId));
    const panel = flatPanels.find((p) => p.id === Number(str.fields[0].panelId));
    if (!inv || !panel) { toast('Wechselrichter oder Modul unbekannt.', 'error'); return; }
    const P = CONFIG.physics;
    const tk = Number.isFinite(Number(panel.tempVoc)) ? Number(panel.tempVoc) : P.defaultTempVoc;
    const hotFactor = 1 + (P.tHot - P.tStc) * (tk / 100);
    const coldFactor = 1 + (P.tCold - P.tStc) * (tk / 100);
    const vmpPer = panel.vmp * hotFactor;
    const vocPer = panel.voc * coldFactor;
    if (!(vmpPer > 0) || !(vocPer > 0)) { toast('Moduldaten unplausibel.', 'error'); return; }
    const midWindow = (inv.minMppV + inv.maxMppV) / 2;
    const nByWindow = Math.round(midWindow / vmpPer);
    const nByVoc = Math.floor(inv.maxV / vocPer);
    const nByStart = Math.ceil(inv.startV / vmpPer);
    let n = clampInt(nByWindow, 1, CONFIG.limits.countMax);
    if (nByStart > nByVoc) {
        toast(`Nicht darstellbar: Startspannung braucht ≥ ${nByStart} Module, Maximalspannung erlaubt ≤ ${nByVoc}.`, 'error');
        return;
    }
    n = clamp(n, nByStart, Math.max(nByStart, nByVoc));
    const tilt = str.fields[0].tilt;
    str.fields = [{ id: newStringId(), panelId: panel.id, count: n, tilt }];
    updatePhysicsOnly();
    reopenEditor(sId);
    markDirty();
    toast(`MPPT-Optimum: ${n}× ${panel.name} (${Math.round(n * vmpPer)} V im Fenster ${inv.minMppV}–${inv.maxMppV} V).`, 'success');
}

function bindStringsListEvents() {
    const list = $('stringsList');
    if (!list) return;
    list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const sid = Number(btn.dataset.sid);
        if (!Number.isFinite(sid)) return;
        const action = btn.dataset.action;
        if (action === 'edit' || action === 'close-edit') toggleEditMode(sid);
        else if (action === 'add-field') { addField(sid); reopenEditor(sid); }
        else if (action === 'remove-string') removeString(sid);
        else if (action === 'suggest') suggestStringConfig(sid);
        else if (action === 'remove-field') {
            const fid = Number(btn.dataset.fid);
            if (Number.isFinite(fid)) { removeField(sid, fid); reopenEditor(sid); }
        }
    });
    list.addEventListener('change', (e) => {
        const el = e.target.closest('[data-key]');
        if (!el) return;
        const sid = Number(el.dataset.sid);
        if (!Number.isFinite(sid)) return;
        if (el.dataset.fid !== undefined) {
            const fid = Number(el.dataset.fid);
            if (Number.isFinite(fid)) updateFieldData(sid, fid, el.dataset.key, el.value);
        } else {
            updateStringData(sid, el.dataset.key, el.value);
        }
    });
    list.addEventListener('input', (e) => {
        if (e.target.matches('input[type="range"][data-key="shading"]')) {
            const label = e.target.closest('div')?.querySelector('[data-shading-label]');
            if (label) label.textContent = `${e.target.value}%`;
        }
    });
}

// ---------- 10. PHYSIK-ENGINE ----------
function computeStringPhysics(str) {
    const P = CONFIG.physics;
    let vocStc = 0, vmpStc = 0, vocCold = 0, vmpHot = 0, iscMax = 0, impMax = 0;
    (str.fields || []).forEach((f) => {
        const p = flatPanels.find((x) => x.id === Number(f.panelId));
        if (!p) return;
        const n = clampInt(f.count, 0, CONFIG.limits.countMax);
        const tk = Number.isFinite(Number(p.tempVoc)) ? Number(p.tempVoc) : P.defaultTempVoc;
        vocStc += p.voc * n;
        vmpStc += p.vmp * n;
        vocCold += p.voc * n * (1 + (P.tCold - P.tStc) * (tk / 100));
        vmpHot += p.vmp * n * (1 + (P.tHot - P.tStc) * (tk / 100));
        iscMax = Math.max(iscMax, p.isc);
        if (p.vmp > 0 && p.pmax > 0) impMax = Math.max(impMax, p.pmax / p.vmp);
    });
    const inv = flatInverters.find((i) => i.id === Number(str.inverterId));
    const mppt = inv?.mppts?.find((m) => m.id === Number(str.mpptId)) || inv?.mppts?.[0];
    const phys = {
        vocStc, vmpStc, vocCold, vmpHot, isc: iscMax, imp: impMax,
        limitMaxV: inv?.maxV || 1000,
        limitMaxIsc: mppt?.maxIsc || 20,
        limitMaxI: mppt?.maxI || 15,
        minMppV: inv?.minMppV || 0,
        maxMppV: inv?.maxMppV || 0,
        invStartV: inv?.startV || 0,
        mismatchPct: str._phys?.mismatchPct || 0
    };
    phys.isVocSafe = phys.vocCold <= phys.limitMaxV;
    phys.isIscSafe = phys.isc <= phys.limitMaxIsc;
    phys.isImpSafe = phys.imp <= phys.limitMaxI;
    return phys;
}

function updatePhysicsOnly() {
    strings.forEach((str) => { str._phys = computeStringPhysics(str); });
    renderStringsUI();
    renderDatabaseUI();
    updateHeaderStats();
}

function stringsKwp() {
    let kwp = 0;
    strings.forEach((str) => {
        (str.fields || []).forEach((f) => {
            const p = flatPanels.find((x) => x.id === Number(f.panelId));
            if (p) kwp += (p.pmax * Number(f.count)) / 1000;
        });
    });
    return kwp;
}

function stringsModuleCount() {
    return strings.reduce((sum, s) => sum + (s.fields || []).reduce((a, f) => a + (Number(f.count) || 0), 0), 0);
}

function updateHeaderStats() {
    const el = $('headerStats');
    if (!el) return;
    if (strings.length === 0) {
        el.innerHTML = '<span class="text-slate-500">Noch keine Strings</span>';
        return;
    }
    const kwp = stringsKwp().toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    el.innerHTML = `<span class="material-symbols-rounded text-sm text-amber-400 fill-1">solar_power</span><span>${kwp} kWp · ${fmtIntDE(stringsModuleCount())} Module · ${strings.length} String${strings.length === 1 ? '' : 's'}</span>`;
}

// ---------- 11. RENDER: STRINGS-UI ----------
function badge(status, icon, text) {
    const styles = {
        ok: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/40',
        warn: 'text-amber-400 bg-amber-950/60 border-amber-800/40',
        err: 'text-rose-400 bg-rose-950/60 border-rose-800/40 animate-pulse'
    };
    return `<span class="inline-flex items-center gap-1 text-[11px] font-semibold ${styles[status]} border px-2 py-0.5 rounded-full"><span class="material-symbols-rounded text-sm fill-1">${icon}</span> ${esc(text)}</span>`;
}

function buildModelOptions(seriesList, selectedId) {
    return seriesList.map((s) =>
        `<optgroup label="${esc(s.series)}">${(s.models || []).map((m) =>
            `<option value="${m.id}"${Number(m.id) === Number(selectedId) ? ' selected' : ''}>${esc(m.name)}</option>`
        ).join('')}</optgroup>`
    ).join('');
}

function renderStringsUI() {
    const container = $('stringsList');
    const emptyMsg = $('emptyStringMessage');
    if (!container) return;
    if (strings.length === 0) {
        container.innerHTML = '';
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        return;
    }
    if (emptyMsg) emptyMsg.classList.add('hidden');

    const panelOptions = (sel) => buildModelOptions(DB.panels, sel);
    const invOptions = (sel) => buildModelOptions(DB.inverters, sel);

    container.innerHTML = strings.map((str) => {
        const p = str._phys || computeStringPhysics(str);
        const inv = flatInverters.find((i) => i.id === Number(str.inverterId)) || { name: 'Kein WR', mppts: [] };
        const mOpt = (inv.mppts || []).map((m) => `<option value="${m.id}"${Number(str.mpptId) === Number(m.id) ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
        const safe = p.isVocSafe && p.isIscSafe && p.isImpSafe;

        let vmpStatus = 'ok', vmpIcon = 'check_circle';
        if (p.vmpHot < p.invStartV) { vmpStatus = 'err'; vmpIcon = 'cancel'; }
        else if (p.vmpHot < p.minMppV || p.vmpHot > p.maxMppV) { vmpStatus = 'warn'; vmpIcon = 'warning'; }

        const uocBadge = badge(p.isVocSafe ? 'ok' : 'err', p.isVocSafe ? 'check_circle' : 'error', `Uoc: ${p.vocCold.toFixed(0)}V`);
        const vmpBadge = badge(vmpStatus, vmpIcon, `Umpp: ${p.vmpHot.toFixed(0)}V`);
        const iscBadge = badge(p.isIscSafe ? 'ok' : 'err', p.isIscSafe ? 'check_circle' : 'error', `Isc: ${p.isc.toFixed(1)}A`);
        const impBadge = badge(p.isImpSafe ? 'ok' : 'err', p.isImpSafe ? 'check_circle' : 'error', `Impp: ${p.imp.toFixed(1)}A`);
        const mismatchInfo = p.mismatchPct > 0
            ? badge('err', 'alt_route', `-${p.mismatchPct.toFixed(1)}% Mismatch`) : '';

        const modTotal = (str.fields || []).reduce((sum, f) => sum + (Number(f.count) || 0), 0);
        const strKwp = (str.fields || []).reduce((sum, f) => {
            const panel = flatPanels.find((x) => x.id === Number(f.panelId));
            return sum + (panel ? (panel.pmax * Number(f.count)) / 1000 : 0);
        }, 0);

        const azimuths = [[180, 'Süd (180°)'], [90, 'Ost (90°)'], [270, 'West (270°)'], [0, 'Nord (0°)'], [135, 'Südost (135°)'], [225, 'Südwest (225°)']];
        const azOpts = azimuths.map(([v, label]) => `<option value="${v}"${Number(str.azimuth) === v ? ' selected' : ''}>${label}</option>`).join('');

        return `
        <div class="m3-card bg-white dark:bg-slate-900 border ${safe ? 'border-slate-200 dark:border-slate-800' : 'border-rose-500/80 ring-2 ring-rose-500/20'} rounded-2xl shadow-sm mb-4 transition-all overflow-hidden">
            <div class="p-4">
                <div class="flex justify-between items-center mb-3 gap-2">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-2.5 h-9 rounded-full shrink-0 shadow-sm" style="background-color: ${esc(str.color)}"></div>
                        <div class="flex flex-col min-w-0">
                            <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 leading-none truncate">${esc(str.name)}
                                <span class="font-normal text-xs text-slate-400">| ${modTotal}× Modul (${strKwp.toFixed(2)} kWp) an ${esc(inv.name)}</span>
                            </h4>
                            ${str.group ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">Gruppe: ${esc(str.group)}</p>` : ''}
                        </div>
                    </div>
                    <button data-action="edit" data-sid="${str.id}" aria-label="String konfigurieren" class="bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shrink-0">
                        <span class="material-symbols-rounded text-base">tune</span>
                        <span class="hidden md:inline">Konfigurieren</span>
                    </button>
                </div>
                <div class="bg-slate-900/90 text-slate-300 rounded-xl p-2.5 flex flex-wrap items-center gap-2 border border-slate-800 shadow-inner">
                    ${uocBadge}${vmpBadge}${iscBadge}${impBadge}${mismatchInfo}
                </div>
            </div>

            <div id="edit-${str.id}" class="hidden p-5 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Name</label>
                        <input type="text" maxlength="60" value="${esc(str.name)}" data-key="name" data-sid="${str.id}" class="w-full border-2 border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-xl px-3 py-1.5 text-xs font-medium outline-none focus:border-primary">
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Gruppe / Dach</label>
                        <input type="text" maxlength="60" value="${esc(str.group || '')}" placeholder="Z.B. Süd-Dach" data-key="group" data-sid="${str.id}" class="w-full border-2 border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-xl px-3 py-1.5 text-xs font-medium outline-none focus:border-primary">
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Wechselrichter</label>
                        <select data-key="inverterId" data-sid="${str.id}" class="w-full border-2 border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-xl px-3 py-1.5 text-xs font-medium outline-none focus:border-primary">${invOptions(str.inverterId)}</select>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Tracker</label>
                        <select data-key="mpptId" data-sid="${str.id}" class="w-full border-2 border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-xl px-3 py-1.5 text-xs font-medium outline-none focus:border-primary">${mOpt}</select>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Azimut (Grad)</label>
                        <select data-key="azimuth" data-sid="${str.id}" class="w-full border-2 border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-xl px-3 py-1.5 text-xs font-medium outline-none focus:border-primary">${azOpts}</select>
                    </div>
                </div>

                <div>
                    <div class="flex justify-between items-center mb-1">
                        <label class="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Pauschale Verschattung</label>
                        <span data-shading-label class="text-xs font-black text-slate-700 dark:text-slate-300 bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded-full">${str.shading || 0}%</span>
                    </div>
                    <input type="range" min="0" max="80" step="1" value="${str.shading || 0}" data-key="shading" data-sid="${str.id}" class="w-full" aria-label="Verschattung in Prozent">
                </div>

                <div class="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                    <div class="bg-slate-100 dark:bg-slate-800 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center gap-2">
                        <span class="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <span class="material-symbols-rounded text-sm text-primary">grid_view</span> Modulfelder
                        </span>
                        <div class="flex items-center gap-2">
                            <button data-action="suggest" data-sid="${str.id}" title="Modulanzahl automatisch mittig ins MPP-Fenster legen" class="text-accent bg-emerald-500/10 hover:bg-emerald-500/20 font-bold text-xs px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1">
                                <span class="material-symbols-rounded text-sm">auto_fix_high</span> MPPT-Optimum
                            </button>
                            <button data-action="add-field" data-sid="${str.id}" class="text-primary bg-primary/10 hover:bg-primary/20 font-bold text-xs px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1">
                                <span class="material-symbols-rounded text-sm">add</span> Feld
                            </button>
                        </div>
                    </div>
                    <div class="p-3 space-y-2">
                        ${(str.fields || []).map((f) => `
                            <div class="flex flex-col md:flex-row items-center gap-2 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
                                <select data-key="panelId" data-sid="${str.id}" data-fid="${f.id}" aria-label="Modultyp" class="w-full md:flex-1 border border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-lg px-2.5 py-1.5 outline-none text-xs font-medium">${panelOptions(f.panelId)}</select>
                                <div class="flex w-full md:w-auto justify-between items-center gap-2">
                                    <div class="flex items-center"><input type="number" min="1" max="99" value="${f.count}" data-key="count" data-sid="${str.id}" data-fid="${f.id}" aria-label="Anzahl Module" class="w-14 border border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-lg px-1.5 py-1 outline-none font-bold text-center text-xs"><span class="text-[9px] font-bold text-slate-500 uppercase ml-1">Stk</span></div>
                                    <div class="flex items-center"><input type="number" min="0" max="90" value="${f.tilt}" data-key="tilt" data-sid="${str.id}" data-fid="${f.id}" aria-label="Neigung in Grad" class="w-14 border border-slate-200 dark:border-slate-700 dark:bg-slate-900 rounded-lg px-1.5 py-1 outline-none font-bold text-center text-xs"><span class="text-[9px] font-bold text-slate-500 uppercase ml-1">° Neig</span></div>
                                    <button data-action="remove-field" data-sid="${str.id}" data-fid="${f.id}" aria-label="Modulfeld entfernen" class="text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 p-1.5 rounded-lg transition-colors"><span class="material-symbols-rounded text-base">delete</span></button>
                                </div>
                            </div>`).join('')}
                    </div>
                </div>

                <div class="flex items-center justify-between pt-2">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold text-slate-500 dark:text-slate-400">Farbe:</span>
                        <input type="color" value="${esc(str.color)}" data-key="color" data-sid="${str.id}" aria-label="String-Farbe" class="shrink-0 border-none cursor-pointer">
                    </div>
                    <button data-action="remove-string" data-sid="${str.id}" class="text-xs font-bold text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1">
                        <span class="material-symbols-rounded text-sm">delete_forever</span> String Löschen
                    </button>
                </div>

                <div class="text-center pt-4 border-t border-slate-200 dark:border-slate-800 mt-2">
                    <button data-action="close-edit" data-sid="${str.id}" class="bg-primary hover:bg-primary-hover text-white font-bold px-6 py-2.5 rounded-xl shadow-md w-full md:w-auto text-xs flex items-center justify-center gap-1.5 mx-auto transition-all">
                        <span class="material-symbols-rounded text-base">done</span> Schließen & Übernehmen
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ---------- 12. VERBRAUCH ----------
function updateHouseHint() {
    const val = parseInt($('cons_base_kwh')?.value, 10) || 0;
    let hint = '1-Person';
    if (val >= 2000) hint = '2-Personen';
    if (val >= 3000) hint = '3-Personen';
    if (val >= 4000) hint = '4-Personen';
    if (val >= 5000) hint = '5+ Personen';
    const hEl = $('cons_house_hint');
    if (hEl) hEl.textContent = hint + '-Haushalt';
}

function getConsumptionConfig() {
    const baseInp = clamp(Number($('cons_base_kwh')?.value) || 0, 0, 100000);
    const house = clamp(Number($('cons_house')?.value) || 0, 0, 100000);
    const evKm = $('cons_ev_active')?.checked ? clamp(Number($('cons_ev_km')?.value) || 0, 0, 200000) : 0;
    const ev100 = clamp(Number($('cons_ev_kwh100')?.value) || 0, 0, 100);
    return {
        baseKwh: baseInp + house,
        it: $('cons_it_active')?.checked ? clamp(Number($('cons_it_w')?.value) || 0, 0, 10000) : 0,
        ac: $('cons_ac_active')?.checked ? clamp(Number($('cons_ac_kwh')?.value) || 0, 0, 100000) : 0,
        wp: $('cons_wp_active')?.checked ? clamp(Number($('cons_wp_kwh')?.value) || 0, 0, 100000) : 0,
        bw: $('cons_bw_active')?.checked ? clamp(Number($('cons_bw_kwh')?.value) || 0, 0, 100000) : 0,
        bwSmart: $('cons_bw_smart')?.checked === true,
        evKm, ev100,
        ev: (evKm / 100) * ev100,
        evSmart: $('cons_ev_smart')?.checked === true
    };
}

function toggleConsGroup(id) {
    $(`grp_${id}`)?.classList.toggle('hidden', !$(`cons_${id}_active`)?.checked);
    updateConsumptionEstimate();
    markDirty();
}

function updateConsumptionEstimate() {
    const c = getConsumptionConfig();
    const el = $('lbl_total_kwh_est');
    if (el) el.textContent = fmtIntDE(c.baseKwh + (c.it * 8.76) + c.ac + c.wp + c.bw + c.ev);
}

function saveConsumptionSettings() {
    writeJsonStorage('pvpro_cons', {
        baseInp: $('cons_base_kwh')?.value ?? 3500,
        house: $('cons_house')?.value ?? 0,
        itOn: $('cons_it_active')?.checked === true, itW: $('cons_it_w')?.value ?? 100,
        acOn: $('cons_ac_active')?.checked === true, acKwh: $('cons_ac_kwh')?.value ?? 400,
        wpOn: $('cons_wp_active')?.checked === true, wpKwh: $('cons_wp_kwh')?.value ?? 3500,
        bwOn: $('cons_bw_active')?.checked === true, bwKwh: $('cons_bw_kwh')?.value ?? 800,
        bwSmart: $('cons_bw_smart')?.checked === true,
        evOn: $('cons_ev_active')?.checked === true, evKm: $('cons_ev_km')?.value ?? 12000,
        ev100: $('cons_ev_kwh100')?.value ?? 18, evSmart: $('cons_ev_smart')?.checked === true
    });
}

function loadConsumptionSettings() {
    const c = readJsonStorage('pvpro_cons', null);
    if (!c || typeof c !== 'object') { updateConsumptionEstimate(); updateHouseHint(); return; }
    // Migration: altes Format speicherte abgeleitete kWh statt Roh-Eingaben
    let evKm = c.evKm, ev100 = c.ev100;
    if (c.evOn === undefined && typeof c.ev === 'number' && c.ev > 0) { evKm = (c.ev / 18) * 100; ev100 = 18; }
    const set = (id, v) => { const el = $(id); if (el && v !== undefined) el.value = v; };
    const check = (id, v) => { const el = $(id); if (el) el.checked = v === true; };
    set('cons_base_kwh', c.baseInp ?? 3500);
    set('cons_house', c.house ?? 0);
    check('cons_it_active', c.itOn); set('cons_it_w', c.itW);
    check('cons_ac_active', c.acOn); set('cons_ac_kwh', c.acKwh);
    check('cons_wp_active', c.wpOn); set('cons_wp_kwh', c.wpKwh);
    check('cons_bw_active', c.bwOn); set('cons_bw_kwh', c.bwKwh); check('cons_bw_smart', c.bwSmart);
    check('cons_ev_active', c.evOn ?? (typeof c.ev === 'number' && c.ev > 0)); set('cons_ev_km', evKm); set('cons_ev_kwh100', ev100); check('cons_ev_smart', c.evSmart);
    ['it', 'ac', 'wp', 'bw', 'ev'].forEach((id) => {
        $(`grp_${id}`)?.classList.toggle('hidden', !$(`cons_${id}_active`)?.checked);
    });
    updateConsumptionEstimate();
    updateHouseHint();
}

function normalizeToKwh(arr, targetKwh) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    const targetWh = targetKwh * 1000;
    if (sum <= 0 || targetKwh <= 0) { arr.fill(0); return arr; }
    const scale = targetWh / sum;
    for (let i = 0; i < arr.length; i++) arr[i] *= scale;
    return arr;
}

function build8760ConsumptionArray(pvProfile = null) {
    const C = CONFIG.consumption;
    const c = getConsumptionConfig();
    const out = {
        total: new Float32Array(8760), base: new Float32Array(8760), it: new Float32Array(8760),
        ac: new Float32Array(8760), wp: new Float32Array(8760), bw: new Float32Array(8760), ev: new Float32Array(8760)
    };
    const smartEvHours = new Set(), smartBwHours = new Set();
    if (pvProfile) {
        if (c.ev > 0 && c.evSmart) {
            for (let w = 0; w < 52; w++) {
                const hrs = [];
                for (let h = w * 168; h < w * 168 + 168 && h < 8760; h++) {
                    if (h % 24 >= C.smartEvWindowStart && h % 24 <= C.smartEvWindowEnd) hrs.push({ h, pv: pvProfile[h] });
                }
                hrs.sort((a, b) => b.pv - a.pv).slice(0, C.smartEvHoursPerWeek).forEach((x) => smartEvHours.add(x.h));
            }
        }
        if (c.bw > 0 && c.bwSmart) {
            for (let d = 0; d < 365; d++) {
                const hrs = [];
                for (let h = d * 24; h < d * 24 + 24; h++) {
                    if (h % 24 >= C.smartBwWindowStart && h % 24 <= C.smartBwWindowEnd) hrs.push({ h, pv: pvProfile[h] });
                }
                hrs.sort((a, b) => b.pv - a.pv).slice(0, C.smartBwHoursPerDay).forEach((x) => smartBwHours.add(x.h));
            }
        }
    }
    // Roh-Gewichte (werden danach exakt auf die Jahres-kWh normiert)
    for (let h = 0; h < 8760; h++) {
        const d = Math.floor(h / 24), hr = h % 24;
        const seasonal = 1 + 0.3 * Math.cos((d - 15) * 2 * Math.PI / 365);
        const daypart = (hr >= 18 && hr <= 22) ? 1.5 : ((hr >= 10 && hr <= 17) ? 0.8 : 1.0);
        out.base[h] = seasonal * daypart;
        out.it[h] = c.it;
        if (c.ac > 0 && d >= C.acSeasonStartDay && d <= C.acSeasonEndDay && hr >= C.acHourStart && hr <= C.acHourEnd) out.ac[h] = 1;
        if (c.wp > 0 && (d < C.heatSeasonEndDay || d > C.heatSeasonStartDay)) {
            out.wp[h] = 1 + 0.5 * Math.cos((d - 15) * 2 * Math.PI / 365);
        }
        if (c.bw > 0) {
            if (c.bwSmart && pvProfile) { if (smartBwHours.has(h)) out.bw[h] = 1; }
            else if (hr >= C.bwEveningStart && hr <= C.bwEveningEnd) out.bw[h] = 1;
        }
        if (c.ev > 0) {
            if (c.evSmart && pvProfile) { if (smartEvHours.has(h)) out.ev[h] = 1; }
            else if (hr >= C.evEveningStart && hr <= C.evEveningEnd) out.ev[h] = 1;
        }
    }
    normalizeToKwh(out.base, c.baseKwh);
    out.it.fill(c.it);
    normalizeToKwh(out.ac, c.ac);
    normalizeToKwh(out.wp, c.wp);
    normalizeToKwh(out.bw, c.bw);
    normalizeToKwh(out.ev, c.ev);
    for (let h = 0; h < 8760; h++) {
        out.total[h] = out.base[h] + out.it[h] + out.ac[h] + out.wp[h] + out.bw[h] + out.ev[h];
    }
    ConsumptionCache = out;
    return out;
}

// ---------- 13. INVESTITION ----------
function parseCost(val) {
    if (val === null || val === undefined || val === '') return 0;
    const n = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(n)) return 0;
    return clamp(n, CONFIG.limits.moneyMin, CONFIG.limits.moneyMax);
}

const INVEST_KEYS = ['panels', 'mounting', 'inverter', 'battery', 'smartmeter', 'cables', 'gak', 'acmat', 'scaffold', 'electrician', 'misc'];

function getInvestConfig() {
    const cfg = {};
    INVEST_KEYS.forEach((k) => { cfg[k] = parseCost($(`inv_cost_${k}`)?.value); });
    return cfg;
}

function calcInvestTotal() {
    const inv = getInvestConfig();
    const cat1 = inv.panels + inv.mounting;
    const cat2 = inv.inverter + inv.battery + inv.smartmeter;
    const cat3 = inv.cables + inv.gak + inv.acmat;
    const cat4 = inv.scaffold + inv.electrician + inv.misc;
    const total = cat1 + cat2 + cat3 + cat4;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('sub_invest_cat1', fmtMoney(cat1));
    set('sub_invest_cat2', fmtMoney(cat2));
    set('sub_invest_cat3', fmtMoney(cat3));
    set('sub_invest_cat4', fmtMoney(cat4));
    set('lbl_invest_total', fmtIntDE(total));
    if (total > 0) {
        const sysCostEl = $('fin_sys_cost');
        if (sysCostEl && document.activeElement !== sysCostEl) sysCostEl.value = Math.round(total);
    }
    persistInvest();
}

function persistInvest() { writeJsonStorage('pvpro_invest', getInvestConfig()); }

function loadInvestSettings() {
    const inv = readJsonStorage('pvpro_invest', {});
    INVEST_KEYS.forEach((k) => {
        const el = $(`inv_cost_${k}`);
        if (el && Number.isFinite(Number(inv[k]))) el.value = clamp(Number(inv[k]), 0, CONFIG.limits.moneyMax);
    });
    calcInvestTotal();
}

// ---------- 14. FINANZEN ----------
function getFinanceConfig() {
    const L = CONFIG.limits;
    return {
        grid: clamp(Number($('fin_grid_price')?.value) || 0, L.priceMin, L.priceMax),
        cost: clamp(Number($('fin_sys_cost')?.value) || 0, 0, L.moneyMax),
        date: $('fin_eeg_date')?.value || '',
        gas: clamp(Number($('fin_gas_price')?.value) || 0, L.priceMin, L.priceMax),
        jaz: clamp(Number($('fin_wp_jaz')?.value) || 0, 1, 8),
        petrol: clamp(Number($('fin_petrol_price')?.value) || 0, L.priceMin, L.priceMax),
        ice: clamp(Number($('fin_ice_cons')?.value) || 0, 0, 50)
    };
}

function saveFinanceSettings() {
    const f = getFinanceConfig();
    writeJsonStorage('pvpro_finance', { grid: f.grid, cost: f.cost, date: f.date, gas: f.gas, jaz: f.jaz, petrol: f.petrol, ice: f.ice });
}

function loadFinanceSettings() {
    const s = readJsonStorage('pvpro_finance', {});
    const set = (id, v) => { const el = $(id); if (el && v !== undefined) el.value = v; };
    set('fin_grid_price', s.grid ?? 0.32);
    set('fin_sys_cost', s.cost ?? 15000);
    set('fin_eeg_date', s.date || '2024-05');
    set('fin_gas_price', s.gas ?? 1.10);
    set('fin_wp_jaz', s.jaz ?? 3.5);
    set('fin_petrol_price', s.petrol ?? 1.75);
    set('fin_ice_cons', s.ice ?? 7.0);
    updateEEGPreview();
}

function computeEEG(dateStr, totalKwp) {
    const E = CONFIG.eeg;
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(dateStr || ''));
    if (!m) return { rate: 0, valid: false };
    const year = Number(m[1]), month = Number(m[2]);
    if (year >= E.cutoffYear) return { rate: 0, valid: true };
    const monthsSince = (year - E.refYear) * 12 + (month - E.refMonth);
    const periods = monthsSince > 0 ? Math.floor(monthsSince / E.degressionEveryMonths) : 0;
    const degression = Math.pow(E.degressionFactor, periods);
    const base = totalKwp <= E.thresholdKwp
        ? E.rateUpTo10kWp
        : ((E.thresholdKwp * E.rateUpTo10kWp) + ((totalKwp - E.thresholdKwp) * E.rateAbove10kWp)) / totalKwp;
    return { rate: base * degression, valid: true };
}

function updateEEGPreview() {
    const kwp = stringsKwp() || 0;
    const dateEl = $('fin_eeg_date');
    const preEl = $('lbl_eeg_rate_pre');
    if (!dateEl) return 0;
    const { rate, valid } = computeEEG(dateEl.value, kwp > 0 ? kwp : 1);
    if (preEl) preEl.textContent = valid ? rate.toFixed(2) : '–';
    dateEl.classList.toggle('border-rose-500', !valid);
    return rate;
}

function calculateFinances() {
    const f = getFinanceConfig();
    saveFinanceSettings();
    const kwp = stringsKwp() || 1;
    const { rate: finalEeg } = computeEEG(f.date, kwp);
    const eegUi = $('rep_b_eeg_rate');
    if (eegUi) eegUi.textContent = finalEeg.toFixed(2);
    if (!FlowCache) return;

    const c = getConsumptionConfig();
    const costA_grid = (c.baseKwh + (c.it * 8.76) + c.ac) * f.grid;
    const costA_heat = (((c.wp + c.bw) * f.jaz) / CONFIG.heating.kwhPerOilLiter) * f.gas;
    const costA_car = c.ev > 0 ? (c.evKm / 100) * f.ice * f.petrol : 0;
    const costA_total = costA_grid + costA_heat + costA_car;

    const costB_grid = FlowCache.fromGrid * f.grid;
    const costB_rev = FlowCache.toGrid * (finalEeg / 100);
    const costB_total = costB_grid - costB_rev;

    const savings = costA_total - costB_total;
    const amort = savings > 0 ? (f.cost / savings).toFixed(1) : '∞';

    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('rep_a_grid', '+ ' + fmtMoney(costA_grid));
    set('rep_a_car', '+ ' + fmtMoney(costA_car));
    set('rep_a_heat', '+ ' + fmtMoney(costA_heat));
    set('rep_a_total', fmtMoney(costA_total));
    set('rep_b_grid', '+ ' + fmtMoney(costB_grid));
    set('rep_b_rev', '- ' + fmtMoney(costB_rev));
    set('rep_b_total', fmtMoney(costB_total));
    set('rep_diff', fmtMoney(savings));
    set('kpi_savings', fmtMoney(savings));
    set('kpi_roi', amort);
}

// ---------- 15. STANDORTSUCHE ----------
async function searchLocation() {
    const input = $('locSearchInput');
    const q = input?.value?.trim();
    if (!q) { toast('Bitte einen Ort eingeben.', 'warn'); return; }
    const btn = $('btnLocSearch');
    if (btn) btn.disabled = true;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), CONFIG.nominatim.timeoutMs);
        const url = `${CONFIG.nominatim.baseUrl}?format=json&q=${encodeURIComponent(q)}&limit=1&accept-language=de`;
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            const lat = Number(data[0].lat), lon = Number(data[0].lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('ungültige Koordinaten');
            LocationData = { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)), name: String(data[0].display_name).split(',')[0].slice(0, 80) };
            const locTxt = $('locNameText'); if (locTxt) locTxt.textContent = LocationData.name;
            $('locEditBox')?.classList.add('hidden');
            markDirty();
            toast(`Standort: ${LocationData.name}`, 'success');
        } else {
            toast('Ort nicht gefunden – bitte genauer suchen.', 'warn');
        }
    } catch (e) {
        console.warn('Geocoding fehlgeschlagen:', e);
        toast('Standortsuche fehlgeschlagen (offline oder gedrosselt).', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ---------- 16. PVGIS & 8760h-ENGINE ----------
function setCalcProgress(pct, label) {
    const wrap = $('calcProgressWrap'), bar = $('calcProgressBar'), status = $('calcStatus');
    if (wrap) wrap.classList.remove('hidden');
    if (bar) bar.style.width = `${clamp(Math.round(pct), 0, 100)}%`;
    if (status && label !== undefined) status.textContent = label;
}
function hideCalcProgress() {
    $('calcProgressWrap')?.classList.add('hidden');
    const bar = $('calcProgressBar'); if (bar) bar.style.width = '0%';
}

function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function sanitizeHourlySeries(hourly) {
    if (!Array.isArray(hourly) || hourly.length !== 8760) return null;
    const out = new Array(8760);
    let invalid = 0;
    for (let h = 0; h < 8760; h++) {
        const v = Number(hourly[h]?.P);
        if (Number.isFinite(v) && v >= 0 && v < 10_000_000) out[h] = { P: v };
        else { out[h] = { P: 0 }; invalid++; }
    }
    return invalid > 4380 ? null : out; // >50 % kaputt → als Offline werten
}

async function fetchFieldHourly({ lat, lon, tilt, aspect, peakKw, shadingFactor, panel, count, sId, fId }) {
    const peakPower = (panel.pmax * count) / 1000;
    const url = `${CONFIG.pvgis.baseUrl}?lat=${lat}&lon=${lon}&pvcalculation=1&peakpower=${peakKw}` +
        `&loss=${CONFIG.pvgis.loss}&angle=${tilt}&aspect=${aspect}` +
        `&startyear=${CONFIG.pvgis.year}&endyear=${CONFIG.pvgis.year}&outputformat=json`;
    try {
        const res = await fetchWithTimeout(url, CONFIG.pvgis.timeoutMs);
        if (res.ok) {
            const json = await res.json();
            const clean = sanitizeHourlySeries(json?.outputs?.hourly);
            if (clean) return { sId, fId, d: clean, sF: shadingFactor, panel, count, offline: false };
        }
    } catch (e) { /* Fallback unten */ }
    const azimuth = aspect + 180;
    return {
        sId, fId, d: generateSyntheticPVGISData(lat, tilt, azimuth, peakPower),
        sF: shadingFactor, panel, count, offline: true
    };
}

async function calculateYieldAPI() {
    if (isCalculating) return;
    if (strings.length === 0) { toast('Bitte zuerst mindestens einen String anlegen.', 'warn'); switchTab('system'); return; }
    const btn = $('btnCalculateMain');
    const origTxt = btn ? btn.innerHTML : '';
    isCalculating = true;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-rounded text-2xl spinner">progress_activity</span><span>Berechnung läuft …</span>';
    }
    setCalcProgress(2, 'PVGIS-Daten werden abgerufen …');

    try {
        const safeLat = Number.isFinite(Number(LocationData?.lat)) ? Number(LocationData.lat) : 48.06;
        const safeLon = Number.isFinite(Number(LocationData?.lon)) ? Number(LocationData.lon) : 8.46;

        const jobs = [];
        strings.forEach((str) => {
            const shadingFactor = 1 - ((Number(str.shading) || 0) / 100);
            (str.fields || []).forEach((f) => {
                const p = flatPanels.find((x) => x.id === Number(f.panelId));
                if (p && Number(f.count) > 0) {
                    let asp = Number(str.azimuth) - 180;
                    if (asp > 180) asp -= 360;
                    if (asp < -180) asp += 360;
                    jobs.push({
                        lat: safeLat, lon: safeLon, tilt: Number(f.tilt) || 0, aspect: asp,
                        peakKw: ((p.pmax * Number(f.count)) / 1000).toFixed(3),
                        shadingFactor, panel: p, count: Number(f.count), sId: str.id, fId: f.id
                    });
                }
            });
        });
        if (jobs.length === 0) throw new Error('Keine gültigen Strings oder Module definiert.');

        let done = 0;
        const results = await Promise.all(jobs.map((job) =>
            fetchFieldHourly(job).then((r) => {
                done++;
                setCalcProgress(2 + Math.round((done / jobs.length) * 55), `PVGIS-Daten … (${done}/${jobs.length})`);
                return r;
            })
        ));

        const offlineCount = results.filter((r) => r.offline).length;
        if (offlineCount > 0) {
            toast(`PVGIS nicht erreichbar – synthetische Ersatzdaten für ${offlineCount} von ${results.length} Feldern.`, 'warn');
        }

        setCalcProgress(60, 'Mismatch-Analyse (8.760 h) …');
        await new Promise((r) => setTimeout(r, 30)); // UI repaint

        const invH = {};
        const activeInvIds = [...new Set(strings.map((s) => Number(s.inverterId)))];
        const activeInvs = flatInverters.filter((i) => activeInvIds.includes(i.id));
        activeInvs.forEach((i) => { invH[i.id] = new Float32Array(8760); });

        const sRes = strings.map((s) => ({
            id: s.id, name: s.name, color: s.color, kwp: 0, yield: 0, clip: 0, batYield: 0,
            mo: new Array(12).fill(0), hr: new Float32Array(8760)
        }));

        const pvProfileRaw = new Float32Array(8760);
        const stringGroups = {};
        results.forEach((r) => {
            if (!stringGroups[r.sId]) stringGroups[r.sId] = [];
            stringGroups[r.sId].push(r);
        });

        for (const sId in stringGroups) {
            const fields = stringGroups[sId];
            const str = strings.find((s) => s.id === Number(sId));
            const sr = sRes.find((s) => s.id === Number(sId));
            if (!str || !sr) continue;
            let idealYear = 0, realYear = 0;
            for (let h = 0; h < 8760; h++) {
                let minCurrent = Infinity, totalVmp = 0, idealPower = 0;
                fields.forEach((f) => {
                    const pDc = f.d[h].P * f.sF;
                    idealPower += pDc;
                    const vmpField = f.panel.vmp * f.count;
                    totalVmp += vmpField;
                    let current = vmpField > 0 ? (pDc / vmpField) : 0;
                    if (current > f.panel.isc) current = f.panel.isc;
                    if (current < minCurrent) minCurrent = current;
                });
                if (minCurrent === Infinity) minCurrent = 0;
                const realPower = minCurrent * totalVmp;
                idealYear += idealPower;
                realYear += realPower;
                sr.hr[h] += realPower;
                if (invH[str.inverterId]) {
                    invH[str.inverterId][h] += realPower;
                    pvProfileRaw[h] += realPower;
                }
            }
            const mismatchPct = idealYear > 0 ? ((idealYear - realYear) / idealYear) * 100 : 0;
            if (!str._phys) str._phys = {};
            str._phys.mismatchPct = mismatchPct;
        }

        setCalcProgress(70, 'Energiefluss-Simulation (Speicher, Netz) …');
        await new Promise((r) => setTimeout(r, 30));

        const consH = build8760ConsumptionArray(pvProfileRaw);
        const systemLossFactor = CONFIG.physics.systemLossFactor;

        const flow = {
            direct: 0, toBat: 0, fromBat: 0, toGrid: 0, fromGrid: 0, clip: 0, batLoss: 0,
            moCons: new Array(12).fill(0), moGen: new Array(12).fill(0), moBat: new Array(12).fill(0),
            moFromGrid: new Array(12).fill(0),
            hr: {
                pvTotal: new Float32Array(8760), direct: new Float32Array(8760), fromBat: new Float32Array(8760),
                toGrid: new Float32Array(8760), toBat: new Float32Array(8760),
                fromGrid: new Float32Array(8760), clip: new Float32Array(8760), batLoss: new Float32Array(8760)
            }
        };
        const batCharges = {};
        activeInvs.forEach((inv) => { batCharges[inv.id] = 0; });

        for (let h = 0; h < 8760; h++) {
            let sysAcAvailableW = 0, sysBatChargeW = 0, sysClipW = 0;
            const loadW = consH.total[h] || 0;
            let remainingLoad = loadW;

            activeInvs.forEach((inv) => {
                const totalDcW = invH[inv.id][h] * systemLossFactor;
                const acLimit = inv.acMax || 0;
                const bat = flatBatteries.find((b) => b.id === inv.batteryId);
                const batCapWh = bat ? (bat.cap * 1000 * CONFIG.battery.usableShare) : 0;
                const batPowerW = bat ? bat.power : 0;
                const halfEff = Math.sqrt(bat?.eff || 0.90);

                const targetAcW = Math.min(acLimit, remainingLoad, totalDcW);
                remainingLoad -= targetAcW;
                sysAcAvailableW += targetAcW;
                let excessDc = totalDcW - targetAcW;

                if (excessDc > 0 && batCapWh > 0) {
                    const actualCharge = Math.min(excessDc, batPowerW, batCapWh - batCharges[inv.id]);
                    if (actualCharge > 0) {
                        batCharges[inv.id] += actualCharge * halfEff; // Ladeverlust
                        flow.batLoss += (actualCharge * (1 - halfEff)) / 1000;
                        excessDc -= actualCharge;
                        sysBatChargeW += actualCharge;
                        sRes.filter((sr) => strings.find((s) => s.id === sr.id)?.inverterId === inv.id).forEach((sr) => {
                            if (invH[inv.id][h] > 0) sr.batYield += (actualCharge * (sr.hr[h] / invH[inv.id][h])) / 1000;
                        });
                    }
                }
                if (excessDc > 0) {
                    const feedInW = Math.min(excessDc, acLimit - targetAcW);
                    sysAcAvailableW += feedInW;
                    excessDc -= feedInW;
                }
                if (excessDc > 0) {
                    sysClipW += excessDc;
                    sRes.filter((sr) => strings.find((s) => s.id === sr.id)?.inverterId === inv.id).forEach((sr) => {
                        if (invH[inv.id][h] > 0) sr.clip += (excessDc * (sr.hr[h] / invH[inv.id][h])) / 1000;
                    });
                }
            });

            let m = 0;
            for (let i = 11; i >= 0; i--) { if (h >= MONTH_START_HOUR[i]) { m = i; break; } }
            flow.moCons[m] += loadW / 1000;
            flow.moGen[m] += sysAcAvailableW / 1000;
            flow.hr.pvTotal[h] = sysAcAvailableW;
            flow.hr.toBat[h] = sysBatChargeW;
            flow.hr.clip[h] = sysClipW;

            if (sysAcAvailableW >= loadW) {
                flow.direct += loadW;
                flow.toGrid += (sysAcAvailableW - loadW);
                flow.hr.direct[h] = loadW;
                flow.hr.toGrid[h] = sysAcAvailableW - loadW;
            } else {
                let deficit = loadW - sysAcAvailableW;
                flow.direct += sysAcAvailableW;
                flow.hr.direct[h] = sysAcAvailableW;
                let dischargedEffW = 0, dischargeLossW = 0;
                activeInvs.forEach((inv) => {
                    if (deficit <= 0) return;
                    const bat = flatBatteries.find((b) => b.id === inv.batteryId);
                    if (!bat || bat.cap === 0) return;
                    const halfEff = Math.sqrt(bat.eff || 0.90);
                    const available = batCharges[inv.id];
                    if (available > 0) {
                        const drawW = Math.min(deficit / halfEff, bat.power, available);
                        batCharges[inv.id] -= drawW;
                        const delivered = drawW * halfEff;
                        deficit -= delivered;
                        dischargedEffW += delivered;
                        dischargeLossW += drawW * (1 - halfEff);
                    }
                });
                flow.fromBat += dischargedEffW;
                flow.batLoss += dischargeLossW / 1000;
                flow.hr.batLoss[h] = dischargeLossW;
                flow.moBat[m] += dischargedEffW / 1000;
                flow.hr.fromBat[h] = dischargedEffW;
                flow.fromGrid += deficit;
                flow.hr.fromGrid[h] = deficit;
                flow.moFromGrid[m] += deficit / 1000;
            }
        }

        sRes.forEach((sr) => {
            sr.yield = (sr.hr.reduce((a, b) => a + b, 0) / 1000) * systemLossFactor - sr.clip;
            for (let mm = 0; mm < 12; mm++) {
                let mSum = 0;
                const end = mm === 11 ? 8760 : MONTH_START_HOUR[mm + 1];
                for (let h = MONTH_START_HOUR[mm]; h < end; h++) mSum += sr.hr[h];
                sr.mo[mm] = (mSum / 1000) * systemLossFactor;
            }
            (strings.find((s) => s.id === sr.id)?.fields || []).forEach((f) => {
                const p = flatPanels.find((x) => x.id === Number(f.panelId));
                if (p) sr.kwp += (p.pmax * Number(f.count)) / 1000;
            });
        });

        const groupedResults = [];
        sRes.forEach((sr) => {
            const strObj = strings.find((x) => x.id === sr.id);
            const gName = strObj?.group?.trim() || sr.name;
            let g = groupedResults.find((x) => x.name === gName);
            if (!g) {
                g = { name: gName, color: sr.color, kwp: 0, yield: 0, clip: 0, batYield: 0, mo: new Array(12).fill(0), panels: 0, inverters: [] };
                groupedResults.push(g);
            }
            g.kwp += sr.kwp; g.yield += sr.yield; g.clip += sr.clip; g.batYield += sr.batYield;
            g.panels += (strObj?.fields || []).reduce((sum, f) => sum + (Number(f.count) || 0), 0);
            const inv = flatInverters.find((i) => i.id === Number(strObj?.inverterId));
            if (inv && !g.inverters.includes(inv.name)) g.inverters.push(inv.name);
            for (let mm = 0; mm < 12; mm++) g.mo[mm] += sr.mo[mm];
        });

        ['direct', 'fromBat', 'toGrid', 'fromGrid', 'toBat', 'clip'].forEach((k) => { flow[k] /= 1000; });

        YieldDataCache = groupedResults;
        FlowCache = flow;
        activeGroupIndex = null;
        if (currentDetailMonth === null) currentDetailMonth = new Date().getMonth();

        setCalcProgress(96, 'Auswertung wird erstellt …');
        renderStringsUI();
        renderDashboard();
        updateEEGPreview();
        setCalcProgress(100, 'Fertig.');
        switchTab('uebersicht');
        toast(`Simulation abgeschlossen: ${fmtIntDE(groupedResults.reduce((a, g) => a + g.yield, 0))} kWh/Jahr.`, 'success');
    } catch (e) {
        console.error(e);
        toast('Berechnungsfehler: ' + e.message, 'error');
    } finally {
        isCalculating = false;
        if (btn) { btn.innerHTML = origTxt; btn.disabled = false; }
        setTimeout(hideCalcProgress, 1200);
    }
}

// ---------- 17. DASHBOARD & CHARTS ----------
function setFocus(idx) {
    activeGroupIndex = activeGroupIndex === idx ? null : idx;
    renderDashboard();
}

function makeChart(canvasId, config) {
    const el = $(canvasId);
    if (!el || typeof Chart === 'undefined') return null;
    if (ChartRegistry[canvasId]) ChartRegistry[canvasId].destroy();
    const chart = new Chart(el.getContext('2d'), config);
    ChartRegistry[canvasId] = chart;
    return chart;
}

function stackedBarConfig(labels, datasets, dark) {
    return {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { color: dark ? 'rgba(255,255,255,0.05)' : '#e2e8f0' } },
                y: { stacked: true, min: 0, grid: { color: dark ? 'rgba(255,255,255,0.05)' : '#e2e8f0' } }
            },
            plugins: { legend: { position: 'bottom', labels: { color: dark ? '#cbd5e1' : '#475569', usePointStyle: true, boxWidth: 6 } } }
        }
    };
}

function withAlpha(hex, alphaHex) {
    return isHexColor(hex) ? hex + alphaHex : hex;
}

function renderDashboard() {
    if (!YieldDataCache || !FlowCache) return;
    if (typeof Chart === 'undefined') { toast('Chart-Bibliothek konnte nicht geladen werden (offline?).', 'error'); return; }
    const grpRes = YieldDataCache;
    let dK = 0, dY = 0;
    grpRes.forEach((g) => { dK += g.kwp; dY += g.yield; });

    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('kpi_gen', fmtIntDE(dY) + ' kWh');
    set('kpi_spec', (dK > 0 ? Math.round(dY / dK) : 0) + ' kWh/kWp');
    set('kpi_cons', fmtIntDE(FlowCache.direct + FlowCache.fromBat + FlowCache.fromGrid) + ' kWh');

    const sysY = grpRes.reduce((sum, g) => sum + g.yield, 0);
    const sBD = $('stringBreakdown');
    if (sBD) {
        sBD.innerHTML = grpRes.map((g, idx) => {
            const pct = sysY > 0 ? ((g.yield / sysY) * 100).toFixed(1) : 0;
            const active = activeGroupIndex === idx;
            return `
            <div data-focus="${idx}" role="button" tabindex="0" aria-label="Gruppe ${esc(g.name)} fokussieren"
                class="p-4 rounded-2xl border flex justify-between cursor-pointer transition-all ${active
                    ? 'bg-blue-50 dark:bg-blue-950/40 ring-2 ring-blue-400 shadow-md scale-[1.02] border-blue-200 dark:border-blue-800'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:shadow'}">
                <div class="flex items-center gap-3">
                    <div class="w-4 h-4 rounded-full shrink-0" style="background-color: ${esc(isHexColor(g.color) ? g.color : '#3b82f6')}"></div>
                    <div><p class="text-sm font-bold text-slate-800 dark:text-slate-100">${esc(g.name)}</p>
                    <p class="text-[10px] text-slate-500 dark:text-slate-400">${g.panels} Module (${g.kwp.toFixed(2)} kWp)</p></div>
                </div>
                <div class="text-right"><p class="text-base font-black text-slate-800 dark:text-slate-100">${pct}%</p></div>
            </div>`;
        }).join('');
    }

    makeChart('yieldChart', stackedBarConfig(MONTHS_SHORT,
        grpRes.map((g, idx) => ({
            label: g.name, data: g.mo.map((v) => Math.round(v)),
            backgroundColor: (activeGroupIndex !== null && activeGroupIndex !== idx) ? withAlpha(g.color, '20') : g.color,
            borderRadius: 3
        })), document.documentElement.classList.contains('dark')));

    const totalCons = FlowCache.direct + FlowCache.fromBat + FlowCache.fromGrid;
    set('d2-direct', fmtIntDE(FlowCache.direct) + ' kWh');
    set('d2-frombat', fmtIntDE(FlowCache.fromBat) + ' kWh');
    set('d2-grid-in', fmtIntDE(FlowCache.fromGrid) + ' kWh');
    set('d2-grid-out', fmtIntDE(FlowCache.toGrid) + ' kWh');

    const autarkyPct = Math.round(totalCons > 0 ? ((FlowCache.direct + FlowCache.fromBat) / totalCons) * 100 : 0);
    const eigenPct = Math.round(sysY > 0 ? (1 - (FlowCache.toGrid / sysY)) * 100 : 0);
    set('d2-val-autarky', autarkyPct + '%');
    set('d2-val-eigen', eigenPct + '%');
    $('gauge-autarky')?.setAttribute('stroke-dasharray', `${autarkyPct} 100`);
    $('gauge-eigen')?.setAttribute('stroke-dasharray', `${eigenPct} 100`);

    const moBreakdown = { base: [], it: [], ac: [], wp: [], bw: [], ev: [], toGrid: [], pvTotal: [], clip: [], toBat: [] };
    for (let m = 0; m < 12; m++) {
        let sumB = 0, sumI = 0, sumA = 0, sumW = 0, sumBw = 0, sumE = 0, sumTG = 0, sumPV = 0, sumC = 0, sumTB = 0;
        const end = m === 11 ? 8760 : MONTH_START_HOUR[m + 1];
        for (let h = MONTH_START_HOUR[m]; h < end; h++) {
            sumB += ConsumptionCache.base[h]; sumI += ConsumptionCache.it[h]; sumA += ConsumptionCache.ac[h];
            sumW += ConsumptionCache.wp[h]; sumBw += ConsumptionCache.bw[h]; sumE += ConsumptionCache.ev[h];
            sumTG += FlowCache.hr.toGrid[h]; sumPV += FlowCache.hr.pvTotal[h];
            sumC += FlowCache.hr.clip[h]; sumTB += FlowCache.hr.toBat[h];
        }
        moBreakdown.base.push(sumB / 1000); moBreakdown.it.push(sumI / 1000); moBreakdown.ac.push(sumA / 1000);
        moBreakdown.wp.push(sumW / 1000); moBreakdown.bw.push(sumBw / 1000); moBreakdown.ev.push(sumE / 1000);
        moBreakdown.toGrid.push(sumTG / 1000); moBreakdown.pvTotal.push(sumPV / 1000);
        moBreakdown.clip.push(sumC / 1000); moBreakdown.toBat.push(sumTB / 1000);
    }

    makeChart('autarkyConsChart', stackedBarConfig(MONTHS_SHORT, [
        { label: 'Einspeisung', data: moBreakdown.toGrid, backgroundColor: '#f59e0b', stack: '0' },
        { label: 'Bat-Ladung', data: moBreakdown.toBat, backgroundColor: '#10b981', stack: '0' },
        { label: 'E-Auto', data: moBreakdown.ev, backgroundColor: '#84cc16', stack: '0' },
        { label: 'Klima', data: moBreakdown.ac, backgroundColor: '#0ea5e9', stack: '0' },
        { label: 'Wärmepumpe', data: moBreakdown.wp, backgroundColor: '#ef4444', stack: '0' },
        { label: 'BWWP', data: moBreakdown.bw, backgroundColor: '#f43f5e', stack: '0' },
        { label: 'IT/Server', data: moBreakdown.it, backgroundColor: '#3b82f6', stack: '0' },
        { label: 'Grundlast', data: moBreakdown.base, backgroundColor: '#94a3b8', stack: '0' }
    ], true));

    makeChart('autarkyGenChart', {
        type: 'bar',
        data: {
            labels: MONTHS_SHORT,
            datasets: [
                { label: 'PV Erzeugung', data: moBreakdown.pvTotal, borderColor: '#3b82f6', backgroundColor: 'transparent', type: 'line', borderWidth: 2, pointRadius: 2, tension: 0.3 },
                { label: 'PV Direkt', data: FlowCache.moGen, backgroundColor: '#3b82f6', stack: '0' },
                { label: 'Aus Batterie', data: FlowCache.moBat, backgroundColor: '#a855f7', stack: '0' },
                { label: 'Netzbezug', data: FlowCache.moFromGrid, backgroundColor: '#f43f5e', stack: '0' }
            ]
        },
        options: stackedBarConfig(MONTHS_SHORT, [], true).options
    });

    calculateFinances();
    if (currentDetailMonth !== null) updateDetailCharts(currentDetailMonth);
}

// ---------- 18. DETAIL-MONATE ----------
function changeDetailMonth(dir) {
    if (currentDetailMonth === null) currentDetailMonth = new Date().getMonth();
    let next = currentDetailMonth + dir;
    if (next < 0) next = 11;
    if (next > 11) next = 0;
    updateDetailCharts(next);
}

function updateDetailCharts(monthIdx) {
    currentDetailMonth = monthIdx;
    if (!FlowCache || !ConsumptionCache || typeof Chart === 'undefined') return;
    const mNameUI = $('detailMonthName');
    if (mNameUI) mNameUI.textContent = MONTHS_FULL[monthIdx];

    let startDay = 0;
    for (let i = 0; i < monthIdx; i++) startDay += DAYS_IN_MONTH[i];
    const labels = [], base = [], itL = [], ac = [], wp = [], bw = [], ev = [],
        toGrid = [], toBat = [], pvTotal = [], direct = [], fromBat = [], fromGrid = [];

    for (let d = 0; d < DAYS_IN_MONTH[monthIdx]; d++) {
        labels.push((d + 1) + '.');
        let sB = 0, sI = 0, sA = 0, sW = 0, sBw = 0, sE = 0, sTG = 0, sTB = 0, sPV = 0, sDir = 0, sFB = 0, sFG = 0;
        for (let h = 0; h < 24; h++) {
            const absH = (startDay + d) * 24 + h;
            sB += ConsumptionCache.base[absH]; sI += ConsumptionCache.it[absH]; sA += ConsumptionCache.ac[absH];
            sW += ConsumptionCache.wp[absH]; sBw += ConsumptionCache.bw[absH]; sE += ConsumptionCache.ev[absH];
            sTG += FlowCache.hr.toGrid[absH]; sTB += FlowCache.hr.toBat[absH]; sPV += FlowCache.hr.pvTotal[absH];
            sDir += FlowCache.hr.direct[absH]; sFB += FlowCache.hr.fromBat[absH]; sFG += FlowCache.hr.fromGrid[absH];
        }
        base.push(sB / 1000); itL.push(sI / 1000); ac.push(sA / 1000); wp.push(sW / 1000);
        bw.push(sBw / 1000); ev.push(sE / 1000); toGrid.push(sTG / 1000); toBat.push(sTB / 1000);
        pvTotal.push(sPV / 1000); direct.push(sDir / 1000); fromBat.push(sFB / 1000); fromGrid.push(sFG / 1000);
    }

    const dark = document.documentElement.classList.contains('dark');
    makeChart('detailConsChart', stackedBarConfig(labels, [
        { label: 'Einspeisung', data: toGrid, backgroundColor: '#f59e0b', stack: '0' },
        { label: 'Bat-Ladung', data: toBat, backgroundColor: '#10b981', stack: '0' },
        { label: 'E-Auto', data: ev, backgroundColor: '#84cc16', stack: '0' },
        { label: 'Klima', data: ac, backgroundColor: '#0ea5e9', stack: '0' },
        { label: 'WP', data: wp, backgroundColor: '#ef4444', stack: '0' },
        { label: 'BWWP', data: bw, backgroundColor: '#f43f5e', stack: '0' },
        { label: 'IT', data: itL, backgroundColor: '#3b82f6', stack: '0' },
        { label: 'Grundlast', data: base, backgroundColor: '#94a3b8', stack: '0' }
    ], dark));

    makeChart('detailGenChart', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'PV Erzeugung', data: pvTotal, borderColor: '#3b82f6', backgroundColor: 'transparent', type: 'line', borderWidth: 2, pointRadius: 1, tension: 0.2 },
                { label: 'PV Direkt', data: direct, backgroundColor: '#3b82f6', stack: '0' },
                { label: 'Aus Batterie', data: fromBat, backgroundColor: '#a855f7', stack: '0' },
                { label: 'Netzbezug', data: fromGrid, backgroundColor: '#f43f5e', stack: '0' }
            ]
        },
        options: stackedBarConfig(labels, [], dark).options
    });
}

// ---------- 19. EIGENE HARDWARE ----------
function toggleCustomDbForm() {
    $('customDbForm')?.classList.toggle('hidden');
}

function updateCustomDbFields() {
    const t = $('cdb_type')?.value || 'panel';
    ['panel', 'inv', 'bat'].forEach((x) => $(`cdb_fields_${x}`)?.classList.add('hidden'));
    $(`cdb_fields_${t}`)?.classList.remove('hidden');
}

function saveCustomDevice() {
    const t = $('cdb_type')?.value || 'panel';
    const name = $('cdb_name')?.value?.trim().slice(0, 80);
    if (!name) { toast('Bitte einen Namen eingeben.', 'warn'); return; }
    const num = (id, fb, min, max) => {
        const el = $(id);
        const n = el ? Number(el.value) : NaN;
        return Number.isFinite(n) ? clamp(n, min, max) : fb;
    };

    const userDB = sanitizeUserDB(readJsonStorage('pvpro_user_db', { panels: [], batteries: [], inverters: [] }));
    const newId = (Date.now() % 100000) + Math.floor(Math.random() * 100);

    if (t === 'panel') {
        userDB.panels.push({
            id: newId, name,
            pmax: num('cdb_pmax', 400, 1, 2000), voc: num('cdb_voc', 40, 1, 200),
            vmp: num('cdb_vmp', 30, 1, 200), isc: num('cdb_isc', 10, 0.1, 50), tempVoc: -0.25
        });
    } else if (t === 'inv') {
        const count = clampInt(num('cdb_mppts', 2, 1, 8), 1, 8);
        const mppts = [];
        for (let i = 1; i <= count; i++) mppts.push({ id: i, name: `MPPT ${i}`, maxIsc: 20, maxI: 15 });
        const startV = num('cdb_startv', 80, 1, 1500);
        userDB.inverters.push({
            id: newId, name,
            acMax: num('cdb_acmax', 5000, 100, 100000), startV,
            maxV: num('cdb_maxv', 1000, 10, 1500),
            minMppV: startV + 50, maxMppV: 800, batteryId: 1, mppts
        });
    } else if (t === 'bat') {
        userDB.batteries.push({
            id: newId, name,
            cap: num('cdb_cap', 5, 0.1, 500), power: num('cdb_power', 5000, 100, 100000), eff: 0.95
        });
    }

    writeJsonStorage('pvpro_user_db', userDB);
    toast('Gerät gespeichert – App lädt neu.', 'success');
    setTimeout(() => location.reload(), 600);
}

function updateInverterBattery(invId, batId) {
    const inv = flatInverters.find((x) => x.id === Number(invId));
    const bat = flatBatteries.find((x) => x.id === Number(batId));
    if (!inv || !bat) return;
    inv.batteryId = bat.id;
    persistBatMap();
    markDirty();
    toast(`"${inv.name}" nutzt jetzt "${bat.name}".`, 'success');
}

function bindDatabaseEvents() {
    const grid = $('wrCardGrid');
    if (!grid) return;
    grid.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-inv-bat]');
        if (!sel) return;
        const invId = Number(sel.dataset.invBat);
        if (Number.isFinite(invId)) updateInverterBattery(invId, sel.value);
    });
}

function renderDatabaseUI() {
    const batOptions = (sel) => buildModelOptions(DB.batteries, sel);

    const wrCard = $('wrCardGrid');
    if (wrCard) {
        wrCard.innerHTML = flatInverters.map((w) => `
            <div class="m3-card bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                <div>
                    <div class="flex items-center gap-2 mb-2">
                        <span class="material-symbols-rounded text-primary text-xl">settings_input_component</span>
                        <h4 class="font-bold text-slate-800 dark:text-slate-100 text-sm">${esc(w.name)}</h4>
                    </div>
                    <div class="flex flex-wrap gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-1 mb-4">
                        <span class="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-medium">AC Max: ${esc(String(w.acMax))}W</span>
                        <span class="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-medium">Start: ${esc(String(w.startV))}V</span>
                        <span class="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-medium">${(w.mppts || []).length}× MPPT</span>
                    </div>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Zugewiesene Batterie</label>
                    <select data-inv-bat="${w.id}" aria-label="Batterie für ${esc(w.name)}" class="w-full text-xs font-medium border-2 border-slate-200 dark:border-slate-700 dark:bg-slate-950 rounded-xl px-3 py-2 cursor-pointer outline-none focus:border-primary">${batOptions(w.batteryId)}</select>
                </div>
            </div>`).join('');
    }

    const pCard = $('panelCardGrid');
    if (pCard) {
        pCard.innerHTML = flatPanels.map((p) => `
            <div class="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center shadow-sm">
                <div>
                    <h4 class="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-1.5"><span class="material-symbols-rounded text-sm text-primary">solar_power</span> ${esc(p.name)}</h4>
                    <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Voc: ${esc(String(p.voc))}V | Vmp: ${Number(p.vmp)?.toFixed(1)}V | Isc: ${esc(String(p.isc))}A</p>
                </div>
                <div class="text-right"><span class="text-xs font-black text-primary">${esc(String(p.pmax))} W</span></div>
            </div>`).join('');
    }

    const bCard = $('batCardGrid');
    if (bCard) {
        bCard.innerHTML = flatBatteries.map((b) => `
            <div class="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex justify-between items-center shadow-sm">
                <div>
                    <h4 class="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-1.5"><span class="material-symbols-rounded text-sm text-accent">battery_charging_full</span> ${esc(b.name)}</h4>
                    <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Max. P: ${esc(String(b.power))}W | Eff: ${Math.round((Number(b.eff) || 1) * 100)}%</p>
                </div>
                <div class="text-right"><span class="text-xs font-black text-accent">${Number(b.cap).toFixed(2)} kWh</span></div>
            </div>`).join('');
    }
}

// ---------- 20. SYNTHETISCHER OFFLINE-FALLBACK ----------
function generateSyntheticPVGISData(lat, tilt, azimuth, peakPower) {
    const hourly = [];
    const monthlyPeakW = [15, 30, 60, 95, 120, 130, 125, 105, 75, 45, 20, 10];
    const aspect = azimuth - 180;
    const azLoss = 1 - (Math.abs(aspect) / 180) * 0.25;
    const tiltLoss = 1 - (Math.abs(tilt - 35) / 90) * 0.15;

    for (let h = 0; h < 8760; h++) {
        const d = Math.floor(h / 24);
        const hr = h % 24;
        let accum = 0, monthIdx = 0;
        for (let m = 0; m < 12; m++) {
            accum += DAYS_IN_MONTH[m];
            if (d < accum) { monthIdx = m; break; }
        }
        let sunPower = 0;
        if (hr >= 6 && hr <= 18) {
            const sine = Math.sin((hr - 6) * Math.PI / 12);
            let noise = 0.6 + 0.4 * Math.sin(d * 13.5) * Math.cos(d * 5.2);
            noise = clamp(noise, 0.1, 1.0);
            sunPower = (peakPower * 1000) * (monthlyPeakW[monthIdx] / 150) * sine * azLoss * tiltLoss * noise;
        }
        hourly.push({ P: Math.max(0, sunPower) });
    }
    return hourly;
}

// ---------- 21. THEME ----------
function loadThemeSettings() {
    const theme = getThemeSettings();
    const pInput = $('themePrimaryColor');
    const aInput = $('themeAccentColor');
    if (pInput) pInput.value = theme.primary;
    if (aInput) aInput.value = theme.accent;
    applyTheme(theme.primary, theme.accent, theme.dark);
}

function toggleThemePanel() {
    $('themeSettingsPanel')?.classList.toggle('hidden');
}

function applyTheme(primary, accent, dark) {
    if (isHexColor(primary)) {
        document.documentElement.style.setProperty('--color-primary', primary);
        document.documentElement.style.setProperty('--color-primary-hover', adjustColorBrightness(primary, -15));
    }
    if (isHexColor(accent)) {
        document.documentElement.style.setProperty('--color-accent', accent);
        document.documentElement.style.setProperty('--color-accent-hover', adjustColorBrightness(accent, -15));
    }
    document.documentElement.classList.toggle('dark', dark === true);
    const btn = $('btnThemeDarkMode');
    if (btn) btn.textContent = dark ? 'Ausschalten' : 'Aktivieren';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#020617' : '#0f172a');

    if (typeof Chart !== 'undefined') {
        Chart.defaults.color = dark ? '#cbd5e1' : '#475569';
        Chart.defaults.borderColor = dark ? '#334155' : '#e2e8f0';
        Object.values(ChartRegistry).forEach((c) => { try { c.update(); } catch (e) { /* Chart wird neu gebaut */ } });
    }
}

function previewThemeColors(primary, accent) {
    const theme = getThemeSettings();
    applyTheme(isHexColor(primary) ? primary : theme.primary, isHexColor(accent) ? accent : theme.accent, theme.dark);
}

function updateThemeColors(primary, accent) {
    const theme = getThemeSettings();
    if (isHexColor(primary)) theme.primary = primary;
    if (isHexColor(accent)) theme.accent = accent;
    writeJsonStorage('pvpro_theme', theme);
    applyTheme(theme.primary, theme.accent, theme.dark);
}

function toggleDarkMode() {
    const theme = getThemeSettings();
    theme.dark = !theme.dark;
    writeJsonStorage('pvpro_theme', theme);
    applyTheme(theme.primary, theme.accent, theme.dark);
}

function adjustColorBrightness(hex, percent) {
    if (!isHexColor(hex)) return hex;
    const num = parseInt(hex.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const r = clamp((num >> 16) + amt, 0, 255);
    const g = clamp(((num >> 8) & 0xff) + amt, 0, 255);
    const b = clamp((num & 0xff) + amt, 0, 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ---------- 22. ONLINE-STATUS ----------
function updateOnlineBadge() {
    const badgeEl = $('offlineBadge');
    if (!badgeEl) return;
    badgeEl.classList.toggle('hidden', navigator.onLine);
}

// ---------- 23. PWA ----------
let deferredPrompt = null;

function initPwa() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then((reg) => console.log('PVPro Service Worker registriert:', reg.scope))
                .catch((err) => console.warn('PVPro Service Worker Registrierung fehlgeschlagen:', err));
        });
    }
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        $('btnPwaInstall')?.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        $('btnPwaInstall')?.classList.add('hidden');
        toast('PVPro wurde installiert.', 'success');
    });
}

function installPwaApp() {
    if (!deferredPrompt) { toast('Installation wird von diesem Browser gerade nicht angeboten.', 'warn'); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
        deferredPrompt = null;
        $('btnPwaInstall')?.classList.add('hidden');
    });
}

// ---------- 24. START ----------
document.addEventListener('DOMContentLoaded', () => { initApp(); initPwa(); });
