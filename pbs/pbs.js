// /home/brian/myapps/reserve/pbs/pbs.js
/* ═══════════════════════════════════════════════════════════════
   SUPABASE CONFIG
═══════════════════════════════════════════════════════════════ */
const SUPABASE_URL = 'https://sowczbjrrqazotbqpzrr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-wiDJ-bZPss16vIOL_HLrA_L5SJfuyH';
const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let _session = null;
let _saveDebounce = null;

// Register auth listener immediately so no events are missed.
// Guards ensure we only re-render after init() has run (monthData is populated).
let _initDone = false;
_supa.auth.onAuthStateChange(async (event, session) => {
    _session = session;
    if (document.getElementById('d-auth-content')) renderAuthUI();
    if (!_initDone) return;  // init() will handle the initial load
    if (event === 'SIGNED_IN') {
        await _supa.from('users').upsert({ id: session.user.id }, { onConflict: 'id' });
        await loadSchedulesFromSupabase();
        syncSettingsToUI();
        validateAll();
    }
    if (event === 'SIGNED_OUT') {
        loadFromLocalStorage();
        syncSettingsToUI();
        validateAll();
    }
});

/* ═══════════════════════════════════════════════════════════════
   DEVICE DETECTION
═══════════════════════════════════════════════════════════════ */

let usingMobile = isMobileDevice();

function applyLayout() {
    const mRoot = document.getElementById('mobile-root');
    const dRoot = document.getElementById('desktop-root');
    if (usingMobile) {
        mRoot.classList.add('active');
        dRoot.classList.remove('active');
        document.body.style.overflow = 'hidden';
        document.body.style.height = '100%';
        document.documentElement.style.height = '100%';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const bar = document.getElementById('m-palette-bar');
            const vp = document.getElementById('m-swipe-viewport');
            if (bar && vp) vp.style.top = (56 + bar.offsetHeight) + 'px';
        }));
    } else {
        dRoot.classList.add('active');
        mRoot.classList.remove('active');
        document.body.style.overflow = '';
        document.body.style.height = '';
        document.documentElement.style.height = '';
    }
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const wasMobile = usingMobile;
        usingMobile = isMobileDevice();
        if (wasMobile !== usingMobile) {
            applyLayout();
            syncSettingsToUI();
            validateAll();
            if (usingMobile) { initSwipe(); initBottomSheet(); }
        }
    }, 150);
});


/* ═══════════════════════════════════════════════════════════════
   DATA
═══════════════════════════════════════════════════════════════ */
const PRORATION_LOOKUP = {
    "30": {
        "cat1": [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12, 13, 13],
        "cat2": [0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12]
    },
    "31": {
        "cat1": [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14],
        "cat2": [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12, 12, 13, 13]
    }
};

function generateBidMonths() {
    const months = [];
    const now = new Date();
    const ref = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    for (let i = 0; i < 15; i++) {
        const date = new Date(ref.getFullYear(), ref.getMonth() + i, 1);
        const y = date.getFullYear(), mIdx = date.getMonth();
        let start, end, name;
        if (mIdx === 0) { start = new Date(y, 0, 1); end = new Date(y, 0, 30); name = "January"; }
        else if (mIdx === 1) { start = new Date(y, 0, 31); end = new Date(y, 2, 1); name = "February"; }
        else if (mIdx === 2) { start = new Date(y, 2, 2); end = new Date(y, 2, 31); name = "March"; }
        else if (mIdx === 3) { start = new Date(y, 3, 1); end = new Date(y, 4, 1); name = "April"; }
        else if (mIdx === 4) { start = new Date(y, 4, 2); end = new Date(y, 5, 1); name = "May"; }
        else if (mIdx === 5) { start = new Date(y, 5, 2); end = new Date(y, 6, 1); name = "June"; }
        else if (mIdx === 6) { start = new Date(y, 6, 2); end = new Date(y, 6, 31); name = "July"; }
        else if (mIdx === 7) { start = new Date(y, 7, 1); end = new Date(y, 7, 30); name = "August"; }
        else if (mIdx === 8) { start = new Date(y, 7, 31); end = new Date(y, 8, 30); name = "September"; }
        else if (mIdx === 9) { start = new Date(y, 9, 1); end = new Date(y, 9, 31); name = "October"; }
        else if (mIdx === 10) { start = new Date(y, 10, 1); end = new Date(y, 10, 30); name = "November"; }
        else { start = new Date(y, 11, 1); end = new Date(y, 11, 31); name = "December"; }
        const dayCount = Math.round((end - start) / 86400000) + 1;
        months.push({ name: `${name} ${y}`, start, end, dayCount, id: `cbp-${y}-${mIdx}` });
    }
    return months;
}

