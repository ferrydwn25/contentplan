// ContentPlan — js/auth.js
// Login & sesi (aktif sejak 2026-11-27, GAS v8). Token sesi disimpan di
// sessionStorage (hilang saat tab/browser ditutup), BUKAN localStorage
// permanen. GAS memvalidasi sesi (Auth.gs); gas-proxy memvalidasi ulang
// tiap panggilan server-ke-server sebelum meneruskannya ke GAS.
// Script klasik (bukan ES module) supaya fungsi global tetap bisa
// dipanggil inline onclick di index.html.
const SESSION_KEY = 'contentplan_session';

function getSessionToken() {
    try { return sessionStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
}

/* Mengembalikan username bila sesi valid, '' bila tidak. */
async function validateSession() {
    const token = getSessionToken();
    if (!token) return '';
    const res = await fetch('/api/gas-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate_session', session_token: token })
    }).then(r => r.json()).catch(() => ({ success: false }));
    return (res && res.success === true) ? (res.username || '') : '';
}

function showLogin() {
    document.getElementById('view-loading').classList.add('hidden');
    document.getElementById('view-login').classList.remove('hidden');
    document.getElementById('app-header').classList.add('hidden');
    document.getElementById('sidebar').classList.add('hidden');
    document.querySelectorAll('.view-section:not(#view-login)')
        .forEach(el => el.classList.add('hidden'));
    document.getElementById('logout-btn').classList.add('hidden');
    document.getElementById('header-username').classList.add('hidden');
    const actions = document.getElementById('header-actions');
    if (actions) actions.classList.add('hidden');
}

function showApp(username) {
    document.getElementById('view-loading').classList.add('hidden');
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('app-header').classList.remove('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('logout-btn').classList.remove('hidden');
    const chip = document.getElementById('header-username');
    chip.textContent = username || '';
    chip.classList.remove('hidden');
    const actions = document.getElementById('header-actions');
    if (actions) actions.classList.remove('hidden');
    navigate('calendar');
    bootstrapApp();
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const res = await fetch('/api/gas-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password })
    }).then(r => r.json()).catch(() => ({ success: false }));
    if (!res || !res.success || !res.session_token) {
        /* Pesan selalu umum — jangan bedakan username salah / password salah. */
        errEl.textContent = 'Username atau password salah.';
        errEl.classList.remove('hidden');
        document.getElementById('login-password').value = '';
        return;
    }
    try { sessionStorage.setItem(SESSION_KEY, res.session_token); } catch (e) {}
    showApp(res.username);
}

async function handleLogout() {
    const token = getSessionToken();
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    if (token) {
        fetch('/api/gas-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'logout', session_token: token })
        }).catch(() => {});
    }
    showLogin();
}
