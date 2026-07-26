// ==========================================
// GLOBALE STATE VARIABLEN
// ==========================================
let flatPanels = [], flatInverters = [], flatBatteries = [];
const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#84cc16'];
let LocationData = { lat: 48.06, lon: 8.46, name: "Villingen-Schwenningen" };
let YieldDataCache = null, ConsumptionCache = null, FlowCache = null, activeGroupIndex = null;
let strings = [], currentDetailMonth = null;
let chartYield = null, chartAutarkyCons = null, chartAutarkyGen = null, detailConsChart = null, detailGenChart = null;

// ==========================================
// 1. INITIALISIERUNG
// ==========================================
function initDatabase() {
    try {
        // MasterDB kommt aus database.js
        try {
            const userDB = JSON.parse(localStorage.getItem('pvpro_user_db')) || { panels: [], batteries: [], inverters: [] };
            if (userDB.panels.length > 0) MasterDB.panels.push({ series: "Eigene Module", models: userDB.panels });
            if (userDB.inverters.length > 0) MasterDB.inverters.push({ series: "Eigene WR", models: userDB.inverters });
            if (userDB.batteries.length > 0) MasterDB.batteries.push({ series: "Eigene Batterien", models: userDB.batteries });
        } catch(e) {}

        flatPanels = MasterDB.panels.flatMap(s => s.models || []); 
        flatInverters = MasterDB.inverters.flatMap(s => s.models || []); 
        flatBatteries = MasterDB.batteries.flatMap(s => s.models || []);

        let batMap = JSON.parse(localStorage.getItem('pvpro_batmap') || '{}');
        flatInverters.forEach(inv => { if(batMap[inv.id] !== undefined) inv.batteryId = parseInt(batMap[inv.id]); });

        if(localStorage.getItem('pvpro_strings')) {
            try {
                let loaded = JSON.parse(localStorage.getItem('pvpro_strings'));
                strings = loaded.map(s => { if(!s.fields) s.fields = [{ id: Date.now()+Math.random(), panelId: flatPanels[0]?.id||1, count: s.panels||1, tilt: 30 }]; return s; });
            } catch(e) { strings = []; }
        }
        
        if(localStorage.getItem('pvpro_loc')) LocationData = JSON.parse(localStorage.getItem('pvpro_loc'));
        
        let locInp = document.getElementById('locSearchInput'); if(locInp) locInp.value = LocationData.name;
        let locTxt = document.getElementById('locNameText'); if(locTxt) locTxt.innerText = LocationData.name;
        
        // Handbuch laden (aus content.js)
        let faqTab = document.getElementById('tab-faq');
        if(faqTab && typeof HandbuchHTML !== 'undefined') faqTab.innerHTML = HandbuchHTML;

        loadConsumptionSettings(); 
        loadFinanceSettings();
        updatePhysicsOnly();
    } catch(e) { console.error("Init Error:", e); }
}

function clearLocalStorage() {
    if(confirm("Willst du wirklich alle gespeicherten Strings und Einstellungen löschen?")) {
        localStorage.clear();
        location.reload();
    }
}

function saveConfiguration() { 
    localStorage.setItem('pvpro_strings', JSON.stringify(strings)); 
    localStorage.setItem('pvpro_loc', JSON.stringify(LocationData)); 
    saveConsumptionSettings();
    
    let btn = document.getElementById('btnHeaderSave');
    if(btn) {
        btn.classList.remove('bg-amber-500', 'animate-pulse');
        btn.classList.add('bg-blue-600');
    }
    alert("Erfolgreich gespeichert!"); 
}

// ==========================================
// 2. UI TAB ROUTING & SWIPE GESTURES
// ==========================================
const tabOrder = ['system', 'verbrauch', 'finance', 'uebersicht', 'auswertung', 'database', 'faq'];
let touchStartX = 0, touchStartY = 0;

document.addEventListener('touchstart', e => { 
    touchStartX = e.touches[0].clientX; 
    touchStartY = e.touches[0].clientY; 
}, {passive:true});

document.addEventListener('touchend', e => {
    let t = e.target.nodeType === 3 ? e.target.parentNode : e.target;
    if (t.closest('input') || t.closest('select') || t.closest('button') || t.closest('canvas') || t.closest('.overflow-x-auto') || t.closest('a')) return;
    
    let touchEndX = e.changedTouches[0].clientX;
    let touchEndY = e.changedTouches[0].clientY;
    let diffX = touchEndX - touchStartX;
    let diffY = touchEndY - touchStartY;
    
    if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY) * 1.8) {
        let current = document.querySelector('.tab-content.active');
        if(!current) return;
        let cIdx = tabOrder.indexOf(current.id.replace('tab-', ''));
        if(cIdx !== -1) {
            if(diffX < 0 && cIdx < tabOrder.length-1) switchTab(tabOrder[cIdx+1]); 
            else if(diffX > 0 && cIdx > 0) switchTab(tabOrder[cIdx-1]);
        }
    }
}, {passive:true});

function switchTab(tabId) {
    const current = document.querySelector('.tab-content.active');
    if(current) current.classList.remove('active');
    
    const target = document.getElementById('tab-' + tabId);
    if(target) target.classList.add('active');
    
    tabOrder.forEach(id => {
        let btn = document.getElementById('btn-' + id);
        if(btn) {
            btn.className = (id === tabId) 
                ? "snap-start shrink-0 px-4 py-2 text-sm font-bold rounded-xl bg-blue-600 text-white shadow-md transition-colors" 
                : "snap-start shrink-0 px-4 py-2 text-sm font-medium rounded-md text-slate-300 hover:bg-slate-700 transition-colors";
            if(id==='auswertung' && id!==tabId) btn.classList.add('text-emerald-400');
        }
    });
    
    let btn = document.getElementById('btn-'+tabId);
    let scroller = document.getElementById('navScroller');
    if(btn && scroller) {
        try { scroller.scrollTo({left: btn.offsetLeft - window.innerWidth/2 + 50, behavior:'smooth'}); } 
        catch(e) { scroller.scrollLeft = btn.offsetLeft - window.innerWidth/2 + 50; }
    }
    if(tabId === 'auswertung' && currentDetailMonth !== null) updateDetailCharts(currentDetailMonth);
}

function toggleAcc(id) { 
    const el = document.getElementById(id); 
    if(el.classList.contains('open')) el.classList.remove('open'); 
    else { document.querySelectorAll('.acc-content').forEach(e=>e.classList.remove('open')); el.classList.add('open'); }
}

// ==========================================
// 3. STRINGS, PHYSIK & UI
// ==========================================
function addString() { 
    strings.push({ id: Date.now(), name: "Neuer String", group: "", shading: 0, azimuth: 180, inverterId: flatInverters[0]?.id || 1, mpptId: 1, color: colors[strings.length % colors.length], fields: [{ id: Date.now()+1, panelId: flatPanels[0]?.id || 1, count: 5, tilt: 30 }] }); 
    updatePhysicsOnly(); 
}
function removeString(id) { strings = strings.filter(s => s.id !== id); updatePhysicsOnly(); }
function addField(id) { strings.find(s => s.id === id)?.fields.push({ id: Date.now(), panelId: flatPanels[0]?.id || 1, count: 1, tilt: 30 }); updatePhysicsOnly(); }
function removeField(sId, fId) { const str = strings.find(s => s.id === sId); if(str) str.fields = str.fields.filter(f => f.id !== fId); updatePhysicsOnly(); }