/* ═══════════════════════════════════════════════════════════════
   SUPABASE DATA LOADING
═══════════════════════════════════════════════════════════════ */
async function loadBidMonthsFromSupabase() {
    try {
        const { data, error } = await _supa
            .from('month_instances')
            .select('id, year, min_work, max_work, max_x_blocks, alv, extra_x, periods(name, start_month_number, start_day, end_month_number, end_day, day_count)');
        if (error || !data || data.length === 0) return null;
        const months = data.map(row => {
            const p = row.periods;
            const start = new Date(row.year, p.start_month_number - 1, p.start_day);
            const end = new Date(row.year, p.end_month_number - 1, p.end_day);
            return {
                name: `${p.name} ${row.year}`,
                start, end,
                dayCount: p.day_count,
                id: `mi-${row.id}`,
                dbId: row.id,
                dbSettings: {
                    minW: row.min_work != null ? row.min_work : 4,
                    maxW: row.max_work != null ? row.max_work : 99,
                    maxX: row.max_x_blocks != null ? row.max_x_blocks : 4,
                    alv: row.alv || 'cat1',
                    extraX: row.extra_x || false
                }
            };
        });
        months.sort((a, b) => a.start - b.start);
        return months;
    } catch (e) {
        console.error('Supabase months load failed:', e);
        return null;
    }
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem(STORE_KEY);
    const global = saved ? JSON.parse(saved) : {};
    BID_MONTHS.forEach((m, i) => {
        monthData[i] = global[m.id] || {
            days: Array(m.dayCount).fill('X'),
            settings: m.dbSettings || { minW: 4, maxW: 99, maxX: 4, alv: 'cat1', extraX: false }
        };
    });
}

async function loadSchedulesFromSupabase() {
    if (!_session) return;
    try {
        const { data, error } = await _supa
            .from('schedules')
            .select('month_id, days')
            .eq('user_id', _session.user.id);
        if (error) throw error;
        const schedMap = {};
        (data || []).forEach(row => { schedMap[row.month_id] = row.days; });
        BID_MONTHS.forEach((m, i) => {
            const savedDays = m.dbId ? schedMap[m.dbId] : null;
            monthData[i] = {
                days: savedDays || Array(m.dayCount).fill('X'),
                settings: m.dbSettings || { minW: 4, maxW: 99, maxX: 4, alv: 'cat1', extraX: false }
            };
        });
    } catch (e) {
        console.error('Supabase schedule load failed:', e);
        loadFromLocalStorage();
    }
}

let BID_MONTHS = generateBidMonths();  // pre-populated; overwritten by Supabase on init
const STORE_KEY = "rm_vRolling_Final_v4";
let currentIdx = 2;
let activeBrush = 'X';
let illegalIndices = new Set();
let monthData = {};
// Painting state
let isPainting = false;
let paintStrokeDirty = false;   // true if any day changed during current stroke
let swipeInited = false;
let sheetInited = false;


/* ═══════════════════════════════════════════════════════════════
   AUTH UI
═══════════════════════════════════════════════════════════════ */
function renderAuthUI() {
    const loggedIn = !!_session;
    const dContent = loggedIn
        ? `<div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:8px;word-break:break-all">${_session.user.email}</div>
           <button class="btn" onclick="signOut()">Sign Out</button>`
        : `<input type="email" id="d-auth-email" placeholder="your@email.com"
               style="width:100%;margin-bottom:8px;padding:8px;border-radius:6px">
           <button class="btn" onclick="sendMagicLink('d')">Send Magic Link</button>
           <div id="d-auth-msg" style="margin-top:8px;font-size:0.8rem;color:var(--text-muted)"></div>`;
    const mContent = loggedIn
        ? `<div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:8px;word-break:break-all">${_session.user.email}</div>
           <button class="btn" onclick="signOut()">Sign Out</button>`
        : `<input type="email" id="m-auth-email" placeholder="your@email.com"
               style="width:100%;margin-bottom:8px;padding:8px;border-radius:6px">
           <button class="btn" onclick="sendMagicLink('m')">Send Magic Link</button>
           <div id="m-auth-msg" style="margin-top:8px;font-size:0.8rem;color:var(--text-muted)"></div>`;
    const dEl = document.getElementById('d-auth-content');
    const mEl = document.getElementById('m-auth-content');
    if (dEl) dEl.innerHTML = dContent;
    if (mEl) mEl.innerHTML = mContent;
}

