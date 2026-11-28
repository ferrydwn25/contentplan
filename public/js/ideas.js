// ContentPlan — js/ideas.js
// View "Ide & Tren" (2026-11-28): feed referensi konten performing dari
// kreator lain — dicari lewat Apify, disimpan sebagai ide lewat jalur
// simpan composer yang sudah ada (save_composer_post, status "Idea").
// Script klasik (bukan ES module) supaya fungsi global tetap bisa dipanggil
// inline onclick di index.html — sama seperti analytics.js / composer.js.
//
// SUMBER DATA — ATURAN FERRY 28 Nov 2026 14:05 WIB:
// Data di halaman ini HANYA tren/referensi PUBLIK lewat Apify
// (endpoint /api/apify, lihat api/apify.js + APIFY-NOTES.md).
// Apify TIDAK PERNAH dipakai untuk data personal Ferry (followers, views,
// engagement, demografi, atau konten akunnya sendiri) — data itu hanya dari
// API resmi tiap platform yang sudah terhubung (OAuth + social-sync/GAS)
// dan tampil di halaman Analitik, BUKAN di sini.
// Satu-satunya input ke Apify: { platform, query (keyword topik), days }.
// Bila Apify belum terhubung (health check apifyConnected=false / token
// belum diset) halaman menampilkan empty state + instruksi menghubungkan —
// TIDAK PERNAH menampilkan data contoh seolah-olah tren asli.
//
// ALUR APIFY (async start + poll — Vercel Hobby membatasi fungsi serverless
// ~10 detik, satu run actor bisa makan waktu menit):
//   1. START — POST /api/apify { platform, query, days }
//      -> { success, runId, status: "RUNNING" } (atau 503 bila token belum diset)
//   2. POLL — GET /api/apify?runId=...&days=... tiap ~5 detik
//      -> RUNNING | SUCCEEDED { items: [...] } | FAILED/TIMED-OUT/ABORTED
//   3. HEALTH — GET /api/apify (tanpa runId)
//      -> { success, apifyConnected: boolean, ... } — hanya boolean, tanpa token.
// Filter "Semua" menjalankan 1 run per platform (4 run paralel) lalu
// menggabungkan hasilnya, diurutkan total engagement (views+likes+comments)
// menurun — sama seperti urutan yang dipakai endpoint per platform.
//
// SKOR PERFORMING (dihitung client-side dari set hasil):
//   skor = views konten ÷ MEDIAN views semua hasil platform YANG SAMA pada
//   pencarian ini. Median dipakai (bukan rata-rata aritmetik) supaya satu
//   video viral ekstrem tidak menarik "rata-rata" ke atas dan membuat semua
//   konten lain tampak di bawah rata-rata. Badge menampilkan "x,x× rata-rata"
//   (label sesuai permintaan Ferry) dan catatan kaki di bawah feed menjelaskan
//   rumusnya secara terbuka. Bila median 0 / tidak ada views, badge disembunyikan.
        // =========================================================================
        // IDE & TREN (APIFY — TREN PUBLIK SAJA)
        // =========================================================================

        /* Platform Apify (id huruf kecil = nilai yang diterima /api/apify).
         * Label tampilan mengikuti penamaan platform di seluruh app. */
        const IDEAS_PLATFORMS = [
            { id: 'tiktok', label: 'TikTok' },
            { id: 'instagram', label: 'Instagram' },
            { id: 'youtube', label: 'YouTube' },
            { id: 'threads', label: 'Threads' },
        ];
        const IDEAS_ALL = 'ALL';
        const IDEAS_DAYS = [7, 14, 30];
        const IDEAS_POLL_INTERVAL_MS = 5000;
        const IDEAS_POLL_MAX = 60; /* ~5 menit, lalu berhenti + pesan coba lagi */

        /* State halaman Ide & Tren. Hasil pencarian disimpan di sini (bukan di
         * state global core.js) supaya bootstrapApp()/refreshAllViews() yang
         * me-render ulang view aktif tidak menghapus hasil yang sudah tampil. */
        let ideasState = {
            apifyConnected: null,   /* null = belum dicek, true/false = hasil health check */
            healthChecking: false,
            healthError: '',
            platform: IDEAS_ALL,    /* 'ALL' | 'tiktok' | 'instagram' | 'youtube' | 'threads' */
            days: 14,
            query: '',              /* keyword terakhir yang dicari */
            searching: false,
            runs: {},               /* platformId -> { runId, status, error } */
            results: {},            /* platformId -> [ item ternormalisasi Apify ] */
            error: '',
            startedAt: 0,
            pollCount: 0,
            savedUrls: {},          /* url tren -> true (sudah disimpan sebagai ide sesi ini) */
        };
        let _ideasPollTimer = null;
        let _ideasSearchSeq = 0; /* pencarian baru membatalkan polling pencarian lama */

        function ideasPlatformLabel(id) {
            if (id === IDEAS_ALL) return 'Semua';
            const p = IDEAS_PLATFORMS.find(x => x.id === id);
            return p ? p.label : id;
        }

        function ideasValidPlatform(id) {
            return id === IDEAS_ALL || IDEAS_PLATFORMS.some(x => x.id === id);
        }

        function ideasNum(v) {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        }

        /* Angka ringkas gaya Indonesia: 1.234 -> "1.234", 12.400 -> "12,4 rb",
         * 1.250.000 -> "1,2 jt". Dipakai untuk views/likes/komentar di kartu. */
        function ideasFmt(n) {
            n = ideasNum(n);
            if (n >= 1000000) return (n / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
            if (n >= 1000) return (n / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' rb';
            return n.toLocaleString('id-ID');
        }

        function ideasEngagement(it) {
            return ideasNum(it.views) + ideasNum(it.likes) + ideasNum(it.comments);
        }

        /* Semua item hasil pencarian saat ini, digabung lintas platform lalu
         * diurutkan total engagement menurun (konsisten dengan urutan
         * endpoint per platform). */
        function ideasGetItems() {
            const all = [];
            Object.keys(ideasState.results).forEach(pid => {
                (ideasState.results[pid] || []).forEach(it => all.push(it));
            });
            all.sort((a, b) => ideasEngagement(b) - ideasEngagement(a));
            return all;
        }

        /* Median views dari hasil SATU platform pada pencarian ini.
         * Hanya item yang views-nya > 0 yang dihitung — item tanpa angka
         * views tidak boleh menarik median ke nol. */
        function ideasMedianViews(platformId) {
            const views = (ideasState.results[platformId] || [])
                .map(it => ideasNum(it.views))
                .filter(v => v > 0)
                .sort((a, b) => a - b);
            if (views.length === 0) return 0;
            const mid = Math.floor(views.length / 2);
            return views.length % 2 === 1
                ? views[mid]
                : (views[mid - 1] + views[mid]) / 2;
        }

        /* Skor performing satu item: views ÷ median views platform yang sama.
         * null bila median 0 (tidak ada pembanding yang bermakna). */
        function ideasScore(it) {
            const median = ideasMedianViews(String(it.platform || '').toLowerCase());
            if (median <= 0) return null;
            return ideasNum(it.views) / median;
        }

        function ideasScoreLabel(score) {
            if (score === null || !Number.isFinite(score)) return '';
            return score.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '× rata-rata';
        }

        function ideasDateLabel(iso) {
            if (!iso) return '–';
            const d = new Date(iso);
            if (isNaN(d.getTime())) return '–';
            return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        }

        /* Keyword yang sedang tertulis di input (bila ada) — didahulukan atas
         * keyword pencarian terakhir, supaya ganti platform/rentang memakai
         * kata kunci yang sedang diketik pengguna, bukan yang lama. */
        function ideasCurrentQuery() {
            const input = document.getElementById('ideas-query');
            const typed = input ? input.value.trim() : '';
            return typed || ideasState.query;
        }

        /* ---- Health check Apify: GET /api/apify (tanpa runId). ---- */
        async function checkApifyHealth() {
            if (ideasState.healthChecking || ideasState.apifyConnected !== null) return;
            ideasState.healthChecking = true;
            try {
                const res = await fetch('/api/apify');
                const json = await safeJsonResponse(res);
                ideasState.apifyConnected = !!(json && json.success && json.apifyConnected);
                ideasState.healthError = ideasState.apifyConnected ? '' : 'Apify belum terhubung.';
            } catch (e) {
                /* Endpoint belum ada di deployment / network gagal: perlakukan
                 * sebagai belum terhubung — UI menampilkan instruksi, bukan crash. */
                ideasState.apifyConnected = false;
                ideasState.healthError = 'Tidak bisa memeriksa koneksi Apify: ' + e.message;
            } finally {
                ideasState.healthChecking = false;
                renderIdeasDashboard();
            }
        }

        /* ---- Filter: ganti platform / rentang. Bila sudah ada keyword,
         * ganti filter langsung memicu pencarian baru (sesuai permintaan). ---- */
        function setIdeasPlatform(p) {
            ideasState.platform = ideasValidPlatform(p) ? p : IDEAS_ALL;
            renderIdeasDashboard();
            if (ideasCurrentQuery()) startIdeasSearch();
        }

        function setIdeasDays(d) {
            const n = Number(d);
            ideasState.days = IDEAS_DAYS.indexOf(n) !== -1 ? n : 14;
            renderIdeasDashboard();
            if (ideasCurrentQuery()) startIdeasSearch();
        }

        /* Tombol "Cari tren" / Enter di input keyword. */
        function searchIdeas() {
            const q = ideasCurrentQuery();
            if (!q) {
                showToast('Masukkan kata kunci tren dulu — mis. kopi viral.', true);
                const input = document.getElementById('ideas-query');
                if (input) input.focus();
                return;
            }
            startIdeasSearch();
        }

        /* ---- START: POST /api/apify per platform (paralel). ---- */
        async function startIdeasSearch() {
            const query = ideasCurrentQuery();
            if (!query) return;
            if (ideasState.apifyConnected === null) {
                /* Health check belum selesai (view baru dibuka): jangan
                 * klaim "belum terhubung" — minta coba lagi sebentar lagi. */
                showToast('Memeriksa koneksi Apify… coba lagi sebentar lagi.', true);
                checkApifyHealth();
                return;
            }
            if (!ideasState.apifyConnected) {
                showToast('Apify belum terhubung — ikuti instruksi di halaman ini dulu.', true);
                return;
            }

            /* Batalkan polling pencarian sebelumnya (bila ada). */
            _ideasSearchSeq++;
            const seq = _ideasSearchSeq;
            if (_ideasPollTimer) { clearTimeout(_ideasPollTimer); _ideasPollTimer = null; }

            const platforms = ideasState.platform === IDEAS_ALL
                ? IDEAS_PLATFORMS.map(p => p.id)
                : [ideasState.platform];

            ideasState.query = query;
            ideasState.days = IDEAS_DAYS.indexOf(Number(ideasState.days)) !== -1 ? Number(ideasState.days) : 14;
            ideasState.searching = true;
            ideasState.error = '';
            ideasState.results = {};
            ideasState.runs = {};
            ideasState.startedAt = Date.now();
            ideasState.pollCount = 0;
            platforms.forEach(pid => { ideasState.runs[pid] = { runId: '', status: 'STARTING', error: '' }; });
            renderIdeasDashboard();

            const starts = await Promise.all(platforms.map(async (pid) => {
                try {
                    const res = await fetch('/api/apify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ platform: pid, query: query, days: ideasState.days }),
                    });
                    const json = await safeJsonResponse(res);
                    if (json && json.success && json.runId) {
                        return { pid: pid, runId: json.runId, status: 'RUNNING', error: '' };
                    }
                    /* 503 = token belum diset di Vercel (pesan endpoint). */
                    if (res && res.status === 503) ideasState.apifyConnected = false;
                    return { pid: pid, runId: '', status: 'FAILED', error: (json && json.error) || 'Gagal menjalankan actor Apify.' };
                } catch (e) {
                    return { pid: pid, runId: '', status: 'FAILED', error: 'Gagal menghubungi /api/apify: ' + e.message };
                }
            }));

            if (seq !== _ideasSearchSeq) return; /* pencarian baru sudah dimulai */
            starts.forEach(s => { ideasState.runs[s.pid] = { runId: s.runId, status: s.status, error: s.error }; });
            const anyRunning = starts.some(s => s.status === 'RUNNING');
            if (!anyRunning) {
                ideasState.searching = false;
                ideasState.error = starts.map(s => ideasPlatformLabel(s.pid) + ': ' + s.error).join(' ');
                renderIdeasDashboard();
                return;
            }
            renderIdeasDashboard();
            scheduleIdeasPoll(seq);
        }

        function scheduleIdeasPoll(seq) {
            if (_ideasPollTimer) clearTimeout(_ideasPollTimer);
            _ideasPollTimer = setTimeout(() => pollIdeasRuns(seq), IDEAS_POLL_INTERVAL_MS);
        }

        /* ---- POLL: GET /api/apify?runId=...&days=... per run yang masih jalan. ---- */
        async function pollIdeasRuns(seq) {
            if (seq !== _ideasSearchSeq) return;
            ideasState.pollCount++;
            const running = Object.keys(ideasState.runs).filter(pid => ideasState.runs[pid].status === 'RUNNING');
            if (running.length === 0) { ideasState.searching = false; renderIdeasDashboard(); return; }

            const polls = await Promise.all(running.map(async (pid) => {
                const run = ideasState.runs[pid];
                try {
                    const res = await fetch('/api/apify?runId=' + encodeURIComponent(run.runId) + '&days=' + ideasState.days + '&platform=' + encodeURIComponent(pid));
                    const json = await safeJsonResponse(res);
                    if (json && json.success && json.status === 'SUCCEEDED') {
                        return { pid: pid, status: 'SUCCEEDED', items: Array.isArray(json.items) ? json.items : [], error: '' };
                    }
                    if (json && json.success && json.status === 'RUNNING') {
                        return { pid: pid, status: 'RUNNING', items: null, error: '' };
                    }
                    return { pid: pid, status: 'FAILED', items: null, error: (json && json.error) || 'Run Apify gagal.' };
                } catch (e) {
                    return { pid: pid, status: 'FAILED', items: null, error: 'Gagal memeriksa status run: ' + e.message };
                }
            }));

            if (seq !== _ideasSearchSeq) return; /* dibatalkan */
            polls.forEach(p => {
                ideasState.runs[p.pid].status = p.status;
                if (p.status === 'SUCCEEDED') ideasState.results[p.pid] = p.items;
                if (p.status === 'FAILED') ideasState.runs[p.pid].error = p.error;
            });

            const stillRunning = Object.keys(ideasState.runs).some(pid => ideasState.runs[pid].status === 'RUNNING');
            if (stillRunning && ideasState.pollCount < IDEAS_POLL_MAX) {
                renderIdeasDashboard();
                scheduleIdeasPoll(seq);
                return;
            }
            if (stillRunning) {
                /* Timeout polling ~5 menit: tandai sisa run sebagai gagal supaya
                 * pengguna tidak menunggu tanpa kepastian. */
                Object.keys(ideasState.runs).forEach(pid => {
                    if (ideasState.runs[pid].status === 'RUNNING') {
                        ideasState.runs[pid].status = 'FAILED';
                        ideasState.runs[pid].error = 'Pencarian berhenti setelah ~5 menit menunggu Apify. Coba lagi.';
                    }
                });
            }
            ideasState.searching = false;
            renderIdeasDashboard();
        }

        /* Batalkan pencarian yang sedang berjalan (tombol "Batalkan").
         * Hasil yang sudah selesai sebelum dibatalkan tetap tampil. */
        function cancelIdeasSearch() {
            _ideasSearchSeq++;
            if (_ideasPollTimer) { clearTimeout(_ideasPollTimer); _ideasPollTimer = null; }
            ideasState.searching = false;
            Object.keys(ideasState.runs).forEach(pid => {
                if (ideasState.runs[pid].status === 'RUNNING' || ideasState.runs[pid].status === 'STARTING') {
                    ideasState.runs[pid].status = 'FAILED';
                    ideasState.runs[pid].error = 'Dibatalkan.';
                }
            });
            renderIdeasDashboard();
        }

        /* ---- Simpan sebagai ide: jalur simpan composer yang sudah ada. ----
         * apiPost('save_composer_post', { payload, autoQueue: false }) — persis
         * seperti submitComposerPost(false) di composer.js, dengan
         * content_status "Idea" dan tanpa tanggal/jam (ide belum terjadwal:
         * TIDAK masuk auto-queue, TIDAK muncul di Kalender, TIDAK ikut
         * auto-publish cron yang hanya memproses status "Ready").
         * Judul = judul tren; caption = blok referensi (kreator, URL sumber,
         * statistik, tanggal posting, skor) supaya Ferry bisa menelusurinya
         * lagi dari antrean "Buat Post". Thumbnail tren dipakai sebagai
         * thumbnail_url bila ada. Pilar default "Hiburan" — bisa diubah di
         * composer saat ide dikembangkan. Brand = brand aktif; bila "All
         * Brands", dipakai brand pertama di daftar (composer wajib brand). */
        function ideasIsSaved(url) {
            if (!url) return false;
            if (ideasState.savedUrls[url]) return true;
            return (state.contents || []).some(c => String(c.caption || '').indexOf(url) !== -1);
        }

        function ideasTargetBrand() {
            if (state.activeBrand && state.activeBrand !== 'ALL') return state.activeBrand;
            if (state.brands && state.brands.length > 0) return state.brands[0].brand_name;
            return '';
        }

        async function saveTrendAsIdea(idx) {
            const items = ideasGetItems();
            const it = items[idx];
            if (!it) return;
            const url = it.url || '';
            if (ideasIsSaved(url)) {
                showToast('Tren ini sudah tersimpan sebagai ide sebelumnya.');
                return;
            }
            const brand = ideasTargetBrand();
            if (!brand) {
                showToast('Pilih atau buat brand dulu sebelum menyimpan ide!', true);
                return;
            }

            const btn = document.getElementById('ideas-save-' + idx);
            if (btn) { btn.disabled = true; btn.innerText = 'Menyimpan...'; }

            const score = ideasScore(it);
            const scoreText = score === null ? '-' : ideasScoreLabel(score);
            const title = String(it.title || '(tanpa judul)').slice(0, 200);
            const captionLines = [
                'Referensi tren ' + ideasPlatformLabel(String(it.platform || '').toLowerCase()) + ' — ' + (it.author ? '@' + it.author : 'kreator tidak diketahui'),
                url ? 'Sumber: ' + url : '',
                'Views: ' + ideasNum(it.views).toLocaleString('id-ID') + ' · Likes: ' + ideasNum(it.likes).toLocaleString('id-ID') + ' · Komentar: ' + ideasNum(it.comments).toLocaleString('id-ID') + ' · Dibagikan: ' + ideasNum(it.shares).toLocaleString('id-ID'),
                'Diposting: ' + ideasDateLabel(it.posted_at) + ' · Skor performing: ' + scoreText,
                'Ditemukan lewat Ide & Tren (Apify) untuk keyword "' + ideasState.query + '" — konten kreator lain, bukan konten Ferry.',
            ].filter(Boolean);

            const payload = {
                content_id: '',
                brand_name: brand,
                platform: ideasPlatformLabel(String(it.platform || '').toLowerCase()),
                content_pillar: 'Hiburan',
                content_status: 'Idea',
                content_title: title,
                caption: captionLines.join('\n'),
                thumbnail_url: it.thumbnail || '',
                scheduled_date: '',
                scheduled_time: '',
            };

            const res = await apiPost('save_composer_post', { payload: payload, autoQueue: false });
            if (res && res.success) {
                if (url) ideasState.savedUrls[url] = true;
                showToast('Tersimpan sebagai ide di antrean Buat Post!');
                /* Refresh state.contents (supaya dedupe bertahan + antrean
                 * composer menampilkan ide baru) — hasil tren di halaman ini
                 * tidak hilang karena tersimpan di ideasState. */
                await bootstrapApp();
                renderIdeasDashboard();
            } else {
                showToast('Gagal menyimpan ide: ' + ((res && res.error) || 'Error'), true);
                if (btn) { btn.disabled = false; btn.innerText = 'Simpan sebagai ide'; }
            }
        }

        /* ---- Render utama view Ide & Tren. Dipanggil navigate() lewat
         * VIEW_RENDERERS (core.js) + setiap perubahan state halaman ini.
         * Aman dipanggil berulang: semua isi dirender dari ideasState. ---- */
        function renderIdeasDashboard() {
            /* Tandai tab platform + rentang yang aktif. */
            [IDEAS_ALL].concat(IDEAS_PLATFORMS.map(p => p.id)).forEach(p => {
                const tab = document.getElementById('ideas-tab-' + p);
                if (tab) tab.classList.toggle('ideas-tab-active', ideasState.platform === p);
            });
            IDEAS_DAYS.forEach(d => {
                const tab = document.getElementById('ideas-days-' + d);
                if (tab) tab.classList.toggle('ideas-tab-active', Number(ideasState.days) === d);
            });
            const searchBtn = document.getElementById('btn-ideas-search');
            if (searchBtn) {
                searchBtn.disabled = !!ideasState.searching;
                searchBtn.innerText = ideasState.searching ? 'Mencari...' : 'Cari tren';
            }
            const queryInput = document.getElementById('ideas-query');
            if (queryInput && document.activeElement !== queryInput && ideasState.query && queryInput.value !== ideasState.query) {
                queryInput.value = ideasState.query;
            }

            const statusEl = document.getElementById('ideas-status');
            const resultsEl = document.getElementById('ideas-results');
            const noteEl = document.getElementById('ideas-footnote');
            if (!statusEl || !resultsEl) return;

            /* Health check sekali saat view pertama dibuka. */
            if (ideasState.apifyConnected === null) {
                statusEl.innerHTML = `<div class="an-empty"><p class="font-bold text-gray-700 mb-1">Memeriksa koneksi Apify…</p><p>Menunggu jawaban health check /api/apify.</p></div>`;
                resultsEl.innerHTML = '';
                if (noteEl) noteEl.innerText = '';
                checkApifyHealth();
                return;
            }

            /* Apify belum terhubung: empty state + instruksi, TANPA data contoh. */
            if (!ideasState.apifyConnected) {
                statusEl.innerHTML = `
                    <div class="an-empty">
                        <p class="font-bold text-gray-700 mb-1">Apify belum terhubung</p>
                        <p>Halaman Ide &amp; Tren hanya menampilkan tren publik dari Apify — dan token Apify belum diset, jadi belum ada tren yang bisa dicari. Tidak ada data contoh yang ditampilkan di sini.</p>
                        <p class="mt-2"><strong>Cara menghubungkan:</strong> Vercel Dashboard → project ContentPlan → Settings → Environment Variables → tambah <code>APIFY_API_TOKEN</code> (isi token Apify) → Save → <strong>Redeploy</strong> agar fungsi serverless membaca nilai baru. Token tidak pernah ditulis di repo/file mana pun.</p>
                        <p class="mt-2 text-gray-400">${esc(ideasState.healthError || '')} Bila token sudah diset tapi halaman ini masih muncul, periksa deploy terbaru sudah jalan (endpoint: GET /api/apify harus mengembalikan apifyConnected: true).</p>
                        <p class="mt-2"><button type="button" onclick="ideasRetryHealth()" class="apple-btn-secondary px-3 py-2">Periksa lagi</button></p>
                    </div>`;
                resultsEl.innerHTML = '';
                if (noteEl) noteEl.innerText = '';
                return;
            }

            const items = ideasGetItems();
            const runEntries = Object.keys(ideasState.runs).map(pid => ({ pid: pid, run: ideasState.runs[pid] }));
            const anyRun = runEntries.length > 0;
            const failedRuns = runEntries.filter(e => e.run.status === 'FAILED');

            /* Panel status: pencarian berjalan / error run / ringkasan hasil. */
            if (ideasState.searching) {
                const elapsed = Math.max(0, Math.round((Date.now() - ideasState.startedAt) / 1000));
                const lines = runEntries.map(e => {
                    const label = ideasPlatformLabel(e.pid);
                    if (e.run.status === 'SUCCEEDED') return `<div>✓ ${esc(label)}: selesai (${esc(String((ideasState.results[e.pid] || []).length))} tren)</div>`;
                    if (e.run.status === 'FAILED') return `<div>✕ ${esc(label)}: ${esc(e.run.error || 'gagal')}</div>`;
                    return `<div><span class="inline-block h-3 w-3 rounded-full border-2 border-gray-300 border-t-gray-900 animate-spin align-middle mr-1"></span> ${esc(label)}: ${esc(e.run.status === 'STARTING' ? 'memulai actor…' : 'actor sedang berjalan…')}</div>`;
                }).join('');
                statusEl.innerHTML = `
                    <div class="apple-card p-5 space-y-2">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                            <p class="text-sm font-bold text-gray-900">Mencari tren "${esc(ideasState.query)}" — ${esc(String(ideasState.days))} hari terakhir… <span class="text-gray-400 font-normal">(${elapsed} dtk, polling tiap 5 dtk, maks ~5 mnt)</span></p>
                            <button type="button" onclick="cancelIdeasSearch()" class="apple-btn-secondary px-3 py-2">Batalkan</button>
                        </div>
                        <div class="text-xs text-gray-500 space-y-1">${lines}</div>
                    </div>`;
            } else if (ideasState.error) {
                statusEl.innerHTML = `<div class="an-empty"><p class="font-bold text-gray-700 mb-1">Pencarian gagal</p><p>${esc(ideasState.error)}</p><p class="mt-2">Coba lagi dengan keyword lain, atau periksa actor Apify di Apify Console (ID actor masih provisional — lihat APIFY-NOTES.md).</p></div>`;
            } else if (anyRun && items.length === 0 && failedRuns.length > 0) {
                statusEl.innerHTML = `<div class="an-empty"><p class="font-bold text-gray-700 mb-1">Tidak ada hasil</p><p>${failedRuns.map(e => esc(ideasPlatformLabel(e.pid)) + ': ' + esc(e.run.error || 'gagal')).join(' ')}</p></div>`;
            } else if (anyRun && items.length === 0) {
                statusEl.innerHTML = `<div class="an-empty"><p class="font-bold text-gray-700 mb-1">Tidak ada konten performing untuk "${esc(ideasState.query)}" dalam ${esc(String(ideasState.days))} hari terakhir</p><p>Coba kata kunci lain, rentang yang lebih panjang (30 hari), atau platform lain. Hasil kosong ditampilkan apa adanya — tidak ada angka buatan.</p></div>`;
            } else if (!anyRun) {
                statusEl.innerHTML = `<div class="an-empty"><p class="font-bold text-gray-700 mb-1">Cari tren untuk menemukan referensi</p><p>Tulis kata kunci topik (mis. <em>kopi viral</em>, <em>resep masakan</em>, <em>Roblox horror</em>), pilih platform dan rentang waktu, lalu klik "Cari tren". Hasilnya adalah konten publik kreator lain yang sedang performing — bukan data akun Ferry.</p></div>`;
            } else {
                const total = items.length;
                const perPlat = runEntries.map(e => esc(ideasPlatformLabel(e.pid)) + ' ' + esc(String((ideasState.results[e.pid] || []).length))).join(' · ');
                statusEl.innerHTML = `<p class="text-xs text-gray-500"><strong class="text-gray-800">${esc(String(total))} tren</strong> untuk "${esc(ideasState.query)}" — ${esc(String(ideasState.days))} hari terakhir (${perPlat}). Diurutkan total engagement (views + likes + komentar) menurun.${failedRuns.length > 0 ? ' Sebagian platform gagal: ' + failedRuns.map(e => esc(ideasPlatformLabel(e.pid)) + ': ' + esc(e.run.error || 'gagal')).join(' ') : ''}</p>`;
            }

            /* Kartu tren. Semua konten Apify di-escape dengan esc(). */
            if (items.length === 0) {
                resultsEl.innerHTML = '';
            } else {
                resultsEl.innerHTML = items.map((it, idx) => {
                    const platId = String(it.platform || '').toLowerCase();
                    const score = ideasScore(it);
                    const saved = ideasIsSaved(it.url || '');
                    const thumb = it.thumbnail
                        ? `<img src="${esc(it.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="ideas-thumb" onerror="this.style.display='none'">`
                        : `<div class="ideas-thumb ideas-thumb-empty"><i class="ph ph-image text-3xl text-gray-300"></i></div>`;
                    const authorHtml = it.authorUrl
                        ? `<a href="${esc(it.authorUrl)}" target="_blank" rel="noopener" class="font-bold text-gray-800 hover:underline">${esc('@' + it.author)}</a>`
                        : `<span class="font-bold text-gray-800">${esc(it.author ? '@' + it.author : 'kreator tidak diketahui')}</span>`;
                    const sourceLink = it.url
                        ? `<a href="${esc(it.url)}" target="_blank" rel="noopener" class="text-[11px] font-bold text-blue-600 hover:underline">Lihat asli ↗</a>`
                        : '';
                    return `
                        <article class="apple-card overflow-hidden flex flex-col">
                            ${thumb}
                            <div class="p-4 space-y-2.5 flex-1 flex flex-col">
                                <div class="flex items-center gap-2">
                                    <span class="ideas-plat-badge ideas-plat-${esc(platId)}">${esc(ideasPlatformLabel(platId))}</span>
                                    ${score !== null ? `<span class="ideas-score" title="Skor performing: views konten ini ÷ median views semua hasil ${esc(ideasPlatformLabel(platId))} pada pencarian ini">${esc(ideasScoreLabel(score))}</span>` : ''}
                                    <span class="ml-auto text-[11px] text-gray-400">${esc(ideasDateLabel(it.posted_at))}</span>
                                </div>
                                <h3 class="font-bold text-sm text-gray-900 leading-snug line-clamp-2">${esc(it.title || '(tanpa judul)')}</h3>
                                <p class="text-xs text-gray-500">${authorHtml}</p>
                                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600 pt-1">
                                    <span title="Views">👁 ${esc(ideasFmt(it.views))}</span>
                                    <span title="Likes">♥ ${esc(ideasFmt(it.likes))}</span>
                                    <span title="Komentar">💬 ${esc(ideasFmt(it.comments))}</span>
                                    <span title="Dibagikan">↗ ${esc(ideasFmt(it.shares))}</span>
                                </div>
                                <div class="flex items-center gap-2 pt-2 mt-auto">
                                    <button type="button" id="ideas-save-${idx}" onclick="saveTrendAsIdea(${idx})" ${saved ? 'disabled' : ''} class="${saved ? 'apple-btn-secondary flex-1 py-2 opacity-60' : 'apple-btn flex-1 py-2'}">${saved ? '✓ Tersimpan sebagai ide' : 'Simpan sebagai ide'}</button>
                                    ${sourceLink}
                                </div>
                            </div>
                        </article>`;
                }).join('');
            }

            if (noteEl) {
                noteEl.innerText = items.length > 0
                    ? 'Sumber: Apify — tren publik kreator lain, bukan data akun Ferry. Skor "× rata-rata" = views konten ÷ median views semua hasil platform yang sama pada pencarian ini (median dipakai supaya satu video viral ekstrem tidak mendistorsi rata-rata). Data personal Ferry (followers, demografi, konten sendiri) tidak pernah ditarik lewat Apify — lihat halaman Analitik.'
                    : '';
            }
        }

        /* Tombol "Periksa lagi" di empty state belum terhubung. */
        function ideasRetryHealth() {
            ideasState.apifyConnected = null;
            ideasState.healthChecking = false;
            ideasState.healthError = '';
            renderIdeasDashboard();
        }