function toggleEditMode(strId) {
    const el = document.getElementById('edit-' + strId);
    if(el) el.classList.toggle('hidden');
}

function updateStringData(id, key, val) { 
    const str = strings.find(s => s.id === id); 
    if(str) { 
        if (['name', 'group', 'color'].includes(key)) str[key] = val; else str[key] = Number(val);
        if(key === 'inverterId') str.mpptId = 1; 
        updatePhysicsOnly(); 
        document.getElementById('edit-' + id).classList.remove('hidden');
    } 
}

function updateFieldData(sId, fId, key, val) { 
    const str = strings.find(s => s.id === sId); 
    if(str) { 
        const f = str.fields.find(f => f.id === fId); if(f) f[key] = Number(val); 
        updatePhysicsOnly(); 
        document.getElementById('edit-' + sId).classList.remove('hidden');
    } 
}

function updatePhysicsOnly() {
    strings.forEach(str => {
        let vocStc = 0, vmpStc = 0, isc = 0, tk = -0.25;
        if(str.fields && str.fields.length > 0) { const p = flatPanels.find(p => p.id === parseInt(str.fields[0].panelId)); if(p) tk = p.tempVoc; }
        
        (str.fields || []).forEach(f => {
            const p = flatPanels.find(x => x.id === parseInt(f.panelId));
            if(p) { vocStc += (p.voc * f.count); vmpStc += (p.vmp * f.count); isc = Math.max(isc, p.isc); }
        });

        const inv = flatInverters.find(i => i.id === parseInt(str.inverterId));
        let existingMismatch = (str._phys && str._phys.mismatchPct) ? str._phys.mismatchPct : 0;
        
        str._phys = { 
            vocCold: vocStc * (1 + (-45) * (tk / 100)), 
            vmpHot: vmpStc * (1 + (45) * (tk / 100)), 
            isc: isc, 
            limitMaxV: inv?.maxV || 1000, 
            limitMaxI: inv?.mppts?.find(m => m.id == str.mpptId)?.maxIsc || 20, 
            minMppV: inv?.minMppV || 0, 
            maxMppV: inv?.maxMppV || 0, 
            invStartV: inv?.startV || 0,
            mismatchPct: existingMismatch
        };
        str._phys.isVocSafe = str._phys.vocCold <= str._phys.limitMaxV; 
        str._phys.isIscSafe = isc <= str._phys.limitMaxI;
    });
    let btn = document.getElementById('btnHeaderSave');
    if(btn) { btn.classList.remove('bg-blue-600'); btn.classList.add('animate-pulse', 'bg-amber-500'); }
    renderStringsUI(); 
    renderDatabaseUI();
}