async function sendMagicLink(prefix) {
    const emailEl = document.getElementById(prefix + '-auth-email');
    const msgEl = document.getElementById(prefix + '-auth-msg');
    const email = emailEl ? emailEl.value.trim() : '';
    if (!email) { if (msgEl) msgEl.textContent = 'Enter an email address.'; return; }
    if (msgEl) msgEl.textContent = 'Sending…';
    const { error } = await _supa.auth.signInWithOtp({ email });
    if (msgEl) msgEl.textContent = error ? 'Error: ' + error.message : 'Magic link sent! Check your email.';
}

async function signOut() {
    await _supa.auth.signOut();
}

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */
async function init() {
    // 1. Try to load custom bid periods from Supabase (anon-readable).
    //    Falls back to the already-set generateBidMonths() value if unavailable.
    const supaMonths = await loadBidMonthsFromSupabase();
    if (supaMonths) BID_MONTHS = supaMonths;

    // 2. Check for an existing session (e.g. magic-link redirect).
    //    onAuthStateChange (registered at module level) handles future sign-in/out.
    const { data: { session } } = await _supa.auth.getSession();
    _session = session;

    // 3. Populate month selectors
    const today = new Date();
    ['d-month-selector', 'm-month-selector'].forEach(id => {
        const sel = document.getElementById(id);
        sel.innerHTML = '';
        BID_MONTHS.forEach((m, i) => {
            const opt = document.createElement('option');
            opt.value = i; opt.innerText = m.name;
            sel.appendChild(opt);
        });
    });

    // 4. Load schedule data
    if (_session) {
        await loadSchedulesFromSupabase();
    } else {
        loadFromLocalStorage();
    }

    // 5. Determine focused month — default to next month, restore saved selection if present
    BID_MONTHS.forEach((m, i) => {
        if (today >= m.start && today <= m.end) currentIdx = Math.min(i + 1, BID_MONTHS.length - 1);
    });
    const savedIdx = localStorage.getItem(STORE_KEY + '_idx');
    if (savedIdx !== null) currentIdx = parseInt(savedIdx);

    renderAuthUI();
    applyLayout();
    changeFocusMonth(currentIdx);
    // Set correct active brush in desktop palette from JS (not relying on HTML class)
    setBrush(activeBrush);
    initDesktopMousePainting();

    if (usingMobile) {
        initSwipe();
        initBottomSheet();
    }

    _initDone = true;
}

/* ═══════════════════════════════════════════════════════════════
   SAVE
═══════════════════════════════════════════════════════════════ */
function save() {
    // Always write to localStorage immediately (zero-cost, works offline)
    const out = {};
    BID_MONTHS.forEach((m, i) => { out[m.id] = monthData[i]; });
    localStorage.setItem(STORE_KEY, JSON.stringify(out));

    // Debounced upsert to Supabase — avoids a round-trip on every paint pixel
    if (_session) {
        clearTimeout(_saveDebounce);
        _saveDebounce = setTimeout(() => {
            const m = BID_MONTHS[currentIdx];
            if (!m || !m.dbId) return;
            _supa.from('schedules').upsert({
                user_id: _session.user.id,
                month_id: m.dbId,
                days: monthData[currentIdx].days
            }, { onConflict: 'user_id,month_id' }).then(({ error }) => {
                if (error) console.error('Supabase save error:', error);
            });
        }, 1500);
    }
}

/* ═══════════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════════ */
function changeFocusMonth(idx) {
    if (idx < 0 || idx >= BID_MONTHS.length) return;
    currentIdx = parseInt(idx);
    localStorage.setItem(STORE_KEY + '_idx', currentIdx);
    syncSettingsToUI();
    validateAll();
}

