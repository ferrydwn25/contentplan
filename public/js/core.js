// ContentPlan — js/core.js
// Dipecah dari public/index.html baris 541-751, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        const ALL_VIEWS = ['calendar', 'feeds', 'swipe', 'composer', 'inbox', 'analytics', 'assets', 'brandcontext', 'settings'];
        let state = {
            activeBrand: 'ALL',
            brands: [],
            slots: [],
            contents: [],
            assets: [],
            connections: [],
            inbox: [],
            inboxFilter: 'Unreplied',
            feedPlatform: 'Instagram',
            liveFeeds: [],
            liveAnalytics: null,
            calYear: 2026,
            calMonth: 10,
            selectedPillars: []
        };
        let anChartInstance = null;

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
                const res = await fetch(`/api/gas-proxy?api=${encodeURIComponent(endpoint)}`);
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
                    body: JSON.stringify({ action, ...bodyObj })
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

        document.addEventListener("DOMContentLoaded", () => {
            renderSidebarOAuth();
            renderSettingsOAuthCards();
            renderCalendar();
            renderFeedsView();

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
            bootstrapApp();
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
                    el.innerHTML += `<option value="${b.brand_name}">${b.brand_name}</option>`;
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
            refreshAllViews();
            if (state.connections.length > 0) {
                fetchLivePlatformFeeds(false);
                fetchLiveAnalytics(false);
            }
        }

        function getFilteredContents() {
            return state.activeBrand === 'ALL' ? state.contents : state.contents.filter(c => c.brand_name === state.activeBrand);
        }

        function refreshAllViews() {
            renderCalendar();
            renderFeedsView();
            renderComposerQueue();
            renderSidebarOAuth();
            renderSettingsOAuthCards();
            renderUnifiedInbox();
            renderSlotMatrix();
            renderBrandContextCards();
            renderAssetsGallery();
            renderAnalyticsDashboard();
            updateLivePreview();
            updateSwipeDNAIndicator();
        }