function renderStringsUI() {
    const container = document.getElementById('stringsList');
    let emptyMsg = document.getElementById('emptyStringMessage');
    
    if(strings.length === 0) {
        container.innerHTML = '';
        if(emptyMsg) emptyMsg.classList.remove('hidden');
        return;
    }
    if(emptyMsg) emptyMsg.classList.add('hidden');

    let panelOptions = MasterDB.panels.map(s => `<optgroup label="${s.series}">${(s.models||[]).map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</optgroup>`).join('');
    let invOptions = MasterDB.inverters.map(s => `<optgroup label="${s.series}">${(s.models||[]).map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</optgroup>`).join('');

    container.innerHTML = strings.map(str => {
        const p = str._phys || { isVocSafe: true, isIscSafe: true, vocCold: 0, vmpHot: 0, isc: 0, limitMaxV: 1000, limitMaxI: 20, minMppV: 0, maxMppV: 0, invStartV: 0, mismatchPct: 0 };
        const inv = flatInverters.find(i => i.id === parseInt(str.inverterId)) || {name: 'Kein WR', mppts: []};
        let wOpt = invOptions.replace(`value="${str.inverterId}"`, `value="${str.inverterId}" selected`);
        let mOpt = (inv.mppts || []).map(m => `<option value="${m.id}" ${str.mpptId == m.id ? 'selected':''}>${m.name}</option>`).join('');
        
        const safe = p.isVocSafe && p.isIscSafe;
        let vmpColor = 'bg-amber-400', vmpText = 'text-amber-500';
        let vmpBadge = '🟠';
        if (p.vmpHot >= p.minMppV && p.vmpHot <= p.maxMppV) { vmpColor = 'bg-emerald-500'; vmpText = 'text-emerald-500'; vmpBadge = '🟢'; }
        else if (p.vmpHot < p.invStartV) { vmpColor = 'bg-rose-500'; vmpText = 'text-rose-500'; vmpBadge = '🔴'; }

        let uocBadge = p.isVocSafe ? '🟢' : '🔴';
        let iscBadge = p.isIscSafe ? '🟢' : '🔴';
        let mismatchInfo = (p.mismatchPct > 0) ? `<span class="text-rose-500 font-bold ml-2">Mismatch: -${p.mismatchPct.toFixed(1)}% 🔴</span>` : '';

        let modTotal = (str.fields || []).reduce((sum, f) => sum + Number(f.count), 0);
        let mpptName = (inv.mppts || []).find(m=>m.id==str.mpptId)?.name || 'MPPT';

        return `
        <div class="bg-white border-2 ${safe ? 'border-slate-100' : 'border-rose-400'} rounded-xl shadow-sm mb-3">
            <!-- Übersichtskarte (Kompakt) -->
            <div class="p-3 bg-white rounded-xl">
                <div class="flex justify-between items-center mb-2">
                    <div class="flex items-center gap-3">
                        <div class="w-2 h-8 rounded-full shrink-0" style="background-color: ${str.color}"></div>
                        <div class="flex flex-col">
                            <h4 class="font-bold text-sm text-slate-800 leading-none">${str.name} <span class="font-normal text-xs text-slate-400 ml-1">| ${modTotal}x Modul an ${inv.name}</span></h4>
                        </div>
                    </div>
                    <button onclick="toggleEditMode(${str.id})" class="bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-600 border border-slate-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-sm shrink-0">
                        ✏️ <span class="hidden md:inline">Edit</span>
                    </button>
                </div>
                <div class="bg-slate-800 text-slate-300 text-[10px] md:text-xs rounded-lg px-3 py-1.5 flex items-center shadow-inner">
                    <span>Uoc: ${p.vocCold.toFixed(0)}V ${uocBadge}</span> <span class="mx-2 text-slate-600">|</span> 
                    <span>Umpp: ${p.vmpHot.toFixed(0)}V ${vmpBadge}</span> <span class="mx-2 text-slate-600">|</span> 
                    <span>Isc: ${p.isc.toFixed(1)}A ${iscBadge}</span>
                    ${mismatchInfo}
                </div>
            </div>

            <!-- Edit Bereich -->
            <div id="edit-${str.id}" class="hidden p-4 bg-slate-50 border-t border-slate-200 rounded-b-xl space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div><label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Name</label><input type="text" value="${str.name}" onchange="updateStringData(${str.id}, 'name', this.value)" class="w-full border-2 rounded-lg px-2 py-1.5 text-sm outline-none"></div>
                    <div><label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Gruppe</label><input type="text" value="${str.group || ''}" onchange="updateStringData(${str.id}, 'group', this.value)" class="w-full border-2 rounded-lg px-2 py-1.5 text-sm outline-none"></div>
                    <div><label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Azimut (°)</label><input type="number" value="${str.azimuth}" onchange="updateStringData(${str.id}, 'azimuth', this.value)" class="w-full border-2 rounded-lg px-2 py-1.5 text-sm outline-none"></div>
                    <div><label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">WR Zuweisung</label><select onchange="updateStringData(${str.id}, 'inverterId', this.value)" class="w-full border-2 rounded-lg px-2 py-1.5 text-sm outline-none">${wOpt}</select></div>
                    <div><label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">MPPT</label><select onchange="updateStringData(${str.id}, 'mpptId', this.value)" class="w-full border-2 rounded-lg px-2 py-1.5 text-sm outline-none">${mOpt}</select></div>
                </div>
                
                <div>
                    <div class="flex justify-between items-center mb-1">
                        <label class="block text-[10px] text-slate-500 font-bold uppercase">Schatten (Pauschaler Verlust)</label>
                        <span class="text-xs font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded">${str.shading || 0}%</span>
                    </div>
                    <input type="range" min="0" max="80" step="1" value="${str.shading || 0}" onchange="updateStringData(${str.id}, 'shading', this.value)" oninput="this.previousElementSibling.querySelector('span').innerText = this.value + '%'" class="w-full">
                </div>

                <div class="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div class="bg-slate-100 px-3 py-2 border-b border-slate-200 flex justify-between items-center">
                        <span class="text-[10px] font-bold text-slate-700 uppercase">Modulfelder</span>
                        <button onclick="addField(${str.id})" class="text-blue-600 bg-blue-50 font-bold text-[10px] px-2 py-1 rounded">+ Feld</button>
                    </div>
                    <div class="p-3 space-y-2">
                        ${(str.fields || []).map(f => {
                            let currPOpt = panelOptions.replace(`value="${f.panelId}"`, `value="${f.panelId}" selected`);
                            return `
                            <div class="flex flex-col md:flex-row items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <select onchange="updateFieldData(${str.id}, ${f.id}, 'panelId', this.value)" class="w-full md:flex-1 border rounded px-2 py-1 outline-none text-xs font-medium">${currPOpt}</select>
                                <div class="flex w-full md:w-auto justify-between gap-2">
                                    <div class="flex items-center"><input type="number" value="${f.count}" onchange="updateFieldData(${str.id}, ${f.id}, 'count', this.value)" class="w-12 border rounded px-1 py-1 outline-none font-bold text-center text-xs"><span class="text-[9px] font-bold text-slate-500 uppercase ml-1">Stk</span></div>
                                    <div class="flex items-center"><input type="number" value="${f.tilt}" onchange="updateFieldData(${str.id}, ${f.id}, 'tilt', this.value)" class="w-12 border rounded px-1 py-1 outline-none font-bold text-center text-xs"><span class="text-[9px] font-bold text-slate-500 uppercase ml-1">° Neig</span></div>
                                    <button onclick="removeField(${str.id}, ${f.id})" class="text-rose-500 bg-rose-100 p-1.5 rounded"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                                </div>
                            </div>`
                        }).join('')}
                    </div>
                </div>
                
                <div class="flex items-center justify-between pt-2">
                    <input type="color" value="${str.color}" onchange="updateStringData(${str.id}, 'color', this.value)" class="shrink-0 border-none">
                    <button onclick="removeString(${str.id})" class="text-[10px] font-bold text-rose-500 bg-rose-500/10 px-3 py-1.5 rounded hover:bg-rose-500/20 transition-colors">String Löschen</button>
                </div>

                <div class="text-center pt-4 border-t border-slate-200 mt-2">
                    <button onclick="toggleEditMode(${str.id})" class="bg-slate-800 hover:bg-slate-700 text-white font-bold px-6 py-2 rounded-lg shadow-md w-full md:w-auto text-sm">💾 Speichern & Schließen</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// 4. VERBRAUCHS-LOGIK
// ==========================================
function updateHouseHint() {
    let val = parseInt(document.getElementById('cons_base_kwh').value) || 0;
    let hint = "1-Person";
    if (val >= 2000) hint = "2-Personen";
    if (val >= 3000) hint = "3-Personen";
    if (val >= 4000) hint = "4-Personen";
    if (val >= 5000) hint = "5+ Personen";
    let hEl = document.getElementById('cons_house_hint');
    if(hEl) hEl.innerText = hint + "-Haushalt";
}

function getConsumptionConfig() {
    let baseInp = parseInt(document.getElementById('cons_base_kwh').value) || 3500;
    let h = parseInt(document.getElementById('cons_house').value) || 0;
    return {
        baseKwh: baseInp + h,
        it: document.getElementById('cons_it_active').checked ? (parseFloat(document.getElementById('cons_it_w').value) || 0) : 0,
        ac: document.getElementById('cons_ac_active').checked ? (parseFloat(document.getElementById('cons_ac_kwh').value) || 0) : 0,
        wp: document.getElementById('cons_wp_active').checked ? (parseFloat(document.getElementById('cons_wp_kwh').value) || 0) : 0,
        bw: document.getElementById('cons_bw_active').checked ? (parseFloat(document.getElementById('cons_bw_kwh').value) || 0) : 0,
        bwSmart: document.getElementById('cons_bw_smart').checked,
        ev: document.getElementById('cons_ev_active').checked ? ((parseFloat(document.getElementById('cons_ev_km').value)||0)/100) * (parseFloat(document.getElementById('cons_ev_kwh100').value)||0) : 0,
        evSmart: document.getElementById('cons_ev_smart').checked
    };
}

function toggleConsGroup(id) { document.getElementById(`grp_${id}`).classList.toggle('hidden', !document.getElementById(`cons_${id}_active`).checked); updateConsumptionEstimate(); }

function updateConsumptionEstimate() { 
    let c=getConsumptionConfig(); 
    let el = document.getElementById('lbl_total_kwh_est');
    if(el) el.innerText = Math.round(c.baseKwh+(c.it*8.76)+c.ac+c.wp+c.bw+c.ev).toLocaleString(); 
}

function saveConsumptionSettings() { 
    let c=getConsumptionConfig(); 
    c.baseInp = document.getElementById('cons_base_kwh').value; 
    c.house = document.getElementById('cons_house').value; 
    localStorage.setItem('pvpro_cons', JSON.stringify(c)); 
}

function loadConsumptionSettings() {
    let c = JSON.parse(localStorage.getItem('pvpro_cons')); if(!c) return;
    let bInp = document.getElementById('cons_base_kwh'); if(bInp) bInp.value = c.baseInp || 3500; 
    updateHouseHint();
    let hInp = document.getElementById('cons_house'); if(hInp) hInp.value = c.house || 0;
    
    if(c.it>0) { let cb = document.getElementById('cons_it_active'); if(cb){cb.checked=true; document.getElementById('cons_it_w').value=c.it; toggleConsGroup('it');} }
    if(c.ac>0) { let cb = document.getElementById('cons_ac_active'); if(cb){cb.checked=true; document.getElementById('cons_ac_kwh').value=c.ac; toggleConsGroup('ac');} }
    if(c.wp>0) { let cb = document.getElementById('cons_wp_active'); if(cb){cb.checked=true; document.getElementById('cons_wp_kwh').value=c.wp; toggleConsGroup('wp');} }
    if(c.bw>0) { let cb = document.getElementById('cons_bw_active'); if(cb){cb.checked=true; document.getElementById('cons_bw_kwh').value=c.bw; document.getElementById('cons_bw_smart').checked=c.bwSmart; toggleConsGroup('bw');} }
    if(c.ev>0) { let cb = document.getElementById('cons_ev_active'); if(cb){cb.checked=true; document.getElementById('cons_ev_km').value=(c.ev/18)*100; document.getElementById('cons_ev_smart').checked=c.evSmart; toggleConsGroup('ev');} }
    updateConsumptionEstimate();
}

function build8760ConsumptionArray(pvProfile = null) {
    let c = getConsumptionConfig(); let out = { total: new Float32Array(8760), base: new Float32Array(8760), it: new Float32Array(8760), ac: new Float32Array(8760), wp: new Float32Array(8760), bw: new Float32Array(8760), ev: new Float32Array(8760) };
    let smartEvHours = new Set(), smartBwHours = new Set();
    if(pvProfile) {
        if(c.ev>0 && c.evSmart) { for(let w=0; w<52; w++) { let hrs=[]; for(let h=w*168; h<w*168+168; h++) { if(h%24>=8 && h%24<=18) hrs.push({h, pv:pvProfile[h]}); } hrs.sort((a,b)=>b.pv-a.pv).slice(0,14).forEach(x=>smartEvHours.add(x.h)); } }
        if(c.bw>0 && c.bwSmart) { for(let d=0; d<365; d++) { let hrs=[]; for(let h=d*24; h<d*24+24; h++) { if(h%24>=9 && h%24<=16) hrs.push({h, pv:pvProfile[h]}); } hrs.sort((a,b)=>b.pv-a.pv).slice(0,4).forEach(x=>smartBwHours.add(x.h)); } }
    }
    for(let h=0; h<8760; h++) {
        let d=Math.floor(h/24), hr=h%24;
        out.base[h] = (c.baseKwh*1000/8760)*(1+0.3*Math.cos((d-15)*2*Math.PI/365))*(hr>=18&&hr<=22 ? 1.5 : (hr>=10&&hr<=17 ? 0.8 : 1.0));
        out.it[h] = c.it;
        if(c.ac>0 && d>=120 && d<=270 && hr>=12 && hr<=18) out.ac[h] = (c.ac*1000)/(150*7);
        if(c.wp>0 && (d<120 || d>270)) out.wp[h] = (c.wp*1000/(215*24))*(1+0.5*Math.cos((d-15)*2*Math.PI/365));
        if(c.bw>0) { if(c.bwSmart && pvProfile) { if(smartBwHours.has(h)) out.bw[h]=(c.bw*1000/365)/4; } else if(hr>=18&&hr<=21) out.bw[h]=(c.bw*1000/365)/4; }
        if(c.ev>0) { if(c.evSmart && pvProfile) { if(smartEvHours.has(h)) out.ev[h]=(c.ev*1000/52)/14; } else if(hr>=18&&hr<=23) out.ev[h]=(c.ev*1000/365)/6; }
        out.total[h] = out.base[h]+out.it[h]+out.ac[h]+out.wp[h]+out.bw[h]+out.ev[h];
    }
    
    ConsumptionCache = out; 
    return out;
}

// ==========================================
// 5. FINANZEN & BERECHNUNG (ROI)
// ==========================================
function loadFinanceSettings() {
    let s = JSON.parse(localStorage.getItem('pvpro_finance') || '{}');
    let gP = document.getElementById('fin_grid_price'); if(gP) gP.value = s.grid || 0.32;
    let sC = document.getElementById('fin_sys_cost'); if(sC) sC.value = s.cost || 15000;
    let eD = document.getElementById('fin_eeg_date'); if(eD) eD.value = s.date || "2024-05";
    let gaP = document.getElementById('fin_gas_price'); if(gaP) gaP.value = s.gas || 1.10;
    let wJ = document.getElementById('fin_wp_jaz'); if(wJ) wJ.value = s.jaz || 3.5;
    let pP = document.getElementById('fin_petrol_price'); if(pP) pP.value = s.petrol || 1.75;
    let iC = document.getElementById('fin_ice_cons'); if(iC) iC.value = s.ice || 7.0;
    updateEEGPreview();
}

function updateEEGPreview() {
    let totalKwp = YieldDataCache ? YieldDataCache.reduce((a,b)=>a+b.kwp, 0) : 0;
    if(totalKwp === 0) totalKwp = 1; 
    
    let dateEl = document.getElementById('fin_eeg_date');
    if(!dateEl) return 0;
    let dateStr = dateEl.value; 
    let year = parseInt(dateStr.split('-')[0]), month = parseInt(dateStr.split('-')[1]);
    
    let finalEeg = 0;
    let preEl = document.getElementById('lbl_eeg_rate_pre');
    
    if (year >= 2027) {
        if(preEl) preEl.innerText = "0.00";
    } else {
        let monthsSinceFeb24 = (year - 2024) * 12 + (month - 2);
        let periods = monthsSinceFeb24 > 0 ? Math.floor(monthsSinceFeb24 / 6) : 0;
        let degression = Math.pow(0.99, periods);
        let baseEeg = totalKwp <= 10 ? 8.20 : ((10 * 8.20) + ((totalKwp - 10) * 7.10)) / totalKwp;
        finalEeg = baseEeg * degression;
        if(preEl) preEl.innerText = finalEeg.toFixed(2);
    }
    return finalEeg;
}

function calculateFinances() {
    let gridP = parseFloat(document.getElementById('fin_grid_price').value) || 0.32;
    let gasP = parseFloat(document.getElementById('fin_gas_price').value) || 1.10; 
    let petrolP = parseFloat(document.getElementById('fin_petrol_price').value) || 1.75;
    let iceCons = parseFloat(document.getElementById('fin_ice_cons').value) || 7.0;
    let jaz = parseFloat(document.getElementById('fin_wp_jaz').value) || 3.5;
    let sysCost = parseFloat(document.getElementById('fin_sys_cost').value) || 15000;

    localStorage.setItem('pvpro_finance', JSON.stringify({
        grid: gridP, cost: sysCost, date: document.getElementById('fin_eeg_date').value, 
        gas: gasP, jaz: jaz, petrol: petrolP, ice: iceCons
    }));

    let finalEeg = updateEEGPreview();
    let eegUi = document.getElementById('rep_b_eeg_rate');
    if(eegUi) eegUi.innerText = finalEeg.toFixed(2);

    if(!FlowCache) return;

    let c = getConsumptionConfig();
    
    let costA_grid = (c.baseKwh + (c.it * 8.76) + c.ac) * gridP;
    let costA_heat = (((c.wp + c.bw) * jaz) / 10) * gasP;
    let costA_car = (c.ev > 0) ? ((parseFloat(document.getElementById('cons_ev_km').value) || 0) / 100) * iceCons * petrolP : 0;
    let costA_total = costA_grid + costA_heat + costA_car;

    let costB_grid = FlowCache.fromGrid * gridP;
    let costB_rev = FlowCache.toGrid * (finalEeg / 100);
    let costB_total = costB_grid - costB_rev;

    let savings = costA_total - costB_total;
    let amort = savings > 0 ? (sysCost / savings).toFixed(1) : "∞";

    let rAGrid = document.getElementById('rep_a_grid'); if(rAGrid) rAGrid.innerText = "+ " + costA_grid.toFixed(2) + " €";
    let rACar = document.getElementById('rep_a_car'); if(rACar) rACar.innerText = "+ " + costA_car.toFixed(2) + " €";
    let rAHeat = document.getElementById('rep_a_heat'); if(rAHeat) rAHeat.innerText = "+ " + costA_heat.toFixed(2) + " €";
    let rATotal = document.getElementById('rep_a_total'); if(rATotal) rATotal.innerText = costA_total.toFixed(2) + " €";

    let rBGrid = document.getElementById('rep_b_grid'); if(rBGrid) rBGrid.innerText = "+ " + costB_grid.toFixed(2) + " €";
    let rBRev = document.getElementById('rep_b_rev'); if(rBRev) rBRev.innerText = "- " + costB_rev.toFixed(2) + " €";
    let rBTotal = document.getElementById('rep_b_total'); if(rBTotal) rBTotal.innerText = costB_total.toFixed(2) + " €";

    let rDiff = document.getElementById('rep_diff'); if(rDiff) rDiff.innerText = Math.round(savings).toLocaleString() + " €";
    let kpiSav = document.getElementById('kpi_savings'); if(kpiSav) kpiSav.innerText = Math.round(savings).toLocaleString() + " €";
    let kpiRoi = document.getElementById('kpi_roi'); if(kpiRoi) kpiRoi.innerText = amort;
}

// ==========================================
// 6. PVGIS API & ENGINE (5.2 Restore)
// ==========================================
async function searchLocation() { 
    const q = document.getElementById('locSearchInput').value; if(!q) return;
    try { const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`); const data = await res.json();
        if(data.length>0) { 
            LocationData = {lat:parseFloat(data[0].lat).toFixed(2), lon:parseFloat(data[0].lon).toFixed(2), name:data[0].display_name.split(',')[0]}; 
            let locTxt = document.getElementById('locNameText'); if(locTxt) locTxt.innerText=LocationData.name; 
            let editBox = document.getElementById('locEditBox'); if(editBox) editBox.classList.add('hidden');
        }
    } catch(e) {}
}