function syncSettingsToUI() {
    const s = monthData[currentIdx].settings;
    const name = BID_MONTHS[currentIdx].name;

    document.getElementById('d-month-selector').value = currentIdx;
    document.getElementById('d-cfg-min-w').value = s.minW;
    document.getElementById('d-cfg-max-w').value = s.maxW;
    document.getElementById('d-cfg-max-x-blks').value = s.maxX;
    document.getElementById('d-alv-cat').value = s.alv;
    document.getElementById('d-extra-x').checked = s.extraX;

    document.getElementById('m-month-selector').value = currentIdx;
    document.getElementById('m-cfg-min-w').value = s.minW;
    document.getElementById('m-cfg-max-w').value = s.maxW;
    document.getElementById('m-cfg-max-x-blks').value = s.maxX;
    document.getElementById('m-alv-cat').value = s.alv;
    document.getElementById('m-extra-x').checked = s.extraX;
    document.getElementById('m-month-title').innerText = name;
}


/* ═══════════════════════════════════════════════════════════════
   BRUSH
═══════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════════
   PAINT  — fast path during stroke, full validate on stroke end
═══════════════════════════════════════════════════════════════ */
function paintDay(mIdx, dIdx) {
    if (monthData[mIdx].days[dIdx] === activeBrush) return; // no-op
    monthData[mIdx].days[dIdx] = activeBrush;
    paintStrokeDirty = true;
    // Update only the affected day cell in the DOM — no full re-render
    updateDayCell(mIdx, dIdx);
}

function endStroke() {
    if (!paintStrokeDirty) return;
    paintStrokeDirty = false;
    save();
    validateAll(); // full validate + render only once per stroke
}

// Surgically update a single day cell's classes and text without rebuilding the grid
function updateDayCell(mIdx, dIdx) {
    const code = monthData[mIdx].days[dIdx];
    // Update in whichever grid is currently rendered
    const sel = `.day[data-midx="${mIdx}"][data-didx="${dIdx}"]`;
    document.querySelectorAll(sel).forEach(el => {
        // Remove all code classes, add new one
        ['X', 'R', 'A', 'C', 'CQ', 'CI', 'Z'].forEach(c => el.classList.remove(c));
        el.classList.add(code);
        const codeEl = el.querySelector('.day-code');
        if (codeEl) codeEl.textContent = code === 'Z' ? 'X' : code;
    });
}

function getDayFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const dayEl = el.closest && el.closest('.day[data-didx]');
    if (!dayEl) return null;
    return { mIdx: parseInt(dayEl.dataset.midx), dIdx: parseInt(dayEl.dataset.didx) };
}


