// ContentPlan — js/analytics.js
// Dipecah dari public/index.html baris 1123-1242, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
//
// SUB-PAGE ANALITIK PER PLATFORM (2026-11-28):
// - Pemilih platform (Semua + TikTok + Instagram + YouTube + Threads) di dalam
//   #view-analytics. "Semua" = ringkasan gabungan seperti sebelumnya;
//   satu platform = sub-page detail platform itu (renderPlatformDetail).
// - SUMBER DATA — HANYA API resmi yang sudah terhubung + GAS/Sheets, BUKAN Apify.
//   Apify hanya untuk tren/referensi publik di page Ide & Tren (subagent lain)
//   dan TIDAK PERNAH dipanggil atau dirujuk dari file ini.
//   * Ringkasan akun + konten teratas: /api/social-sync?mode=analytics
//     (YouTube Data API v3, Instagram Graph API, TikTok Open API,
//     Threads Graph API — lewat token OAuth di GAS, per brand aktif).
//   * Pertumbuhan followers + likes/komentar per konten: tab Sheet
//     ACCOUNT_METRICS / CONTENT_METRICS lewat bootstrap (state.accountMetrics
//     / state.contentMetrics — dipetakan di core.js bootstrapApp()).
//   * Demografi: HANYA bila Insights resmi platform menyediakannya
//     (saat ini TIDAK ADA field demografi di social-sync maupun di Sheet).
//     Bila tidak ada -> empty state jujur, TIDAK ADA angka contoh/palsu.
// - Semua konten dari Sheets/API di-escape dengan esc() sebelum innerHTML.
// - Retensi di social-sync adalah ESTIMASI dari engagement rate, bukan data
//   retensi asli platform — label "(estimasi)" selalu ditampilkan.
        // =========================================================================
        // ANALYTICS & RETENTION INSIGHTS
        // =========================================================================

        /* Platform yang punya sub-page detail. Urutan tab mengikuti urutan
         * kartu platform di ringkasan (YouTube, Instagram, TikTok, Threads). */
        const AN_PLATFORMS = ['YouTube', 'Instagram', 'TikTok', 'Threads'];
        const AN_ALL = 'ALL';

        /* Nama field tanggal yang mungkin dipakai baris ACCOUNT_METRICS.
         * Header pasti tab ini TIDAK tercatat di repo (getSheetHeaders_ tidak
         * ada di gas/ repo) — jadi dideteksi dari baris yang ada; bila tidak
         * ada satu pun, grafik pertumbuhan menampilkan empty state. */
        const AN_DATE_FIELDS = ['metric_date', 'date', 'recorded_date', 'recorded_at', 'created_at', 'updated_at'];

        function anNum(v) {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        }

        function anFmt(v) {
            return anNum(v).toLocaleString();
        }

        function anPct(numer, denom) {
            return denom > 0 ? ((numer / denom) * 100).toFixed(2) : '0.00';
        }

        /* Platform aktif di sub-page Analitik. Disimpan di state supaya
         * survive ganti brand / refreshAllViews; default 'ALL'. */
        function anGetPlatform() {
            if (!state.analyticsPlatform || (state.analyticsPlatform !== AN_ALL && AN_PLATFORMS.indexOf(state.analyticsPlatform) === -1)) {
                state.analyticsPlatform = AN_ALL;
            }
            return state.analyticsPlatform;
        }

        /* Dipanggil onclick dari tab platform di #view-analytics. */
        function setAnalyticsPlatform(p) {
            state.analyticsPlatform = (p === AN_ALL || AN_PLATFORMS.indexOf(p) !== -1) ? p : AN_ALL;
            renderAnalyticsDashboard();
        }

        function anConnectionFor(platform) {
            const conns = (state.connections || []).filter(c => String(c.platform) === platform);
            if (state.activeBrand && state.activeBrand !== 'ALL') {
                const scoped = conns.filter(c => String(c.brand_name) === String(state.activeBrand));
                if (scoped.length > 0) return scoped[0];
            }
            return conns[0] || null;
        }

        /* Baris metrik Sheet untuk satu platform (+ brand aktif bila ada).
         * Field yang TERBUKTI dipakai getStats() di gas/BleamFeatures.gs:
         * ACCOUNT_METRICS: brand_name, followers, views.
         * CONTENT_METRICS: brand_name, views, likes, comments, shares.
         * Field lain (tanggal, content_id, judul) dibaca defensif — bila
         * header-nya tidak ada di Sheet, nilainya undefined dan pemakai
         * fungsi ini menampilkan empty state / '-' (bukan angka karangan). */
        function anSheetRows(sheetRows, platform) {
            return (sheetRows || []).filter(r => {
                if (platform && String(r.platform || '') !== '' && String(r.platform) !== platform) return false;
                if (state.activeBrand && state.activeBrand !== 'ALL' && r.brand_name && String(r.brand_name) !== String(state.activeBrand)) return false;
                return true;
            });
        }

        function anDateFieldOf(rows) {
            if (!rows || rows.length === 0) return null;
            for (const f of AN_DATE_FIELDS) {
                if (rows.some(r => r[f] !== undefined && r[f] !== null && String(r[f]).trim() !== '')) return f;
            }
            return null;
        }

        /* Deret followers per tanggal dari ACCOUNT_METRICS (snapshot yang
         * pernah tersimpan). Tanpa field tanggal -> null (empty state).
         * Mengembalikan [{ label, followers }] terurut tanggal, max 14 titik. */
        function anFollowerSeries(platform) {
            const rows = anSheetRows(state.accountMetrics, platform).filter(r => anNum(r.followers) > 0 || r.followers === 0);
            const dateField = anDateFieldOf(rows);
            if (!dateField || rows.length === 0) return { series: [], dateField: dateField };
            const byDate = {};
            rows.forEach(r => {
                const raw = String(r[dateField]);
                const key = raw.slice(0, 10); /* YYYY-MM-DD dari ISO/tanggal Sheet */
                const v = anNum(r.followers);
                byDate[key] = Math.max(byDate[key] || 0, v); /* snapshot terakhir per hari menang */
            });
            const series = Object.keys(byDate).sort().map(k => ({ label: k, followers: byDate[k] }));
            return { series: series.slice(-14), dateField: dateField };
        }

        /* Konten teratas satu platform, digabung dari dua sumber resmi:
         * 1) LIVE API (social-sync topPosts): judul, views, interaksi, ER,
         *    est. retensi — selalu segar, tapi TANPA likes/komentar terpisah.
         * 2) CONTENT_METRICS + CONTENTS (Sheet): likes, comments, shares
         *    per konten — dicocokkan lewat content_id, lalu lewat judul.
         * Bila tidak ada data di kedua sumber -> array kosong (empty state).
         * Kolom likes/komentar menampilkan '-' bila sumbernya tidak punya. */
        function anPlatformTopRows(platform) {
            const s = state.liveAnalytics || {};
            const live = (s.topPosts || []).filter(r => String(r.platform) === platform);
            const byId = {};
            const byTitle = {};
            const sheetMetrics = anSheetRows(state.contentMetrics, platform);
            const contents = anSheetRows(state.contents, platform);
            const contentById = {};
            contents.forEach(c => { if (c.content_id) contentById[String(c.content_id)] = c; });
            sheetMetrics.forEach(m => {
                const key = m.content_id ? String(m.content_id) : '';
                const content = key ? contentById[key] : null;
                const title = content ? String(content.content_title || '') : String(m.content_title || m.title || '');
                const rec = {
                    title: title,
                    views: anNum(m.views),
                    likes: m.likes !== undefined && m.likes !== '' ? anNum(m.likes) : null,
                    comments: m.comments !== undefined && m.comments !== '' ? anNum(m.comments) : null,
                    shares: m.shares !== undefined && m.shares !== '' ? anNum(m.shares) : null,
                    source: 'sheet'
                };
                if (key) byId[key] = rec;
                if (title) byTitle[title.trim().toLowerCase()] = rec;
            });

            const rows = live.map(r => {
                const match = byTitle[String(r.title || '').trim().toLowerCase()] || null;
                const likes = match && match.likes !== null ? match.likes : null;
                const comments = match && match.comments !== null ? match.comments : null;
                const engagement = anNum(r.engagement);
                return {
                    title: r.title || '',
                    views: anNum(r.views),
                    likes: likes,
                    comments: comments,
                    engagement: engagement,
                    er: r.er || (anPct(engagement, anNum(r.views)) + '%'),
                    retention: r.retention || '-',
                    source: match ? 'live+sheet' : 'live'
                };
            });

            /* Bila API live kosong (akun belum terhubung / fetch gagal), pakai
             * Sheet saja — tetap data Ferry sendiri, bukan data publik. */
            if (rows.length === 0) {
                const sheetOnly = Object.values(byTitle)
                    .map(rec => ({
                        title: rec.title,
                        views: rec.views,
                        likes: rec.likes,
                        comments: rec.comments,
                        engagement: (rec.likes || 0) + (rec.comments || 0) + (rec.shares || 0),
                        er: anPct((rec.likes || 0) + (rec.comments || 0) + (rec.shares || 0), rec.views) + '%',
                        retention: '-',
                        source: 'sheet'
                    }))
                    .sort((a, b) => b.views - a.views);
                return sheetOnly.slice(0, 10);
            }
            rows.sort((a, b) => b.views - a.views);
            return rows.slice(0, 10);
        }

        /* Demografi — BENTUK data yang diterima bila suatu saat tersedia.
         * Sumber yang sah HANYA Insights resmi platform (mis. Instagram
         * follower_demographics, YouTube Analytics demographics) yang
         * diteruskan social-sync sebagai byPlatform[p].demographics, atau
         * kolom demografi di ACCOUNT_METRICS. HARI INI KEDUANYA TIDAK ADA:
         * social-sync mode=analytics tidak mengembalikan field demografi
         * apa pun, dan tab Sheet tidak punya kolom demografi — jadi fungsi
         * ini mengembalikan null dan UI menampilkan empty state. JANGAN
         * pernah mengisi angka contoh di sini. */
        function anDemographicsFor(platform) {
            const s = state.liveAnalytics || {};
            const fromApi = s.byPlatform && s.byPlatform[platform] && s.byPlatform[platform].demographics;
            if (fromApi && (fromApi.age || fromApi.gender || fromApi.location)) return fromApi;
            const rows = anSheetRows(state.accountMetrics, platform);
            const demoRow = rows.find(r => r.age_groups || r.gender_split || r.top_locations || r.demographics_json);
            if (!demoRow) return null;
            try {
                if (demoRow.demographics_json) return JSON.parse(demoRow.demographics_json);
            } catch (e) { /* JSON rusak -> perlakukan sebagai tidak ada */ }
            return null;
        }

        async function fetchLiveAnalytics(showNotif = true) {
            const btn = document.getElementById('btn-sync-analytics');
            const cacheKey = `${state.activeBrand}`;
            /* Cache 5 menit + abort fetch sebelumnya — sama seperti feeds. */
            if (!showNotif) {
                const cached = getLiveCache('analytics', cacheKey);
                if (cached) { state.liveAnalytics = cached; renderAnalyticsDashboard(); return; }
            }
            if (_analyticsAbort) _analyticsAbort.abort();
            _analyticsAbort = new AbortController();
            if (btn) { btn.innerText = "Menarik Data API..."; btn.disabled = true; }

            try {
                const res = await fetch(`/api/social-sync?mode=analytics&brand=${encodeURIComponent(state.activeBrand)}`, { signal: _analyticsAbort.signal });
                const json = await safeJsonResponse(res);
                if (json.success) {
                    state.liveAnalytics = json.summary;
                    setLiveCache('analytics', cacheKey, state.liveAnalytics);
                    renderAnalyticsDashboard();
                    if (showNotif) showToast("Data analitik & retensi berhasil diperbarui dari API!");
                } else if (showNotif) {
                    showToast("Gagal menarik analitik: " + (json.error || "Error"), true);
                }
            } catch (e) {
                if (e && e.name === 'AbortError') return; /* digantikan fetch baru */
                if (showNotif) showToast("Error API Analitik: " + e.message, true);
            } finally {
                if (btn) { btn.innerHTML = `<i class="ph ph-chart-line-up"></i> Tarik Data API Terbaru`; btn.disabled = false; }
            }
        }

        function renderAnalyticsDashboard() {
            const s = state.liveAnalytics || {
                totalFollowers: 0, totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0,
                avgEngagementRate: "0.00", avgRetentionScore: 0,
                byPlatform: {
                    YouTube: { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false },
                    Instagram: { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false },
                    TikTok: { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false },
                    Threads: { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false }
                },
                topPosts: [],
                insights: ["Klik 'Tarik Data API Terbaru' untuk memuat metrik aktual dari akun yang sudah dihubungkan."]
            };

            /* --- Tab platform: tandai yang aktif --- */
            [AN_ALL].concat(AN_PLATFORMS).forEach(p => {
                const tab = document.getElementById('an-tab-' + p);
                if (tab) tab.classList.toggle('an-tab-active', anGetPlatform() === p);
            });

            const overview = document.getElementById('an-overview');
            const detail = document.getElementById('an-platform-detail');
            const platform = anGetPlatform();
            if (overview) overview.classList.toggle('hidden', platform !== AN_ALL);
            if (detail) detail.classList.toggle('hidden', platform === AN_ALL);
            if (platform !== AN_ALL) {
                renderPlatformDetail(platform, s);
                return; /* sub-page detail menggantikan ringkasan */
            }

            const totalEng = (s.totalLikes || 0) + (s.totalComments || 0) + (s.totalShares || 0);
            document.getElementById('an-followers').innerText = (s.totalFollowers || 0).toLocaleString();
            document.getElementById('an-views').innerText = (s.totalViews || 0).toLocaleString();
            document.getElementById('an-eng').innerText = totalEng.toLocaleString();
            document.getElementById('an-er').innerText = `${s.avgEngagementRate}%`;
            document.getElementById('an-retention').innerText = `${s.avgRetentionScore}%`;

            const pContainer = document.getElementById('an-platform-cards');
            if (pContainer) {
                pContainer.innerHTML = '';
                ['YouTube', 'Instagram', 'TikTok', 'Threads'].forEach(p => {
                    const info = s.byPlatform[p] || {};
                    pContainer.innerHTML += `
                        <div class="apple-card p-5 space-y-2">
                            <div class="flex justify-between items-center">
                                <span class="font-extrabold text-sm text-gray-900">${p}</span>
                                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${info.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">
                                    ${info.connected ? 'API Live' : 'Offline'}
                                </span>
                            </div>
                            <div class="grid grid-cols-2 gap-2 pt-2 text-xs">
                                <div><span class="text-gray-400 block text-[10px]">Followers</span><strong>${(info.followers || 0).toLocaleString()}</strong></div>
                                <div><span class="text-gray-400 block text-[10px]">Views/Reach</span><strong>${(info.views || 0).toLocaleString()}</strong></div>
                                <div><span class="text-gray-400 block text-[10px]">Interaksi</span><strong>${(info.engagement || 0).toLocaleString()}</strong></div>
                                <div><span class="text-gray-400 block text-[10px]">Retensi</span><strong class="text-indigo-600">${info.retention ? info.retention + '%' : '-'}</strong></div>
                            </div>
                        </div>
                    `;
                });
            }

            const insContainer = document.getElementById('an-insights-list');
            if (insContainer) {
                insContainer.innerHTML = (s.insights || []).map(txt => `
                    <div class="p-3 rounded-xl bg-gray-50 border border-gray-100 leading-relaxed">${esc(txt)}</div>
                `).join('');
            }

            const tbody = document.getElementById('an-top-posts-body');
            if (tbody) {
                tbody.innerHTML = (s.topPosts || []).length === 0
                    ? `<tr><td colspan="6" class="p-6 text-center text-gray-400">Belum ada data performa konten dari API.</td></tr>`
                    : s.topPosts.map(row => `
                        <tr class="hover:bg-gray-50">
                            <td class="p-4 font-bold">${esc(row.platform)}</td>
                            <td class="p-4 font-medium text-gray-900 max-w-xs truncate">${esc(row.title)}</td>
                            <td class="p-4 font-bold">${row.views.toLocaleString()}</td>
                            <td class="p-4">${row.engagement.toLocaleString()}</td>
                            <td class="p-4 text-green-600 font-bold">${esc(row.er)}</td>
                            <td class="p-4 text-indigo-600 font-bold">${esc(row.retention)}</td>
                        </tr>
                    `).join('');
            }

            const ctx = document.getElementById('anPlatformChart');
            if (ctx && typeof Chart !== 'undefined') {
                if (anChartInstance) anChartInstance.destroy();
                const labels = ['YouTube', 'Instagram', 'TikTok', 'Threads'];
                anChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'Views / Reach',
                                data: labels.map(l => s.byPlatform[l]?.views || 0),
                                backgroundColor: '#007AFF',
                                borderRadius: 6
                            },
                            {
                                label: 'Interaksi',
                                data: labels.map(l => s.byPlatform[l]?.engagement || 0),
                                backgroundColor: '#10B981',
                                borderRadius: 6
                            }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false }
                });
            }
        }

        /* =====================================================================
         * SUB-PAGE DETAIL PER PLATFORM
         * Semua angka di sini berasal dari akun Ferry sendiri lewat API resmi
         * yang sudah terhubung (social-sync) atau tab Sheet-nya sendiri
         * (ACCOUNT_METRICS / CONTENT_METRICS). Bila akun belum terhubung,
         * tiap seksi menampilkan empty state — bukan nol yang menyesatkan
         * dan bukan angka contoh.
         * ===================================================================== */
        function renderPlatformDetail(platform, s) {
            const info = (s.byPlatform && s.byPlatform[platform]) || { followers: 0, views: 0, engagement: 0, retention: 0, posts: 0, connected: false };
            const conn = anConnectionFor(platform);
            const username = conn ? (conn.username || conn.account_name || '') : '';

            const titleEl = document.getElementById('an-detail-title');
            if (titleEl) titleEl.innerText = platform;
            const accEl = document.getElementById('an-detail-account');
            if (accEl) {
                accEl.innerText = conn
                    ? (username ? '@' + username.replace(/^@/, '') + ' · ' : '') + (conn.brand_name || '')
                    : 'Akun belum terhubung';
            }
            const badgeEl = document.getElementById('an-detail-badge');
            if (badgeEl) {
                badgeEl.innerText = info.connected ? 'API Live — data dari akun terhubung' : 'Offline — akun belum terhubung';
                badgeEl.className = 'text-[10px] font-bold px-2 py-1 rounded-full ' + (info.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500');
            }

            /* (1) Ringkasan akun. ER dihitung dari angka live yang sama;
             * retensi diberi label estimasi karena social-sync memang hanya
             * mengestimasi retensi dari ER (lihat api/social-sync.js). */
            const kpis = [
                { label: 'Followers', value: anFmt(info.followers), cls: '' },
                { label: 'Views / Reach', value: anFmt(info.views), cls: 'text-blue-600' },
                { label: 'Interaksi', value: anFmt(info.engagement), cls: 'text-purple-600' },
                { label: 'Engagement Rate', value: anPct(info.engagement, info.views) + '%', cls: 'text-green-600' },
                { label: 'Est. Retensi', value: info.retention ? info.retention + '%' : '-', cls: 'text-indigo-600' },
                { label: 'Konten terhitung', value: anFmt(info.posts), cls: '' }
            ];
            const kpiEl = document.getElementById('an-detail-kpis');
            if (kpiEl) {
                kpiEl.innerHTML = kpis.map(k => `
                    <div class="apple-card p-5">
                        <p class="text-[11px] font-bold text-gray-400 uppercase">${esc(k.label)}</p>
                        <h3 class="text-2xl md:text-3xl font-extrabold mt-2 ${esc(k.cls)}">${esc(k.value)}</h3>
                    </div>
                `).join('');
            }

            /* (2) Pertumbuhan followers — grafik batang div/CSS dari
             * ACCOUNT_METRICS. Satu-satunya sumber deret waktu yang ada. */
            renderFollowerGrowth(platform);

            /* (3) Tabel konten teratas platform itu. */
            renderPlatformTopTable(platform);

            /* (4) Demografi — empty state jujur bila tidak ada datanya. */
            renderPlatformDemographics(platform);
        }

        function renderFollowerGrowth(platform) {
            const wrap = document.getElementById('an-growth-chart');
            const note = document.getElementById('an-growth-note');
            if (!wrap) return;
            const hasSheet = (state.accountMetrics || []).length > 0;
            const { series } = anFollowerSeries(platform);
            if (series.length < 2) {
                const why = !hasSheet
                    ? 'Tab ACCOUNT_METRICS masih kosong — belum ada snapshot followers yang tersimpan, jadi belum ada deret waktu untuk digambar.'
                    : 'Belum ada deret waktu followers untuk platform ini di ACCOUNT_METRICS (butuh minimal 2 snapshot bertanggal; kolom tanggal yang dikenali: metric_date, date, recorded_date, recorded_at, created_at, updated_at).';
                wrap.innerHTML = `<div class="an-empty">${esc(why)}</div>`;
                if (note) note.innerText = 'Sumber: ACCOUNT_METRICS (Sheet) — snapshot followers akun terhubung.';
                return;
            }
            const max = Math.max.apply(null, series.map(p => p.followers));
            const first = series[0].followers;
            const last = series[series.length - 1].followers;
            const delta = last - first;
            wrap.innerHTML = `
                <div class="an-bars">
                    ${series.map(p => `
                        <div class="an-bar-col">
                            <div class="an-bar-val">${esc(anFmt(p.followers))}</div>
                            <div class="an-bar" style="height:${max > 0 ? Math.max(4, Math.round((p.followers / max) * 100)) : 4}%"></div>
                            <div class="an-bar-label">${esc(p.label.slice(5))}</div>
                        </div>
                    `).join('')}
                </div>`;
            if (note) {
                const sign = delta > 0 ? '+' : '';
                note.innerText = `Perubahan ${series[0].label} → ${series[series.length - 1].label}: ${sign}${anFmt(delta)} followers. Sumber: ACCOUNT_METRICS (Sheet), ${series.length} snapshot.`;
            }
        }

        function renderPlatformTopTable(platform) {
            const tbody = document.getElementById('an-detail-top-body');
            if (!tbody) return;
            const rows = anPlatformTopRows(platform);
            const note = document.getElementById('an-detail-top-note');
            if (rows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-400">Belum ada data performa konten untuk ${esc(platform)} — hubungkan akun ${esc(platform)} lalu klik "Tarik Data API Terbaru".</td></tr>`;
                if (note) note.innerText = '';
                return;
            }
            tbody.innerHTML = rows.map(row => `
                <tr class="hover:bg-gray-50">
                    <td class="p-4 font-medium text-gray-900 max-w-xs truncate">${esc(row.title || '(tanpa judul)')}</td>
                    <td class="p-4 font-bold">${esc(anFmt(row.views))}</td>
                    <td class="p-4">${row.likes === null ? '–' : esc(anFmt(row.likes))}</td>
                    <td class="p-4">${row.comments === null ? '–' : esc(anFmt(row.comments))}</td>
                    <td class="p-4">${esc(anFmt(row.engagement))}</td>
                    <td class="p-4 text-green-600 font-bold">${esc(row.er)}</td>
                    <td class="p-4 text-indigo-600 font-bold">${esc(row.retention)}</td>
                </tr>
            `).join('');
            if (note) {
                note.innerText = 'Sumber: API resmi ' + platform + ' (live) untuk views/interaksi/ER'
                    + ' — likes & komentar terpisah tampil bila barisnya ada di CONTENT_METRICS (tanda "–" = belum ada di Sheet).'
                    + ' Retensi adalah estimasi dari ER, bukan data retensi asli platform.';
            }
        }

        function renderPlatformDemographics(platform) {
            const wrap = document.getElementById('an-demographics');
            if (!wrap) return;
            const demo = anDemographicsFor(platform);
            if (!demo) {
                wrap.innerHTML = `
                    <div class="an-empty">
                        <p class="font-bold text-gray-700 mb-1">Belum ada data demografi</p>
                        <p>Usia, gender, dan lokasi audiens hanya tersedia dari Insights resmi ${esc(platform)} lewat akun yang terhubung — dan data itu belum pernah ditarik/disimpan (social-sync saat ini tidak mengambil demografi, dan tab ACCOUNT_METRICS tidak punya kolom demografi).</p>
                        <p class="mt-2">Yang dibutuhkan: ${esc(anDemoRequirement(platform))}</p>
                        <p class="mt-2 text-gray-400">Data tren/referensi publik (Apify) TIDAK dipakai di sini — Apify tidak menyediakan demografi privat audiens akun sendiri.</p>
                    </div>`;
                return;
            }
            /* Jalur ini aktif hanya bila social-sync / Sheet suatu saat
             * benar-benar mengirim demografi. Format yang diterima:
             * { age: [{label, value}], gender: [{label, value}],
             *   location: [{label, value}] } — value = persen (0-100). */
            const section = (title, items) => {
                if (!items || items.length === 0) return '';
                const max = Math.max.apply(null, items.map(i => anNum(i.value)));
                return `
                    <div>
                        <h5 class="font-bold text-sm text-gray-900 mb-2">${esc(title)}</h5>
                        <div class="space-y-2">
                            ${items.map(i => `
                                <div>
                                    <div class="flex justify-between text-xs mb-1"><span>${esc(i.label)}</span><strong>${esc(anNum(i.value))}%</strong></div>
                                    <div class="an-demo-track"><div class="an-demo-fill" style="width:${max > 0 ? Math.round((anNum(i.value) / max) * 100) : 0}%"></div></div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
            };
            wrap.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    ${section('Usia', demo.age)}
                    ${section('Gender', demo.gender)}
                    ${section('Lokasi', demo.location)}
                </div>
                <p class="text-[11px] text-gray-400 mt-4">Sumber: Insights resmi ${esc(platform)} lewat akun terhubung.</p>`;
        }

        /* Penjelasan per platform tentang apa yang harus ditambahkan agar
         * demografi bisa tampil — TANPA mengklaim sudah tersedia. */
        function anDemoRequirement(platform) {
            switch (platform) {
                case 'Instagram':
                    return 'Instagram Graph API: metrik follower_demographics untuk IG Business yang tertaut ke Page (butuh izin & endpoint insights baru di social-sync + kolom di ACCOUNT_METRICS).';
                case 'YouTube':
                    return 'YouTube Analytics API (scope youtubeAnalytics.readonly): laporan demografi channel — endpoint terpisah dari YouTube Data API yang dipakai sekarang.';
                case 'TikTok':
                    return 'TikTok Research/Display API tidak menyediakan demografi audiens pemilik akun secara umum — demografi TikTok umumnya hanya di TikTok Studio / Creator Tools resmi.';
                case 'Threads':
                    return 'Threads API saat ini tidak menyediakan endpoint demografi audiens.';
                default:
                    return 'Insights resmi platform lewat akun terhubung.';
            }
        }