async function calculateYieldAPI() {
    const btn = document.getElementById('btnCalculateMain'); 
    const origTxt = btn ? btn.innerHTML : '';
    if(btn) { btn.innerHTML = '<svg class="w-6 h-6 spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="4" stroke-dasharray="30 30"></circle></svg><span>API Simulation läuft...</span>'; btn.disabled = true; }
    
    try {
        let proms = [];
        strings.forEach(str => {
            let shadingFactor = 1 - ((str.shading || 0) / 100);
            (str.fields || []).forEach(f => {
                const p = flatPanels.find(x=>x.id===parseInt(f.panelId));
                if(p && f.count>0) {
                    let asp = str.azimuth - 180; if (asp>180) asp-=360; if (asp<-180) asp+=360;
                    const u = `https://corsproxy.io/?${encodeURIComponent(`https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?lat=${LocationData.lat}&lon=${LocationData.lon}&usehorizon=1&pvcalculation=1&startyear=2019&endyear=2019&outputformat=json&angle=${f.tilt}&aspect=${asp}&peakpower=${((p.pmax*f.count)/1000).toFixed(3)}&loss=14`)}`;
                    proms.push(fetch(u).then(async r=>{if(!r.ok) throw new Error(await r.text()); return r.json();}).then(d=>({sId:str.id, fId:f.id, d:d.outputs.hourly, sF:shadingFactor, panel: p, count: f.count})));
                }
            });
        });

        const res = await Promise.all(proms);

        let invH = {}; 
        let activeInvIds = [...new Set(strings.map(s => parseInt(s.inverterId)))];
        let activeInvs = flatInverters.filter(i => activeInvIds.includes(i.id));
        activeInvs.forEach(i => invH[i.id] = new Float32Array(8760));

        let sRes = strings.map(s => ({ id: s.id, name: s.name, color: s.color, kwp: 0, yield: 0, clip: 0, batYield: 0, mo: new Array(12).fill(0), hr: new Float32Array(8760) }));
        const mStart = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016];

        let pvProfileRaw = new Float32Array(8760);

        let stringGroups = {};
        res.forEach(r => {
            if(!stringGroups[r.sId]) stringGroups[r.sId] = [];
            stringGroups[r.sId].push(r);
        });

        for(let sId in stringGroups) {
            let fields = stringGroups[sId];
            let str = strings.find(s=>s.id === parseInt(sId));
            let sr = sRes.find(s=>s.id === parseInt(sId));
            if(!str || !sr) continue;

            let idealYear = 0;
            let realYear = 0;

            for(let h=0; h<8760; h++) {
                let minCurrent = Infinity;
                let totalVmp = 0;
                let idealPower = 0;

                fields.forEach(f => {
                    let pDc = f.d[h].P * f.sF; 
                    idealPower += pDc;
                    let vmpField = f.panel.vmp * f.count;
                    totalVmp += vmpField;
                    let current = vmpField > 0 ? (pDc / vmpField) : 0;
                    if(current > f.panel.isc) current = f.panel.isc; 
                    if(current < minCurrent) minCurrent = current;
                });

                if(minCurrent === Infinity) minCurrent = 0;
                let realPower = minCurrent * totalVmp;
                
                idealYear += idealPower;
                realYear += realPower;

                sr.hr[h] += realPower;
                if(invH[str.inverterId]) { 
                    invH[str.inverterId][h] += realPower; 
                    pvProfileRaw[h] += realPower; 
                }
            }

            let mismatchPct = idealYear > 0 ? ((idealYear - realYear) / idealYear) * 100 : 0;
            if(!str._phys) str._phys = {};
            str._phys.mismatchPct = mismatchPct;
        }

        let consH = build8760ConsumptionArray(pvProfileRaw);
        const systemLossFactor = 0.95; 
        
        let flow = { 
            direct: 0, toBat: 0, fromBat: 0, toGrid: 0, fromGrid: 0, clip: 0, batLoss: 0,
            moCons: new Array(12).fill(0), moGen: new Array(12).fill(0), moBat: new Array(12).fill(0),
            hr: { pvTotal: new Float32Array(8760), direct: new Float32Array(8760), fromBat: new Float32Array(8760), toGrid: new Float32Array(8760), toBat: new Float32Array(8760), fromGrid: new Float32Array(8760), clip: new Float32Array(8760), batLoss: new Float32Array(8760) }
        };
        let batCharges = {}; activeInvs.forEach(inv => batCharges[inv.id] = 0);

        for(let h=0; h<8760; h++) {
            let sysAcAvailableW = 0, sysBatChargeW = 0, sysClipW = 0, loadW = consH.total[h] || 0, remainingLoad = loadW;

            activeInvs.forEach(inv => {
                let totalDcW = invH[inv.id][h] * systemLossFactor;
                let acLimit = inv.acMax || 0;
                let bat = flatBatteries.find(b => b.id == inv.batteryId);
                let batCapWh = bat ? (bat.cap * 1000) : 0;
                let batPowerW = bat ? bat.power : 0;
                
                let targetAcW = Math.min(acLimit, remainingLoad, totalDcW);
                remainingLoad -= targetAcW; sysAcAvailableW += targetAcW;
                let excessDc = totalDcW - targetAcW;
                
                if (excessDc > 0 && batCapWh > 0) {
                    let actualCharge = Math.min(excessDc, batPowerW, batCapWh - batCharges[inv.id]);
                    batCharges[inv.id] += actualCharge; excessDc -= actualCharge; sysBatChargeW += actualCharge;
                    if (actualCharge > 0) { sRes.filter(sr => strings.find(s=>s.id===sr.id)?.inverterId == inv.id).forEach(sr => { if(invH[inv.id][h]>0) sr.batYield += (actualCharge * (sr.hr[h]/invH[inv.id][h])) / 1000; }); }
                }
                
                if (excessDc > 0) { let feedInW = Math.min(excessDc, acLimit - targetAcW); sysAcAvailableW += feedInW; excessDc -= feedInW; }
                if (excessDc > 0) { sysClipW += excessDc; sRes.filter(sr => strings.find(s=>s.id===sr.id)?.inverterId == inv.id).forEach(sr => { if(invH[inv.id][h]>0) sr.clip += (excessDc * (sr.hr[h]/invH[inv.id][h])) / 1000; }); }
            });

            let m = 0; for(let i=11; i>=0; i--) { if(h >= mStart[i]) { m = i; break; } }
            flow.moCons[m] += loadW / 1000; flow.moGen[m] += sysAcAvailableW / 1000;
            flow.hr.pvTotal[h] = sysAcAvailableW; flow.hr.toBat[h] = sysBatChargeW; flow.hr.clip[h] = sysClipW;

            if (sysAcAvailableW >= loadW) {
                flow.direct += loadW; flow.toGrid += (sysAcAvailableW - loadW); flow.hr.direct[h] = loadW; flow.hr.toGrid[h] = sysAcAvailableW - loadW;
            } else {
                let deficit = loadW - sysAcAvailableW; flow.direct += sysAcAvailableW; flow.hr.direct[h] = sysAcAvailableW;
                let dischargedEffW = 0, actualDischargeLossW = 0;
                activeInvs.forEach(inv => {
                    if (deficit <= 0) return; let bat = flatBatteries.find(b => b.id == inv.batteryId);
                    if(!bat || bat.cap === 0) return; let availableCharge = batCharges[inv.id];
                    if (availableCharge > 0) {
                        let drawW = Math.min(deficit, bat.power, availableCharge);
                        batCharges[inv.id] -= drawW; deficit -= drawW;
                        dischargedEffW += (drawW * (bat.eff || 0.90)); actualDischargeLossW += (drawW * (1 - (bat.eff || 0.90)));
                    }
                });
                flow.fromBat += dischargedEffW; flow.batLoss += actualDischargeLossW; flow.hr.batLoss[h] = actualDischargeLossW; flow.moBat[m] += dischargedEffW / 1000; flow.hr.fromBat[h] = dischargedEffW;
                flow.fromGrid += deficit; flow.hr.fromGrid[h] = deficit;
            }
            flow.toBat += sysBatChargeW;
        }

        sRes.forEach(sr => {
            sr.yield = (sr.hr.reduce((a,b)=>a+b,0)/1000) * systemLossFactor - sr.clip; 
            for(let m=0; m<12; m++){ let mSum=0; for(let h=mStart[m]; h<(m===11?8760:mStart[m+1]); h++) mSum+=sr.hr[h]; sr.mo[m]=(mSum/1000)*systemLossFactor; }
            (strings.find(s=>s.id===sr.id)?.fields || []).forEach(f=>{ const p=flatPanels.find(x=>x.id===parseInt(f.panelId)); if(p) sr.kwp += (p.pmax*f.count)/1000; });
        });

        let groupedResults = [];
        sRes.forEach(sr => {
            const strObj = strings.find(x => x.id === sr.id); const gName = strObj.group || sr.name;
            let g = groupedResults.find(x => x.name === gName);
            if(!g) { g = { name: gName, color: sr.color, kwp: 0, yield: 0, clip: 0, batYield: 0, mo: new Array(12).fill(0), panels: 0, inverters: [] }; groupedResults.push(g); }
            g.kwp += sr.kwp; g.yield += sr.yield; g.clip += sr.clip; g.batYield += sr.batYield;
            g.panels += (strObj.fields || []).reduce((sum, f) => sum + Number(f.count), 0);
            const inv = flatInverters.find(i=>i.id===parseInt(strObj.inverterId));
            if(inv && !g.inverters.includes(inv.name)) g.inverters.push(inv.name);
            for(let m=0; m<12; m++) g.mo[m] += sr.mo[m];
        });

        ['direct','fromBat','toGrid','fromGrid','toBat','clip','batLoss'].forEach(k => flow[k]/=1000);
        
        YieldDataCache = groupedResults; FlowCache = flow; activeGroupIndex = null; 
        renderStringsUI(); 
        renderDashboard();
        switchTab('uebersicht');
    } catch(e) { console.error(e); alert("Berechnungsfehler: " + e.message); }
    if(btn) { btn.innerHTML = origTxt; btn.disabled = false; }
}