/* ═══════════════════════════════════════════════════════════════
   VALIDATE  — reads settings from active layout only
═══════════════════════════════════════════════════════════════ */
function validateAll() {
    const s = monthData[currentIdx].settings;
    const prefix = usingMobile ? 'm-' : 'd-';

    s.minW = parseInt(document.getElementById(prefix + 'cfg-min-w').value) || 1;
    s.maxW = parseInt(document.getElementById(prefix + 'cfg-max-w').value) || 99;
    s.maxX = parseInt(document.getElementById(prefix + 'cfg-max-x-blks').value) || 4;
    s.alv = document.getElementById(prefix + 'alv-cat').value;
    s.extraX = document.getElementById(prefix + 'extra-x').checked;
    // Note: save() is NOT called here — caller is responsible
    // (endStroke saves after painting; settings inputs save via onSettingsChange)

    illegalIndices.clear();
    const alerts = [];
    const m = BID_MONTHS[currentIdx];
    const currDays = monthData[currentIdx].days;

    const availCount = currDays.filter(d => d !== 'A').length;
    const xUsed = currDays.filter(d => d === 'X' || d === 'Z').length;
    const lookup = PRORATION_LOOKUP[m.dayCount.toString()];
    const baseReq = lookup ? (lookup[s.alv][availCount] || 0) : 0;
    const xReq = baseReq + (s.extraX ? 1 : 0);

    if (xUsed !== xReq) alerts.push(xUsed < xReq ? `Need ${xReq - xUsed} more X` : `Too many X`);

    let xBlks = 0, inX = false;
    currDays.forEach(d => {
        if (d === 'X') {
            if (!inX) { xBlks++; inX = true; }
        } else if (d !== 'A') {
            inX = false;
        }
    });
    if (xBlks > s.maxX) alerts.push(`Exceeds Max X Blocks`);

    const pIdx = currentIdx > 0 ? currentIdx - 1 : null;
    const combo = [...(pIdx !== null ? monthData[pIdx].days : []), ...currDays];
    const offset = pIdx !== null ? monthData[pIdx].days.length : 0;
    let block = [];
    combo.forEach((code, i) => {
        if (['R', 'C', 'CQ', 'CI'].includes(code)) { block.push(i); }
        else { checkWorkBlock(block, offset, currDays.length, combo, alerts, s); block = []; }
    });
    checkWorkBlock(block, offset, currDays.length, combo, alerts, s);

    const unique = [...new Set(alerts)];

    // Desktop stats
    document.getElementById('d-stat-avail').innerText = availCount;
    document.getElementById('d-stat-x-used').innerText = xUsed;
    document.getElementById('d-stat-x-req').innerText = xReq;
    document.getElementById('d-stat-x-blks').innerText = xBlks;
    document.getElementById('d-alerts').innerHTML = unique.length
        ? unique.map(a => `<div class="alert">⚠️ ${a}</div>`).join('')
        : `<div class="success">✓ LEGAL</div>`;

    // Mobile peek
    document.getElementById('m-sheet-status').innerHTML = unique.length === 0
        ? `<span class="ok">✓ LEGAL</span> &nbsp; Avail:${availCount} &nbsp; X:${xUsed}/${xReq} &nbsp; Blks:${xBlks}`
        : `<span class="warn">⚠ ${unique[0]}</span>${unique.length > 1 ? ` +${unique.length - 1}` : ''}`;

    // Only rebuild the active layout's calendars
    if (usingMobile) {
        renderMobilePanel('m-panel-prev', currentIdx - 1, true);
        renderMobilePanel('m-panel-curr', currentIdx, false, availCount, xUsed, xReq, xBlks, unique);
        renderMobilePanel('m-panel-next', currentIdx + 1, true);
    } else {
        renderDesktopMonth('d-prev-container', currentIdx - 1, true);
        renderDesktopMonth('d-curr-container', currentIdx, false);
        renderDesktopMonth('d-next-container', currentIdx + 1, true);
    }
}

// Called by all settings inputs — saves then validates
function onSettingsChange() {
    save();
    validateAll();
}

function checkWorkBlock(indices, offset, currLen, combo, alerts, s) {
    if (indices.length === 0) return;
    if (!indices.some(i => ['R', 'C'].includes(combo[i]))) return;
    const tEnd = indices.includes(offset + currLen - 1);
    if (indices.length < s.minW && !tEnd) {
        indices.forEach(i => { if (i >= offset && i < offset + currLen) illegalIndices.add(i - offset); });
        if (indices.some(i => i >= offset && i < offset + currLen)) alerts.push('Short Work Block');
    }
    if (indices.length > s.maxW) {
        indices.forEach(i => { if (i >= offset && i < offset + currLen) illegalIndices.add(i - offset); });
        alerts.push('Work Block exceeds Max');
    }
}


