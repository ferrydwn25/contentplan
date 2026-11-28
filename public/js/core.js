// ContentPlan — js/core.js
// Dipecah dari public/index.html baris 541-751. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
// LOGIN (2026-11-27): apiGet/apiPost mengirim session_token; bootstrap
// hanya jalan setelah login (gate di DOMContentLoaded, lihat auth.js).
        const ALL_VIEWS = ['calendar', 'feeds', 'swipe', 'composer', 'inbox', 'analytics', 'assets', 'brandcontext', 'settings'];
        /* Kalender membuka bulan BERJALAN (waktu lokal) — sebelumnya
         * calYear/calMonth di-hardcode November 2026. */
        const _nowLocal = new Date();
        let state = {
            activeBrand: 'ALL',
            brands: [],
            slots: [],
            contents: [],
            assets: [],
            connections: [],
            inbox: [],
            inboxFilter: 'Unreplied',
            feedOrders: {},               // P2: { 'brand|platform': [content_id...] } dari bootstrap
            feedPlatform: 'Instagram',
            liveFeeds: [],
            liveAnalytics: null,
            calYear: _nowLocal.getFullYear(),
            calMonth: _nowLocal.getMonth(),
            selectedPillars: []
        };
        let anChartInstance = null;

        /* Cache data live (feeds/analytics) per brand+platform + TTL 5 menit,
         * supaya bootstrapApp/ganti brand tidak memanggil API platform
         * berkali-kali. Tombol "Tarik" memaksa refresh (showNotif=true). */
        const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;
        let _liveCache = { feeds: {}, analytics: {} };
        let _feedsAbort = null;
        let _analyticsAbort = null;

        function getLiveCache(kind, key) {
            const entry = _liveCache[kind] && _liveCache[kind][key];
            if (!entry) return null;
            if (Date.now() - entry.at > LIVE_CACHE_TTL_MS) { delete _liveCache[kind][key]; return null; }
            return entry.data;
        }

        function setLiveCache(kind, key, data) {
            if (!_liveCache[kind]) _liveCache[kind] = {};
            _liveCache[kind][key] = { data, at: Date.now() };
        }

        async function safeJsonResponse(res) {
            const txt = await res.text();
            try {
                return JSON.parse(txt);
            } catch (e) {
                return { success: false, error: txt.slice(0, 140) };
            }
        }

        async function apiGet(endpoint) {
            try {
                /* LOGIN: kirim session_token di setiap panggilan. */
                const token = getSessionToken();
                const url = token
                    ? `/api/gas-proxy?api=${encodeURIComponent(endpoint)}&session_token=${encodeURIComponent(token)}`
                    : `/api/gas-proxy?api=${encodeURIComponent(endpoint)}`;
                const res = await fetch(url);
                return await safeJsonResponse(res);
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        async function apiPost(action, bodyObj = {}) {
            try {
                const res = await fetch('/api/gas-proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    /* LOGIN: kirim session_token di setiap panggilan. */
                    body: JSON.stringify({ action, ...bodyObj, session_token: getSessionToken() })
                });
                return await safeJsonResponse(res);
            } catch (err) {
                return { success: false, error: err.message };
            }
        }

        function showToast(msg, isError = false) {
            const toast = document.getElementById('app-toast');
            const icon = document.getElementById('app-toast-icon');
            const text = document.getElementById('app-toast-msg');
            text.innerText = msg;
            icon.className = isError
                ? 'ph-fill ph-warning-circle text-red-400 text-base'
                : 'ph-fill ph-check-circle text-green-400 text-base';
            toast.classList.remove('hidden');
            toast.classList.add('flex');
            setTimeout(() => {
                toast.classList.add('hidden');
                toast.classList.remove('flex');
            }, 3500);
        }

        /* Dialog konfirmasi di dalam app (pengganti confirm() bawaan browser).
         * Alasan: confirm() native di-dismiss otomatis (return false) oleh
         * browser headless/otomasi — tombol Hapus tampak tidak berfungsi dan
         * tidak ada dialog yang terlihat — dan tampilannya juga tidak
         * konsisten dengan UI app. Modal ini elemen DOM biasa: terlihat,
         * bisa diklik, dan bisa diverifikasi live. Mengembalikan Promise
         * boolean; pakai dengan await di semua aksi destruktif. */
        let _confirmResolve = null;
        function confirmDialog(message, okLabel) {
            return new Promise((resolve) => {
                if (_confirmResolve) _confirmResolve(false);
                _confirmResolve = resolve;
                document.getElementById('app-confirm-msg').innerText = message;
                document.getElementById('app-confirm-ok').innerText = okLabel || 'Ya, hapus';
                const modal = document.getElementById('app-confirm-modal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            });
        }
        function _closeConfirmDialog(result) {
            const modal = document.getElementById('app-confirm-modal');
            if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
            if (_confirmResolve) { const r = _confirmResolve; _confirmResolve = null; r(!!result); }
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && _confirmResolve) _closeConfirmDialog(false);
        });

        function cleanTimeStr(val, fallback = '19:00') {
            if (!val) return fallback;
            const s = String(val).trim();
            const match = s.match(/(\d{1,2}:\d{2})/);
            if (match) {
                const parts = match[1].split(':');
                return parts[0].padStart(2, '0') + ':' + parts[1];
            }
            return fallback;
        }

        /* Tanggal lokal YYYY-MM-DD dari Date — BUKAN toISOString() (UTC):
         * sebelum 07:00 WIB, toISOString() masih tanggal kemarin. */
        function localDateStr(d) {
            const p = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        }

        /* Escape HTML untuk SEMUA data dari Sheets/API sebelum disisipkan
         * lewat innerHTML — judul/caption/komentar/nama file bisa berisi
         * <, > atau " yang memecah markup atau menyisipkan HTML/JS. */
        function esc(v) {
            return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        document.addEventListener("DOMContentLoaded", async () => {
            const params = new URLSearchParams(window.location.search);
            if (params.get('code') && params.get('state')) {
                window.location.href = `/api/oauth?code=${encodeURIComponent(params.get('code'))}&state=${encodeURIComponent(params.get('state'))}`;
                return;
            }
            if (params.get('oauth_success')) {
                const banner = document.getElementById('oauth-banner');
                document.getElementById('oauth-banner-text').innerText = `✓ Akun ${params.get('oauth_success')} berhasil terhubung via OAuth 2.0!`;
                banner.classList.remove('hidden');
                window.history.replaceState({}, document.title, "/");
            } else if (params.get('oauth_error')) {
                const banner = document.getElementById('oauth-banner');
                banner.className = "bg-red-600 text-white text-xs font-bold px-6 py-2.5 flex justify-between items-center";
                document.getElementById('oauth-banner-text').innerText = `Info OAuth: ${params.get('oauth_error')}`;
                banner.classList.remove('hidden');
                window.history.replaceState({}, document.title, "/");
            }
            /* LOGIN (2026-11-27): tidak ada data yang dimuat sebelum login.
             * showApp() memanggil navigate('calendar') + bootstrapApp(),
             * yang me-render semua view lewat refreshAllViews(). */
            const username = await validateSession();
            if (username) { showApp(username); }
            else { showLogin(); }
        });

        async function bootstrapApp() {
            const dot = document.getElementById('sync-status-dot');
            const statusText = document.getElementById('sync-status-text');
            if (statusText) statusText.innerText = "Syncing Sheets...";

            const res = await apiGet('bootstrap');
            if (!res.success) {
                if (dot) dot.className = "w-2 h-2 rounded-full bg-amber-500";
                if (statusText) statusText.innerText = "GAS Offline / Cek ENV";
                refreshAllViews();
                return;
            }

            if (dot) dot.className = "w-2 h-2 rounded-full bg-green-500";
            if (statusText) statusText.innerText = "Vercel Edge Live";

            state.brands = res.brands || [];
            state.slots = res.slots || [];
            state.contents = res.contents || [];
            state.assets = res.assets || [];
            state.connections = res.connections || [];
            state.inbox = res.inbox || [];
            /* P2: urutan feed tersimpan (FEED_LAYOUT) — ordered_ids bisa
             * string JSON atau array; kunci per brand+platform. */
            state.feedOrders = {};
            (res.feedOrders || []).forEach(r => {
                let ids = [];
                try { ids = typeof r.ordered_ids === 'string' ? JSON.parse(r.ordered_ids || '[]') : (r.ordered_ids || []); } catch (e) { ids = []; }
                if (Array.isArray(ids) && ids.length > 0) state.feedOrders[r.brand_name + '|' + r.platform] = ids.map(String);
            });
            if (typeof applyFeedOrder === 'function') applyFeedOrder();

            populateBrandDropdowns();
            populateComposerAssetDropdown();
            refreshAllViews();

            if (state.connections.length > 0) {
                fetchLivePlatformFeeds(false);
                fetchLiveAnalytics(false);
            }
        }

        function navigate(viewName) {
            ALL_VIEWS.forEach(v => {
                const nav = document.getElementById('nav-' + v);
                if (nav && v !== 'swipe') nav.classList.remove('nav-active');
                const view = document.getElementById('view-' + v);
                if (view) view.classList.add('hidden');
            });
            const activeNav = document.getElementById('nav-' + viewName);
            if (activeNav && viewName !== 'swipe') activeNav.classList.add('nav-active');
            const targetView = document.getElementById('view-' + viewName);
            if (targetView) targetView.classList.remove('hidden');

            const titles = {
                swipe: 'Swipe (Batch AI)', calendar: 'Kalender', feeds: 'Feeds & Grid', composer: 'Buat Post', inbox: 'Balasan',
                analytics: 'Analitik', assets: 'Aset', brandcontext: 'Learning & Brand DNA', settings: 'Pengaturan'
            };
            document.getElementById('header-title').innerText = titles[viewName] || viewName;
            /* Pindah view: kembalikan scroll kontainer ke atas. Tanpa ini,
             * posisi scroll view sebelumnya terbawa — view baru terbuka dalam
             * keadaan sudah tergulir ke bawah sehingga bagian atasnya
             * terpotong (paling terasa di HP). */
            const appContainer = document.getElementById('app-container');
            if (appContainer) appContainer.scrollTop = 0;
            /* View di-render saat dibuka (lazy) — supaya refreshAllViews()
             * tidak perlu me-render semua view yang tersembunyi. */
            renderActiveView();
            if (window.innerWidth < 768 && !document.getElementById('sidebar').classList.contains('-translate-x-full')) {
                toggleMenu();
            }
        }

        function toggleMenu() {
            document.getElementById('sidebar').classList.toggle('-translate-x-full');
            document.getElementById('drawer-overlay').classList.toggle('hidden');
        }

        function populateBrandDropdowns() {
            const ids = ['global-brand-switcher', 'swipe-brand', 'slot-brand-filter', 'comp-brand'];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.innerHTML = id === 'global-brand-switcher' ? '<option value="ALL">🌐 All Brands</option>' : '';
                state.brands.forEach(b => {
                    el.innerHTML += `<option value="${esc(b.brand_name)}">${esc(b.brand_name)}</option>`;
                });
            });
            document.getElementById('global-brand-switcher').value = state.activeBrand;
        }

        function switchBrandWorkspace() {
            state.activeBrand = document.getElementById('global-brand-switcher').value;
            document.getElementById('breadcrumb-brand').innerText = state.activeBrand === 'ALL' ? 'All Brands' : state.activeBrand;
            if (state.activeBrand !== 'ALL') {
                ['swipe-brand', 'slot-brand-filter', 'comp-brand'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = state.activeBrand;
                });
            }
            /* P2: ganti brand = ganti urutan tersimpan yang berlaku. */
            if (typeof applyFeedOrder === 'function') applyFeedOrder();
            refreshAllViews();
            if (state.connections.length > 0) {
                fetchLivePlatformFeeds(false);
                fetchLiveAnalytics(false);
            }
        }

        function getFilteredContents() {
            return state.activeBrand === 'ALL' ? state.contents : state.contents.filter(c => c.brand_name === state.activeBrand);
        }

        /* Render per view — dipakai refreshAllViews() + navigate(). */
        const VIEW_RENDERERS = {
            calendar: () => renderCalendar(),
            feeds: () => renderFeedsView(),
            swipe: () => updateSwipeDNAIndicator(),
            composer: () => { renderComposerQueue(); updateLivePreview(); },
            inbox: () => renderUnifiedInbox(),
            analytics: () => renderAnalyticsDashboard(),
            assets: () => renderAssetsGallery(),
            brandcontext: () => renderBrandContextCards(),
            settings: () => { renderSlotMatrix(); renderSettingsOAuthCards(); }
        };

        function getActiveView() {
            for (const v of ALL_VIEWS) {
                const el = document.getElementById('view-' + v);
                if (el && !el.classList.contains('hidden')) return v;
            }
            return 'calendar';
        }

        function renderActiveView() {
            const fn = VIEW_RENDERERS[getActiveView()];
            if (!fn) return;
            try { fn(); } catch (e) { console.error('render view gagal:', e); }
        }

        /* Dulu refreshAllViews() me-render SEMUA 9 view di setiap bootstrap
         * dan ganti brand — termasuk 8 view yang sedang hidden. Sekarang
         * hanya view yang sedang tampil + sidebar OAuth + badge inbox;
         * view lain di-render saat dibuka lewat navigate(). */
        function refreshAllViews() {
            renderActiveView();
            try { renderSidebarOAuth(); } catch (e) { console.error('render sidebar gagal:', e); }
            try { updateInboxBadge(); } catch (e) { console.error('update badge gagal:', e); }
        }