// ==========================================
// 7. DASHBOARDS & CHARTS (AUSWERTUNG)
// ==========================================
function setFocus(idx) { activeGroupIndex = activeGroupIndex === idx ? null : idx; renderDashboard(); }

function renderDashboard() {
    if(!YieldDataCache || !FlowCache) return;
    let grpRes = YieldDataCache; let dK = 0, dY = 0;
    grpRes.forEach(g => { dK+=g.kwp; dY+=g.yield; });

    let kGen = document.getElementById('kpi_gen'); if(kGen) kGen.innerText = Math.round(dY).toLocaleString() + " kWh";
    let kSpec = document.getElementById('kpi_spec'); if(kSpec) kSpec.innerText = (dK>0 ? Math.round(dY/dK) : 0) + " kWh/kWp";
    let kCons = document.getElementById('kpi_cons'); if(kCons) kCons.innerText = Math.round(FlowCache.direct + FlowCache.fromBat + FlowCache.fromGrid).toLocaleString() + " kWh";
    
    let sysY = grpRes.reduce((sum, g) => sum + g.yield, 0);
    let sBD = document.getElementById('stringBreakdown');
    if(sBD) {
        sBD.innerHTML = grpRes.map((g, idx) => {
            const pct = sysY>0 ? ((g.yield / sysY)*100).toFixed(1) : 0;
            return `
            <div class="p-4 rounded-2xl border flex justify-between cursor-pointer ${activeGroupIndex===idx?'bg-blue-50 ring-2 ring-blue-400 shadow-md scale-[1.02]':'bg-white shadow-sm'}" onclick="setFocus(${idx})">
                <div class="flex items-center gap-3"><div class="w-4 h-4 rounded-full" style="background-color: ${g.color}"></div><div><p class="text-sm font-bold">${g.name}</p><p class="text-[10px] text-slate-500">${g.panels} Module (${g.kwp.toFixed(2)} kWp)</p></div></div>
                <div class="text-right"><p class="text-base font-black">${pct}%</p></div>
            </div>`;
        }).join('');
    }

    let yCtx = document.getElementById('yieldChart');
    if(yCtx) {
        if(chartYield) { chartYield.data.datasets = grpRes.map((g, idx) => ({ label: g.name, data: g.mo.map(v => Math.round(v)), backgroundColor: (activeGroupIndex !== null && activeGroupIndex !== idx) ? g.color+'20' : g.color, borderRadius: 3 })); chartYield.update(); } 
        else { chartYield = new Chart(yCtx.getContext('2d'), { type: 'bar', data: { labels: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"], datasets: grpRes.map(g => ({ label: g.name, data: g.mo.map(v => Math.round(v)), backgroundColor: g.color })) }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, min: 0 } }, plugins: { legend: { position: 'bottom' } } } }); }
    }

    let totalCons = FlowCache.direct + FlowCache.fromBat + FlowCache.fromGrid;
    let d2Dir = document.getElementById('d2-direct'); if(d2Dir) d2Dir.innerText = Math.round(FlowCache.direct).toLocaleString() + " kWh";
    let d2Bat = document.getElementById('d2-frombat'); if(d2Bat) d2Bat.innerText = Math.round(FlowCache.fromBat).toLocaleString() + " kWh";
    let d2GridI = document.getElementById('d2-grid-in'); if(d2GridI) d2GridI.innerText = Math.round(FlowCache.fromGrid).toLocaleString() + " kWh";
    let d2GridO = document.getElementById('d2-grid-out'); if(d2GridO) d2GridO.innerText = Math.round(FlowCache.toGrid).toLocaleString() + " kWh";
    
    let autarkyPct = Math.round(totalCons > 0 ? ((FlowCache.direct + FlowCache.fromBat) / totalCons) * 100 : 0);
    let eigenPct = Math.round(sysY > 0 ? (1 - (FlowCache.toGrid / sysY)) * 100 : 0);
    let d2ValA = document.getElementById('d2-val-autarky'); if(d2ValA) d2ValA.innerText = autarkyPct + "%";
    let d2ValE = document.getElementById('d2-val-eigen'); if(d2ValE) d2ValE.innerText = eigenPct + "%";
    let ga = document.getElementById('gauge-autarky'); if(ga) ga.setAttribute('stroke-dasharray', `${autarkyPct} 100`);
    let ge = document.getElementById('gauge-eigen'); if(ge) ge.setAttribute('stroke-dasharray', `${eigenPct} 100`);

    let moBreakdown = { base: [], it: [], ac: [], wp: [], bw: [], ev: [], toGrid: [], pvTotal: [], clip: [], toBat: [] };
    const mStart = [0, 744, 1416, 2160, 2880, 3624, 4344, 5088, 5832, 6552, 7296, 8016];
    for(let m=0; m<12; m++) {
        let sumB=0, sumI=0, sumA=0, sumW=0, sumBw=0, sumE=0, sumTG=0, sumPV=0, sumC=0, sumTB=0;
        for(let h=mStart[m]; h<(m===11?8760:mStart[m+1]); h++) { sumB+=ConsumptionCache.base[h]; sumI+=ConsumptionCache.it[h]; sumA+=ConsumptionCache.ac[h]; sumW+=ConsumptionCache.wp[h]; sumBw+=ConsumptionCache.bw[h]; sumE+=ConsumptionCache.ev[h]; sumTG+=FlowCache.hr.toGrid[h]; sumPV+=FlowCache.hr.pvTotal[h]; sumC+=FlowCache.hr.clip[h]; sumTB+=FlowCache.hr.toBat[h]; }
        moBreakdown.base.push(sumB/1000); moBreakdown.it.push(sumI/1000); moBreakdown.ac.push(sumA/1000); moBreakdown.wp.push(sumW/1000); moBreakdown.bw.push(sumBw/1000); moBreakdown.ev.push(sumE/1000); moBreakdown.toGrid.push(sumTG/1000); moBreakdown.pvTotal.push(sumPV/1000); moBreakdown.clip.push(sumC/1000); moBreakdown.toBat.push(sumTB/1000);
    }

    const cOpts = { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, min: 0 } }, plugins: { legend: { position: 'bottom', labels: {color: '#cbd5e1', usePointStyle: true, boxWidth: 6} } } };
    let aCCtx = document.getElementById('autarkyConsChart');
    if(aCCtx) {
        if(chartAutarkyCons) chartAutarkyCons.destroy();
        chartAutarkyCons = new Chart(aCCtx.getContext('2d'), { type: 'bar', data: { labels: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"], datasets: [ { label: 'Einspeisung', data: moBreakdown.toGrid, backgroundColor: '#f59e0b', stack: '0' }, { label: 'Bat-Ladung', data: moBreakdown.toBat, backgroundColor: '#10b981', stack: '0' }, { label: 'E-Auto', data: moBreakdown.ev, backgroundColor: '#84cc16', stack: '0' }, { label: 'Klima', data: moBreakdown.ac, backgroundColor: '#0ea5e9', stack: '0' }, { label: 'Wärmepumpe', data: moBreakdown.wp, backgroundColor: '#ef4444', stack: '0' }, { label: 'BWWP', data: moBreakdown.bw, backgroundColor: '#f43f5e', stack: '0' }, { label: 'IT/Server', data: moBreakdown.it, backgroundColor: '#3b82f6', stack: '0' }, { label: 'Grundlast', data: moBreakdown.base, backgroundColor: '#94a3b8', stack: '0' } ]}, options: cOpts });
    }

    let aGCtx = document.getElementById('autarkyGenChart');
    if(aGCtx) {
        if(chartAutarkyGen) chartAutarkyGen.destroy();
        chartAutarkyGen = new Chart(aGCtx.getContext('2d'), { type: 'bar', data: { labels: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"], datasets: [ { label: 'PV Erzeugung', data: moBreakdown.pvTotal, borderColor: '#3b82f6', backgroundColor: 'transparent', type: 'line', borderWidth: 2, pointRadius: 2, tension: 0.3 }, { label: 'PV Direkt', data: FlowCache.moGen, backgroundColor: '#3b82f6', stack: '0' }, { label: 'Aus Batterie', data: FlowCache.moBat, backgroundColor: '#a855f7', stack: '0' }, { label: 'Netzbezug', data: moBreakdown.base.map((_,i) => FlowCache.moCons[i] - FlowCache.moGen[i] + moBreakdown.toGrid[i] - FlowCache.moBat[i]), backgroundColor: '#f43f5e', stack: '0' } ]}, options: cOpts });
    }

    calculateFinances();
    if(currentDetailMonth !== null) updateDetailCharts(currentDetailMonth);
}

// ==========================================
// 8. EINZELTAGE (DETAIL)
// ==========================================
function changeDetailMonth(dir) { let newMonth = currentDetailMonth + dir; if(newMonth < 0) newMonth = 11; if(newMonth > 11) newMonth = 0; updateDetailCharts(newMonth); }

function updateDetailCharts(monthIdx) {
    currentDetailMonth = monthIdx;
    if(!FlowCache || !ConsumptionCache) return;
    const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
    let mNameUI = document.getElementById('detailMonthName'); if(mNameUI) mNameUI.innerText = monthNames[monthIdx];
    
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let startDay = 0; for(let i=0; i<monthIdx; i++) startDay += daysInMonth[i];
    let dailyLabels = [], dBase = [], dIt = [], dAc = [], dWp = [], dBw = [], dEv = [], dToGrid = [], dToBat = [], dPvTotal = [], dDirect = [], dFromBat = [], dFromGrid = [];

    for(let d=0; d<daysInMonth[monthIdx]; d++) {
        dailyLabels.push((d+1)+".");
        let sB=0, sI=0, sA=0, sW=0, sBw=0, sE=0, sTG=0, sTB=0, sPV=0, sDir=0, sFB=0, sFG=0;
        for(let h=0; h<24; h++) { let absH = (startDay + d)*24 + h; sB+=ConsumptionCache.base[absH]; sI+=ConsumptionCache.it[absH]; sA+=ConsumptionCache.ac[absH]; sW+=ConsumptionCache.wp[absH]; sBw+=ConsumptionCache.bw[absH]; sE+=ConsumptionCache.ev[absH]; sTG+=FlowCache.hr.toGrid[absH]; sTB+=FlowCache.hr.toBat[absH]; sPV+=FlowCache.hr.pvTotal[absH]; sDir+=FlowCache.hr.direct[absH]; sFB+=FlowCache.hr.fromBat[absH]; sFG+=FlowCache.hr.fromGrid[absH]; }
        dBase.push(sB/1000); dIt.push(sI/1000); dAc.push(sA/1000); dWp.push(sW/1000); dBw.push(sBw/1000); dEv.push(sE/1000); dToGrid.push(sTG/1000); dToBat.push(sTB/1000); dPvTotal.push(sPV/1000); dDirect.push(sDir/1000); dFromBat.push(sFB/1000); dFromGrid.push(sFG/1000);
    }

    const cOpts = { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, min: 0 } }, plugins: { legend: { position: 'bottom', labels: {usePointStyle: true, boxWidth: 8} } } };
    
    let dCCtx = document.getElementById('detailConsChart');
    if(dCCtx) {
        if(detailConsChart) detailConsChart.destroy();
        detailConsChart = new Chart(dCCtx.getContext('2d'), { type: 'bar', data: { labels: dailyLabels, datasets: [ { label: 'Einspeisung', data: dToGrid, backgroundColor: '#f59e0b', stack: '0' }, { label: 'Bat-Ladung', data: dToBat, backgroundColor: '#10b981', stack: '0' }, { label: 'E-Auto', data: dEv, backgroundColor: '#84cc16', stack: '0' }, { label: 'Klima', data: dAc, backgroundColor: '#0ea5e9', stack: '0' }, { label: 'WP', data: dWp, backgroundColor: '#ef4444', stack: '0' }, { label: 'BWWP', data: dBw, backgroundColor: '#f43f5e', stack: '0' }, { label: 'IT', data: dIt, backgroundColor: '#3b82f6', stack: '0' }, { label: 'Grundlast', data: dBase, backgroundColor: '#94a3b8', stack: '0' } ]}, options: cOpts });
    }
    
    let dGCtx = document.getElementById('detailGenChart');
    if(dGCtx) {
        if(detailGenChart) detailGenChart.destroy();
        detailGenChart = new Chart(dGCtx.getContext('2d'), { type: 'bar', data: { labels: dailyLabels, datasets: [ { label: 'PV Erzeugung', data: dPvTotal, borderColor: '#3b82f6', backgroundColor: 'transparent', type: 'line', borderWidth: 2, pointRadius: 1, tension: 0.2 }, { label: 'PV Direkt', data: dDirect, backgroundColor: '#3b82f6', stack: '0' }, { label: 'Aus Batterie', data: dFromBat, backgroundColor: '#a855f7', stack: '0' }, { label: 'Netzbezug', data: dFromGrid, backgroundColor: '#f43f5e', stack: '0' } ]}, options: cOpts });
    }
}

// ==========================================
// 9. EIGENE HARDWARE (CUSTOM DB)
// ==========================================
function toggleCustomDbForm() { 
    let f = document.getElementById('customDbForm'); 
    if(f) f.classList.toggle('hidden'); 
}
function updateCustomDbFields() {
    let t = document.getElementById('cdb_type').value;
    ['panel', 'inv', 'bat'].forEach(x => { let el = document.getElementById(`cdb_fields_${x}`); if(el) el.classList.add('hidden'); });
    let tEl = document.getElementById(`cdb_fields_${t}`); if(tEl) tEl.classList.remove('hidden');
}
function saveCustomDevice() {
    let t = document.getElementById('cdb_type').value;
    let name = document.getElementById('cdb_name').value;
    if(!name) return alert("Bitte Namen eingeben");
    
    let userDB = JSON.parse(localStorage.getItem('pvpro_user_db')) || { panels: [], batteries: [], inverters: [] };
    let newId = Date.now() % 100000;

    if(t==='panel') userDB.panels.push({ id: newId, name, pmax: parseFloat(document.getElementById('cdb_pmax').value)||400, voc: parseFloat(document.getElementById('cdb_voc').value)||40, vmp: parseFloat(document.getElementById('cdb_vmp').value)||30, isc: parseFloat(document.getElementById('cdb_isc').value)||10, tempVoc: -0.25 });
    if(t==='inv') {
        let mppts = []; let count = parseInt(document.getElementById('cdb_mppts').value)||2;
        for(let i=1; i<=count; i++) mppts.push({id:i, name:`MPPT ${i}`, maxIsc:20, maxI:15});
        userDB.inverters.push({ id: newId, name, acMax: parseFloat(document.getElementById('cdb_acmax').value)||5000, startV: parseFloat(document.getElementById('cdb_startv').value)||80, maxV: parseFloat(document.getElementById('cdb_maxv').value)||1000, minMppV: parseFloat(document.getElementById('cdb_startv').value)+50, maxMppV: 800, mppts });
    }
    if(t==='bat') userDB.batteries.push({ id: newId, name, cap: parseFloat(document.getElementById('cdb_cap').value)||5, power: parseFloat(document.getElementById('cdb_power').value)||5000, eff: 0.95 });

    localStorage.setItem('pvpro_user_db', JSON.stringify(userDB));
    toggleCustomDbForm();
    alert("Gerät gespeichert! App lädt neu.");
    location.reload();
}

function updateInverterBattery(invId, batId) {
    const inv = flatInverters.find(x => x.id === parseInt(invId));
    if(inv) {
        inv.batteryId = parseInt(batId);
        let batMap = JSON.parse(localStorage.getItem('pvpro_batmap') || '{}');
        batMap[invId] = parseInt(batId);
        localStorage.setItem('pvpro_batmap', JSON.stringify(batMap));
        updatePhysicsOnly();
    }
}

function renderDatabaseUI() {
    let batOptions = MasterDB.batteries.map(s => `<optgroup label="${s.series}">${(s.models||[]).map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</optgroup>`).join('');
    
    let wrCard = document.getElementById('wrCardGrid');
    if(wrCard) {
        wrCard.innerHTML = flatInverters.map(w => {
            let currentBatOpt = batOptions.replace(`value="${w.batteryId}"`, `value="${w.batteryId}" selected`);
            return `
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                    <h4 class="font-bold text-slate-800 text-sm">${w.name}</h4>
                    <div class="flex gap-2 text-[10px] text-slate-500 mt-1 mb-3"><span class="bg-slate-100 px-1.5 py-0.5 rounded">AC Max: ${w.acMax}W</span><span class="bg-slate-100 px-1.5 py-0.5 rounded">Start: ${w.startV}V</span></div>
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Zugewiesene Batterie</label>
                    <select onchange="updateInverterBattery(${w.id}, this.value)" class="w-full text-xs font-medium border-2 border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer outline-none">${currentBatOpt}</select>
                </div>
            </div>`;
        }).join('');
    }

    let pCard = document.getElementById('panelCardGrid');
    if(pCard) {
        pCard.innerHTML = flatPanels.map(p => `
            <div class="bg-white p-3 rounded-lg border border-slate-200 flex justify-between items-center shadow-sm">
                <div><h4 class="font-bold text-xs text-slate-800">${p.name}</h4><p class="text-[9px] text-slate-500">Voc: ${p.voc}V | Vmp: ${p.vmp?.toFixed(1)}V | Isc: ${p.isc}A</p></div>
                <div class="text-right"><span class="text-xs font-black text-blue-600">${p.pmax} W</span></div>
            </div>`).join('');
    }
    
    let bCard = document.getElementById('batCardGrid');
    if(bCard) {
        bCard.innerHTML = flatBatteries.map(b => `
            <div class="bg-white p-3 rounded-lg border border-slate-200 flex justify-between items-center shadow-sm">
                <div><h4 class="font-bold text-xs text-slate-800">${b.name}</h4><p class="text-[9px] text-slate-500">Max. P: ${b.power}W | Eff: ${Math.round((b.eff || 1) * 100)}%</p></div>
                <div class="text-right"><span class="text-xs font-black text-emerald-600">${b.cap.toFixed(2)} kWh</span></div>
            </div>`).join('');
    }
}

window.onload = initDatabase;