/* ═══════════════════════════════════════════════════════════════
   RENDER
═══════════════════════════════════════════════════════════════ */
function buildGridHTML(idx, isSide, gridClass) {
    const m = BID_MONTHS[idx];
    let html = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="weekday">${d}</div>`).join('');
    for (let i = 0; i < m.start.getDay(); i++) html += '<div></div>';
    monthData[idx].days.forEach((code, dIdx) => {
        const date = new Date(m.start); date.setDate(m.start.getDate() + dIdx);
        const illegal = !isSide && illegalIndices.has(dIdx) ? ' illegal' : '';
        html += `<div class="day ${code}${illegal}" data-midx="${idx}" data-didx="${dIdx}">
    <span class="day-num">${date.getDate()}</span>
    <span class="day-code">${code === 'Z' ? 'X' : code}</span>
</div>`;
    });
    return `<div class="${gridClass}">${html}</div>`;
}

function renderDesktopMonth(containerId, idx, isSide) {
    const container = document.getElementById(containerId);
    if (idx < 0 || idx >= BID_MONTHS.length) { container.innerHTML = ''; return; }
    const m = BID_MONTHS[idx];
    container.innerHTML = `<div class="card"><h3>${m.name}</h3>${buildGridHTML(idx, isSide, 'd-calendar-grid')}</div>`;
}

function renderMobilePanel(containerId, idx, isSide, availCount, xUsed, xReq, xBlks, alerts) {
    const container = document.getElementById(containerId);
    if (idx < 0 || idx >= BID_MONTHS.length) { container.innerHTML = ''; return; }

    const status = (!isSide && availCount !== undefined) ? `
<div id="m-status-strip">
    <div class="m-stat-chip"><span class="val">${availCount}</span><span class="lbl">Avail</span></div>
    <div class="m-stat-chip"><span class="val">${xUsed}/${xReq}</span><span class="lbl">X Used/Req</span></div>
    <div class="m-stat-chip"><span class="val">${xBlks}</span><span class="lbl">X Blocks</span></div>
</div>
<div style="margin-top:10px">
    ${alerts.length ? alerts.map(a => `<div class="alert">⚠️ ${a}</div>`).join('') : '<div class="success">✓ LEGAL</div>'}
</div>` : '';

    container.innerHTML = `
<div class="m-cal-card">
    ${buildGridHTML(idx, isSide, 'm-calendar-grid')}
</div>
${status}`;

    if (!isSide) {
        // Brush clicks
        container.querySelectorAll('.brush').forEach(el => {
            el.addEventListener('click', () => setBrush(el.dataset.brush));
        });
        // Touch painting — listeners stay on the stable cal card element
        const cal = container.querySelector('.m-cal-card');
        let tapStartX, tapStartY;
        cal.addEventListener('touchstart', e => {
            tapStartX = e.changedTouches[0].clientX;
            tapStartY = e.changedTouches[0].clientY;
        }, { passive: true });
        cal.addEventListener('touchend', e => {
            const t = e.changedTouches[0];
            const dx = Math.abs(t.clientX - tapStartX);
            const dy = Math.abs(t.clientY - tapStartY);
            if (dx > 10 || dy > 10) return; // was a drag, not a tap
            const info = getDayFromPoint(t.clientX, t.clientY);
            if (info) { paintDay(info.mIdx, info.dIdx); endStroke(); }
        });
        cal.addEventListener('touchcancel', () => { });
    }
}


/* ═══════════════════════════════════════════════════════════════
   DESKTOP MOUSE PAINTING
═══════════════════════════════════════════════════════════════ */
function initDesktopMousePainting() {
    document.addEventListener('mousedown', e => {
        const dayEl = e.target.closest && e.target.closest('.d-calendar-grid .day[data-didx]');
        if (!dayEl) return;
        if (e.button === 2) {
            // Right-click: toggle R ↔ X only
            const mIdx = parseInt(dayEl.dataset.midx);
            const dIdx = parseInt(dayEl.dataset.didx);
            monthData[mIdx].days[dIdx] = monthData[mIdx].days[dIdx] === 'X' ? 'R' : 'X';
            save();
            validateAll();
            e.preventDefault();
            return;
        }
        if (e.button === 0) {
            isPainting = true;
            paintDay(parseInt(dayEl.dataset.midx), parseInt(dayEl.dataset.didx));
            e.preventDefault();
        }
    });
    document.addEventListener('mousemove', e => {
        if (!isPainting) return;
        const dayEl = e.target.closest && e.target.closest('.d-calendar-grid .day[data-didx]');
        if (dayEl) paintDay(parseInt(dayEl.dataset.midx), parseInt(dayEl.dataset.didx));
    });
    document.addEventListener('mouseup', e => {
        if (e.button === 0) {
            isPainting = false;
            endStroke(); // validate + save once when mouse releases
        }
    });
    document.addEventListener('contextmenu', e => {
        if (e.target.closest && e.target.closest('.d-calendar-grid .day[data-didx]')) {
            e.preventDefault();
        }
    });
}

/* ═══════════════════════════════════════════════════════════════
   SWIPE
═══════════════════════════════════════════════════════════════ */
function initSwipe() {
    if (swipeInited) return;
    swipeInited = true;

    document.getElementById('m-swipe-track').style.transform = 'translateX(-33.333%)';
    document.getElementById('m-btn-prev').addEventListener('click', () => navigate(-1));
    document.getElementById('m-btn-next').addEventListener('click', () => navigate(1));

    const vp = document.getElementById('m-swipe-viewport');
    let sx = 0, sy = 0, active = false;
    vp.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        active = true;
    }, { passive: true });
    vp.addEventListener('touchmove', e => {
        if (!active) return;
        const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
        if (Math.abs(dy) > Math.abs(dx) + 8) { active = false; return; }
        if (Math.abs(dx) > 10) e.preventDefault();
    }, { passive: false });
    vp.addEventListener('touchend', e => {
        if (!active) return; active = false;
        const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) navigate(dx < 0 ? 1 : -1);
    }, { passive: true });
}

function navigate(dir) {
    const next = currentIdx + dir;
    if (next < 0 || next >= BID_MONTHS.length) return;
    animateSwipe(dir, () => changeFocusMonth(next));
}

function animateSwipe(dir, cb) {
    const track = document.getElementById('m-swipe-track');
    track.style.transition = 'none';
    track.style.transform = 'translateX(-33.333%)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        track.style.transition = 'transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94)';
        track.style.transform = `translateX(${dir > 0 ? '-66.666' : '0'}%)`;
        track.addEventListener('transitionend', function h() {
            track.removeEventListener('transitionend', h);
            cb();
            track.style.transition = 'none';
            track.style.transform = 'translateX(-33.333%)';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                track.style.transition = 'transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94)';
            }));
        }, { once: true });
    }));
}


/* ═══════════════════════════════════════════════════════════════
   BOTTOM SHEET
═══════════════════════════════════════════════════════════════ */
function initBottomSheet() {
    if (sheetInited) return;
    sheetInited = true;

    const sheet = document.getElementById('m-bottom-sheet');
    const handle = document.getElementById('m-sheet-handle-area');
    const body = document.getElementById('m-sheet-body');
    let open = false, startY = 0, startT = 0, dragging = false, baseT = 0, locked = false;

    function maxT() {
        return sheet.offsetHeight - parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek'));
    }

    handle.addEventListener('click', () => {
        open = !open;
        sheet.classList.toggle('expanded', open);
    });

    sheet.addEventListener('touchstart', e => {
        open = sheet.classList.contains('expanded');
        startY = e.touches[0].clientY;
        startT = Date.now();
        dragging = false;
        baseT = open ? 0 : maxT();
        locked = body.contains(e.target) && body.scrollTop > 0;
    }, { passive: true });

    sheet.addEventListener('touchmove', e => {
        const dy = e.touches[0].clientY - startY;
        if (locked) {
            if (body.scrollTop <= 0 && dy > 0) { locked = false; }
            else { return; }
        }
        if (Math.abs(dy) > 8) dragging = true;
        if (!dragging) return;
        if (open && dy < 0) return;
        const t = Math.max(0, Math.min(maxT(), baseT + dy));
        sheet.style.transition = 'none';
        sheet.style.transform = `translateY(${t}px)`;
        e.preventDefault();
    }, { passive: false });

    sheet.addEventListener('touchend', e => {
        if (!dragging) return;
        dragging = false;
        const dy = e.changedTouches[0].clientY - startY;
        const vel = Math.abs(dy) / (Date.now() - startT);
        sheet.style.transition = '';
        sheet.style.transform = '';
        open = vel > 0.5 ? dy < 0 : (baseT + dy) < maxT() * 0.45;
        sheet.classList.toggle('expanded', open);
    }, { passive: true });
}

function openSheet() {
    document.getElementById('m-bottom-sheet').classList.add('expanded');
}


/* ═══════════════════════════════════════════════════════════════
   EXPORT / IMPORT
═══════════════════════════════════════════════════════════════ */
async function exportData() {
    const json = JSON.stringify(monthData, null, 2);
    if (window.showSaveFilePicker) {
        try {
            const fh = await window.showSaveFilePicker({ suggestedName: 'reserve_data.json', types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }] });
            const w = await fh.createWritable();
            await w.write(json); await w.close(); return;
        } catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(json);
    a.download = 'reserve_data.json'; a.click();
}

function importData(event) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const imp = JSON.parse(e.target.result);
            Object.keys(imp).forEach(k => { monthData[k] = imp[k]; });
            save(); validateAll();
        } catch { alert('Invalid file. Please import a valid reserve_data.json.'); }
    };
    reader.readAsText(event.target.files[0]);
}


/* ═══════════════════════════════════════════════════════════════
   GO
═══════════════════════════════════════════════════════════════ */
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && _initDone) {
        const { data: { session } } = await _supa.auth.getSession();
        _session = session;
        renderAuthUI();
        if (_session) {
            await loadSchedulesFromSupabase();
            syncSettingsToUI();
            validateAll();
        }
    }
});
init();
