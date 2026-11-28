// ContentPlan — js/feeds.js
// Feeds & Grid — Phone Feed Studio (P0 grid compact + P1 simulasi HP).
// P0: grid compact + sort kronologis gabungan (terjadwal + live).
// P1: simulasi HP per platform (chrome TikTok/Shorts, Instagram, Threads),
//     bisa di-scroll (scroll-snap) dan ditata ulang (drag-and-drop + tombol
//     naik/turun) untuk post TERJADWAL saja. Post live terkunci ("Sudah tayang").
// P2: urutan tersimpan di FEED_LAYOUT (GAS v10+, via bootstrap feedOrders
// + aksi save_feed_order). state.feedOrders = { 'brand|platform': [id...] };
// state.feedOrder = urutan aktif untuk brand+platform saat ini (null =
// default kronologis). Ganti brand/platform memuat ulang urutan tersimpan
// brand+platform itu — jadi urutan satu platform tidak bocor ke platform lain.
// Script klasik (bukan ES module) supaya fungsi global tetap bisa dipanggil
// inline onclick di index.html.
        // =========================================================================
        // FEEDS & GRID PREVIEW — PHONE FEED STUDIO
        // =========================================================================
        state.feedMode = state.feedMode || 'grid';      // 'grid' | 'phone'
        state.feedReorder = false;                      // mode susun aktif?
        state.feedOrder = null;                         // array content_id terjadwal (null = default kronologis)
        state.feedOrders = state.feedOrders || {};      // P2: urutan tersimpan per 'brand|platform'
        state.feedSelected = null;                      // key item terpilih di inspector

        function feedOrderKey() {
            return state.activeBrand + '|' + state.feedPlatform;
        }

        /* Muat urutan tersimpan untuk brand+platform aktif (dari bootstrap).
         * Hanya id yang masih ada & belum Published yang dipakai; kalau tidak
         * ada urutan tersimpan, kembali ke kronologis (null). Dipanggil saat
         * bootstrap, ganti brand, dan ganti platform. */
        function applyFeedOrder() {
            const saved = (state.feedOrders || {})[feedOrderKey()];
            if (!saved || saved.length === 0) { state.feedOrder = null; return; }
            const ids = getFilteredContents()
                .filter(c => c.platform === state.feedPlatform && c.content_status !== 'Published')
                .map(c => String(c.content_id));
            const kept = saved.map(String).filter(id => ids.indexOf(id) !== -1);
            state.feedOrder = kept.length > 0 ? kept : null;
        }

        /* Simpan urutan saat ini ke Sheets (FEED_LAYOUT) via gas-proxy.
         * GAS hanya menyimpan id yang valid (masih ada & belum Published) dan
         * mengembalikan ordered_ids yang benar-benar tersimpan. */
        async function saveFeedOrder() {
            if (state.activeBrand === 'ALL') {
                showToast('Pilih satu brand dulu untuk menyimpan urutan feed.', true);
                return;
            }
            ensureFeedOrder();
            const btn = document.getElementById('btn-save-feed-order');
            if (btn) { btn.disabled = true; btn.innerText = 'Menyimpan…'; }
            try {
                const res = await apiPost('save_feed_order', {
                    brandName: state.activeBrand,
                    platform: state.feedPlatform,
                    orderedIds: state.feedOrder || []
                });
                if (res && res.success) {
                    state.feedOrders[feedOrderKey()] = (res.ordered_ids || state.feedOrder || []).map(String);
                    showToast('Urutan feed tersimpan untuk ' + state.activeBrand + ' / ' + state.feedPlatform + '.');
                } else {
                    showToast('Gagal menyimpan urutan: ' + ((res && res.error) || 'cek koneksi'), true);
                }
            } catch (e) {
                showToast('Gagal menyimpan urutan: ' + e.message, true);
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-floppy-disk"></i> Simpan urutan'; }
            }
        }

        function setFeedPlatform(plat) {
            state.feedPlatform = plat;
            ['Instagram', 'TikTok', 'YouTube', 'Threads'].forEach(p => {
                const btn = document.getElementById('feed-tab-' + p);
                if (!btn) return;
                btn.className = p === plat
                    ? 'bg-gray-900 text-white px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer'
                    : 'text-gray-600 hover:bg-gray-100 px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer';
            });
            /* P2: ganti platform = muat urutan tersimpan platform itu. */
            applyFeedOrder();
            renderFeedsView();
            fetchLivePlatformFeeds(false);
        }

        async function fetchLivePlatformFeeds(showNotif = true) {
            const btn = document.getElementById('btn-sync-feeds');
            const cacheKey = `${state.activeBrand}|${state.feedPlatform}`;
            /* Cache 5 menit: bootstrap/ganti brand tidak memanggil API
             * platform berkali-kali. Tombol "Tarik" (showNotif=true) selalu
             * memaksa refresh. */
            if (!showNotif) {
                const cached = getLiveCache('feeds', cacheKey);
                if (cached) { state.liveFeeds = cached; renderFeedsView(); return; }
            }
            /* Abort fetch sebelumnya yang masih berjalan (mis. ganti
             * platform/brand cepat-cepat) supaya respons basi tidak
             * menimpa data terbaru. */
            if (_feedsAbort) _feedsAbort.abort();
            _feedsAbort = new AbortController();
            if (btn) { btn.innerText = "Menarik Feeds..."; btn.disabled = true; }

            try {
                const res = await fetch(`/api/social-sync?mode=feeds&brand=${encodeURIComponent(state.activeBrand)}&platform=${encodeURIComponent(state.feedPlatform)}`, { signal: _feedsAbort.signal });
                const json = await safeJsonResponse(res);
                if (json.success) {
                    state.liveFeeds = json.posts || [];
                    setLiveCache('feeds', cacheKey, state.liveFeeds);
                    renderFeedsView();
                    if (showNotif) showToast(`Berhasil menarik ${state.liveFeeds.length} post dari ${state.feedPlatform}!`);
                } else if (showNotif) {
                    showToast("Gagal menarik feeds: " + (json.error || "Cek koneksi OAuth"), true);
                }
            } catch (e) {
                if (e && e.name === 'AbortError') return; /* digantikan fetch baru */
                if (showNotif) showToast("Error koneksi API: " + e.message, true);
            } finally {
                if (btn) { btn.innerHTML = `<i class="ph ph-cloud-arrow-down"></i> Tarik Feeds API`; btn.disabled = false; }
            }
        }

        function openNewComposerPostForFeed() {
            openNewComposerPost();
            document.getElementById('comp-platform').value = state.feedPlatform;
            updateLivePreview();
        }

        /* ------------------------- mode Grid / HP ------------------------- */

        function setFeedMode(mode) {
            state.feedMode = mode === 'phone' ? 'phone' : 'grid';
            const bGrid = document.getElementById('feed-mode-grid');
            const bPhone = document.getElementById('feed-mode-phone');
            if (bGrid) bGrid.className = state.feedMode === 'grid'
                ? 'bg-gray-900 text-white px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer'
                : 'text-gray-600 hover:bg-gray-100 px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer';
            if (bPhone) bPhone.className = state.feedMode === 'phone'
                ? 'bg-gray-900 text-white px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer'
                : 'text-gray-600 hover:bg-gray-100 px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer';
            renderFeedsView();
        }

        function toggleFeedReorder() {
            state.feedReorder = !state.feedReorder;
            const btn = document.getElementById('btn-feed-reorder');
            if (btn) {
                btn.className = state.feedReorder
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer'
                    : 'apple-btn-secondary px-4 py-2 text-xs flex items-center gap-1.5';
                btn.innerHTML = state.feedReorder
                    ? '<i class="ph ph-arrows-down-up"></i> Mode susun: ON'
                    : '<i class="ph ph-arrows-down-up"></i> Mode susun';
            }
            renderFeedsView();
        }

        function resetFeedOrder() {
            state.feedOrder = null;
            renderFeedsView();
            showToast("Urutan dikembalikan ke kronologis.");
        }

        /* ------------------------- model item feed ------------------------ */
        /* Satu bentuk item untuk terjadwal + live, supaya grid compact bisa
         * diurutkan kronologis gabungan dan HP bisa me-render keduanya. */

        function getFeedItems() {
            const scheduled = getFilteredContents()
                .filter(c => c.platform === state.feedPlatform && c.content_status !== 'Published')
                .map(c => ({
                    key: 'c_' + c.content_id,
                    kind: 'scheduled',
                    id: c.content_id,
                    title: c.content_title || '(Tanpa judul)',
                    caption: c.caption || '',
                    date: String(c.scheduled_date).split('T')[0],
                    time: cleanTimeStr(c.scheduled_time, '19:00'),
                    sortDate: String(c.scheduled_date).split('T')[0] + ' ' + cleanTimeStr(c.scheduled_time, '19:00'),
                    status: c.content_status || 'Planned',
                    brand: c.brand_name,
                    thumb: c.thumbnail_url || '',
                    views: 0, likes: 0, comments: 0
                }));
            const live = state.liveFeeds
                .filter(p => p.platform === state.feedPlatform)
                .map((p, i) => ({
                    key: 'l_' + (p.id || p.permalink || i),
                    kind: 'live',
                    id: p.id || '',
                    title: p.title || p.caption || '(Post live)',
                    caption: p.caption || '',
                    date: String(p.published_at || '').split('T')[0],
                    time: '',
                    sortDate: String(p.published_at || '').split('T')[0],
                    status: 'Live',
                    brand: '',
                    thumb: p.thumbnail || '',
                    permalink: p.permalink || '#',
                    views: p.views || 0, likes: p.likes || 0, comments: p.comments || 0
                }));
            return { scheduled, live };
        }

        /* Terjadwal dalam urutan tampil: feedOrder (bila mode susun pernah
         * dipakai) didahulukan, sisanya menempel di akhir secara kronologis. */
        function getOrderedScheduled() {
            const { scheduled } = getFeedItems();
            const byDate = scheduled.slice().sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)));
            if (!state.feedOrder || state.feedOrder.length === 0) return byDate;
            const byId = {};
            byDate.forEach(it => { byId[it.id] = it; });
            const ordered = [];
            state.feedOrder.forEach(id => { if (byId[id]) ordered.push(byId[id]); });
            byDate.forEach(it => { if (state.feedOrder.indexOf(it.id) === -1) ordered.push(it); });
            return ordered;
        }

        function ensureFeedOrder() {
            /* Saat pertama masuk mode susun, bekukan urutan kronologis saat
             * itu sebagai titik awal supaya drag/↑↓ punya array untuk diubah. */
            if (!state.feedOrder) state.feedOrder = getOrderedScheduled().map(it => it.id);
        }

        function moveFeedItem(contentId, dir) {
            ensureFeedOrder();
            const idx = state.feedOrder.indexOf(contentId);
            const swap = idx + dir;
            if (idx === -1 || swap < 0 || swap >= state.feedOrder.length) return;
            const tmp = state.feedOrder[idx];
            state.feedOrder[idx] = state.feedOrder[swap];
            state.feedOrder[swap] = tmp;
            renderFeedsView();
        }

        /* HTML5 drag-and-drop (desktop). Sentuh/HP memakai tombol ↑/↓. */
        function feedDragStart(ev, contentId) {
            if (!state.feedReorder) return;
            ev.dataTransfer.setData('text/plain', contentId);
            ev.dataTransfer.effectAllowed = 'move';
        }
        function feedDragOver(ev) {
            if (!state.feedReorder) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'move';
        }
        function feedDrop(ev, targetId) {
            if (!state.feedReorder) return;
            ev.preventDefault();
            const draggedId = ev.dataTransfer.getData('text/plain');
            if (!draggedId || draggedId === targetId) return;
            ensureFeedOrder();
            const from = state.feedOrder.indexOf(draggedId);
            if (from === -1) return;
            state.feedOrder.splice(from, 1);
            let to = state.feedOrder.indexOf(targetId);
            if (to === -1) to = state.feedOrder.length;
            state.feedOrder.splice(to, 0, draggedId);
            renderFeedsView();
        }

        function selectFeedItem(key) {
            state.feedSelected = key;
            renderFeedInspector();
            document.querySelectorAll('[data-feed-key]').forEach(el => {
                el.classList.toggle('feed-selected', el.getAttribute('data-feed-key') === key);
            });
        }

        /* ------------------------- render utama --------------------------- */

        function renderFeedsView() {
            const grid = document.getElementById('feeds-grid-container');
            const studio = document.getElementById('feeds-phone-studio');
            if (!grid) return;

            const conn = state.connections.find(c =>
                c.platform === state.feedPlatform && (state.activeBrand === 'ALL' || c.brand_name === state.activeBrand)
            );
            const brandLabel = state.activeBrand === 'ALL' ? 'All Brands' : state.activeBrand;

            document.getElementById('feed-profile-name').innerText = conn ? conn.username : `@${brandLabel.replace(/\s+/g, '')} (${state.feedPlatform})`;
            document.getElementById('feed-profile-avatar').innerText = brandLabel.charAt(0).toUpperCase();
            const badge = document.getElementById('feed-conn-badge');
            if (conn) {
                badge.innerText = `✓ Terhubung (${conn.brand_name})`;
                badge.className = "text-[10px] font-bold bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full";
            } else {
                badge.innerText = "Belum Terhubung OAuth";
                badge.className = "text-[10px] font-bold bg-gray-100 text-gray-600 px-2.5 py-0.5 rounded-full";
            }
            const statsEl = document.getElementById('feed-profile-stats');
            if (statsEl) {
                const { scheduled, live } = getFeedItems();
                const followers = state.liveAnalytics && state.liveAnalytics.byPlatform
                    && state.liveAnalytics.byPlatform[state.feedPlatform]
                    ? (state.liveAnalytics.byPlatform[state.feedPlatform].followers || 0) : null;
                statsEl.innerText = `${scheduled.length} terjadwal • ${live.length} live`
                    + (followers !== null ? ` • ${Number(followers).toLocaleString()} pengikut` : '');
            }

            const isPhone = state.feedMode === 'phone';
            if (grid) grid.classList.toggle('hidden', isPhone);
            if (studio) studio.classList.toggle('hidden', !isPhone);
            const reorderBtn = document.getElementById('btn-feed-reorder');
            if (reorderBtn) reorderBtn.classList.toggle('hidden', !isPhone);

            if (isPhone) {
                renderPhoneFeed();
                renderFeedOrderPanel();
                renderFeedInspector();
            } else {
                renderFeedCompact(grid);
            }
        }

        /* ------------------------- P0: grid compact ----------------------- */

        function renderFeedCompact(grid) {
            const { scheduled, live } = getFeedItems();
            /* Urutan gabungan kronologis (terjadwal + live) — sebelumnya
             * terjadwal dan live di-render terpisah tanpa urutan bersama. */
            const all = scheduled.concat(live).sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate)));

            if (all.length === 0) {
                grid.className = "apple-card p-12 text-center";
                grid.innerHTML = `
                    <i class="ph ph-squares-four text-4xl text-gray-300 mb-2"></i>
                    <h4 class="font-bold text-base text-gray-900">Belum ada feed untuk ${state.feedPlatform}</h4>
                    <p class="text-xs text-gray-500 mt-1">Buat jadwal post di Kalender/Buat Post atau klik "Tarik Feeds API" di pojok kanan atas.</p>
                `;
                return;
            }

            if (state.feedPlatform === 'Instagram') {
                /* Tile kecil ala profil IG: 3-5 kolom, ±120px per tile. */
                grid.className = "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5";
                grid.innerHTML = all.map(it => {
                    const inner = it.kind === 'scheduled'
                        ? `<div onclick="editPostInComposer('${it.id}')" class="feed-tile-compact aspect-square group" title="${esc(it.title)}">
                                ${it.thumb ? `<img src="${it.thumb}" class="w-full h-full object-cover group-hover:scale-105 transition">` : `<div class="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center p-2"><span class="text-white text-[11px] font-bold leading-snug line-clamp-3 text-center">${esc(it.title)}</span></div>`}
                                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 pt-4 flex items-end justify-between">
                                    <span class="text-white text-[9px] font-bold">${it.date} • ${it.status}</span>
                                    <button type="button" onclick="event.stopPropagation(); deletePostById('${it.id}')" class="bg-black/60 hover:bg-red-600 text-white w-5 h-5 rounded-full text-[10px] font-bold cursor-pointer">×</button>
                                </div>
                            </div>`
                        : `<a href="${esc(it.permalink)}" target="_blank" class="feed-tile-compact aspect-square group" title="${esc(it.title)}">
                                ${it.thumb ? `<img src="${it.thumb}" class="w-full h-full object-cover group-hover:scale-105 transition">` : `<div class="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center p-2"><span class="text-white text-[11px] font-bold leading-snug line-clamp-3 text-center">${esc(it.title)}</span></div>`}
                                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 pt-4 flex items-end justify-between">
                                    <span class="text-green-300 text-[9px] font-bold">✓ Live • ♥ ${it.likes.toLocaleString()}</span>
                                    <span class="text-white/80 text-[9px] font-semibold">${it.date}</span>
                                </div>
                            </a>`;
                    return inner;
                }).join('');
                return;
            }

            if (state.feedPlatform === 'Threads') {
                grid.className = "space-y-2";
                grid.innerHTML = all.map(it => it.kind === 'scheduled' ? `
                    <div onclick="editPostInComposer('${it.id}')" class="apple-card p-4 border-l-4 border-blue-600 cursor-pointer hover:bg-blue-50/20">
                        <div class="flex justify-between items-center text-xs mb-1.5">
                            <span class="font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">📅 Terjadwal: ${it.date} ${it.time}</span>
                            <span class="text-gray-400 font-semibold">${esc(it.brand)}</span>
                        </div>
                        <h4 class="font-bold text-sm text-gray-900">${esc(it.title)}</h4>
                        <p class="text-xs text-gray-600 mt-1 line-clamp-2">${esc(it.caption || '')}</p>
                    </div>
                ` : `
                    <div class="apple-card p-4 space-y-1.5">
                        <div class="flex justify-between items-center text-xs">
                            <span class="font-bold text-green-700 bg-green-50 px-2.5 py-0.5 rounded-full">✓ Live di Threads</span>
                            <span class="text-gray-400">${it.date}</span>
                        </div>
                        <p class="text-sm text-gray-800">${esc(it.caption)}</p>
                    </div>
                `).join('');
                return;
            }

            /* TikTok / YouTube: daftar vertikal rapat (thumbnail kecil 9:16
             * + judul 1 baris + meta), bukan kartu raksasa 320×570. */
            grid.className = "space-y-2";
            grid.innerHTML = all.map(it => it.kind === 'scheduled' ? `
                <div onclick="editPostInComposer('${it.id}')" class="feed-row-compact group">
                    <div class="w-12 shrink-0 aspect-[9/16] rounded-lg overflow-hidden bg-gray-900 flex items-center justify-center">
                        ${it.thumb ? `<img src="${it.thumb}" class="w-full h-full object-cover">` : `<span class="text-white text-[10px] font-bold px-1 text-center leading-tight line-clamp-3">${esc(it.title)}</span>`}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-bold text-xs text-gray-900 truncate">${esc(it.title)}</p>
                        <p class="text-[11px] text-gray-500 mt-0.5">📅 ${it.date} ${it.time} • ${it.status} • ${esc(it.brand)}</p>
                    </div>
                    <button type="button" onclick="event.stopPropagation(); deletePostById('${it.id}')" class="bg-black/5 hover:bg-red-600 hover:text-white text-gray-500 w-6 h-6 rounded-full text-xs font-bold cursor-pointer shrink-0">×</button>
                </div>
            ` : `
                <a href="${esc(it.permalink)}" target="_blank" class="feed-row-compact group">
                    <div class="w-12 shrink-0 aspect-[9/16] rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
                        ${it.thumb ? `<img src="${it.thumb}" class="w-full h-full object-cover">` : `<span class="text-white text-[10px] font-bold px-1 text-center leading-tight line-clamp-3">${esc(it.title)}</span>`}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-bold text-xs text-gray-900 truncate">${esc(it.title)}</p>
                        <p class="text-[11px] text-gray-500 mt-0.5">✓ Live • ${it.date} • ▶ ${(it.views || 0).toLocaleString()} • ♥ ${(it.likes || 0).toLocaleString()} • 💬 ${(it.comments || 0).toLocaleString()}</p>
                    </div>
                </a>
            `).join('');
        }

        /* ------------------------- P1: simulasi HP ------------------------ */

        function renderPhoneFeed() {
            const screen = document.getElementById('phone-screen');
            if (!screen) return;
            const { live } = getFeedItems();
            const ordered = getOrderedScheduled();
            const brandLabel = state.activeBrand === 'ALL' ? 'All Brands' : state.activeBrand;
            const conn = state.connections.find(c =>
                c.platform === state.feedPlatform && (state.activeBrand === 'ALL' || c.brand_name === state.activeBrand)
            );
            const userName = conn ? conn.username : '@' + brandLabel.replace(/\s+/g, '');
            const followers = state.liveAnalytics && state.liveAnalytics.byPlatform
                && state.liveAnalytics.byPlatform[state.feedPlatform]
                ? (state.liveAnalytics.byPlatform[state.feedPlatform].followers || 0) : null;

            if (ordered.length === 0 && live.length === 0) {
                screen.innerHTML = `
                    <div class="h-full flex flex-col items-center justify-center text-center p-8 bg-white">
                        <i class="ph ph-squares-four text-4xl text-gray-300 mb-2"></i>
                        <h4 class="font-bold text-sm text-gray-900">Belum ada feed untuk ${state.feedPlatform}</h4>
                        <p class="text-xs text-gray-500 mt-1">Buat jadwal post atau tarik feeds API dari tampilan Grid.</p>
                    </div>`;
                return;
            }

            if (state.feedPlatform === 'Instagram') {
                screen.innerHTML = `
                    <div class="bg-white h-full overflow-y-auto phone-screen-inner">
                        <div class="p-4 pt-10 flex items-center gap-3">
                            <div class="w-14 h-14 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-xl font-extrabold shrink-0">${brandLabel.charAt(0).toUpperCase()}</div>
                            <div class="flex-1 min-w-0">
                                <p class="font-extrabold text-sm text-gray-900 truncate">${esc(userName)}</p>
                                <p class="text-[11px] text-gray-500">${ordered.length + live.length} postingan${followers !== null ? ` • ${Number(followers).toLocaleString()} pengikut` : ''}</p>
                            </div>
                            <span class="text-[10px] font-bold ${conn ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'} px-2 py-1 rounded-full">${conn ? '✓ Terhubung' : 'Belum terhubung'}</span>
                        </div>
                        <div class="grid grid-cols-3 border-t border-gray-100 text-center text-[11px] font-bold text-gray-500">
                            <div class="py-2.5 border-b-2 border-gray-900 text-gray-900">Grid</div>
                            <div class="py-2.5">Reels</div>
                            <div class="py-2.5">Ditandai</div>
                        </div>
                        <div class="grid grid-cols-3 gap-0.5">
                            ${ordered.map(it => `
                                <div data-feed-key="${it.key}" draggable="${state.feedReorder}" ondragstart="feedDragStart(event, '${it.id}')" ondragover="feedDragOver(event)" ondrop="feedDrop(event, '${it.id}')" onclick="selectFeedItem('${it.key}')" class="feed-tile-compact aspect-square ${state.feedReorder ? 'cursor-move ring-2 ring-indigo-400' : 'cursor-pointer'}">
                                    ${it.thumb ? `<img src="${it.thumb}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center p-1"><span class="text-white text-[9px] font-bold leading-tight line-clamp-3 text-center">${esc(it.title)}</span></div>`}
                                    <span class="absolute top-1 left-1 bg-blue-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">📅 ${it.date}</span>
                                    ${state.feedReorder ? `<span class="absolute bottom-1 right-1 flex gap-0.5">
                                        <button type="button" onclick="event.stopPropagation(); moveFeedItem('${it.id}', -1)" class="bg-black/60 text-white w-5 h-5 rounded-full text-[10px] font-bold">↑</button>
                                        <button type="button" onclick="event.stopPropagation(); moveFeedItem('${it.id}', 1)" class="bg-black/60 text-white w-5 h-5 rounded-full text-[10px] font-bold">↓</button>
                                    </span>` : ''}
                                </div>`).join('')}
                            ${live.map(it => `
                                <a href="${esc(it.permalink)}" target="_blank" data-feed-key="${it.key}" class="feed-tile-compact aspect-square cursor-pointer opacity-90">
                                    ${it.thumb ? `<img src="${it.thumb}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center p-1"><span class="text-white text-[9px] font-bold leading-tight line-clamp-3 text-center">${esc(it.title)}</span></div>`}
                                    <span class="absolute top-1 left-1 bg-green-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">✓ Live</span>
                                </a>`).join('')}
                        </div>
                        <div class="phone-nav">
                            <i class="ph-fill ph-house text-xl"></i><i class="ph ph-magnifying-glass text-xl"></i>
                            <i class="ph ph-play-circle text-xl"></i><i class="ph ph-shopping-bag text-xl"></i>
                            <span class="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-[10px] font-extrabold">${brandLabel.charAt(0).toUpperCase()}</span>
                        </div>
                    </div>`;
                return;
            }

            if (state.feedPlatform === 'Threads') {
                const rows = ordered.concat(live);
                screen.innerHTML = `
                    <div class="bg-white h-full overflow-y-auto phone-screen-inner">
                        <div class="p-4 pt-10 flex items-center gap-3 border-b border-gray-100">
                            <div class="w-11 h-11 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-base font-extrabold shrink-0">${brandLabel.charAt(0).toUpperCase()}</div>
                            <div class="flex-1 min-w-0">
                                <p class="font-extrabold text-sm text-gray-900 truncate">${esc(userName)}</p>
                                <p class="text-[11px] text-gray-500">${ordered.length} terjadwal • ${live.length} live</p>
                            </div>
                        </div>
                        ${rows.map(it => `
                            <div data-feed-key="${it.key}" onclick="selectFeedItem('${it.key}')" class="phone-thread-row ${it.kind === 'scheduled' && state.feedReorder ? 'ring-2 ring-indigo-400 rounded-xl' : ''}">
                                <div class="w-9 h-9 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-xs font-extrabold shrink-0">${(it.brand || brandLabel).charAt(0).toUpperCase()}</div>
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-1.5 text-xs">
                                        <span class="font-bold text-gray-900">${esc(userName)}</span>
                                        <span class="text-gray-400">${it.date}${it.time ? ' ' + it.time : ''}</span>
                                        ${it.kind === 'scheduled' ? `<span class="text-blue-600 font-bold">📅 ${it.status}</span>` : `<span class="text-green-700 font-bold">✓ Live</span>`}
                                    </div>
                                    <p class="font-bold text-[13px] text-gray-900 mt-0.5">${esc(it.title)}</p>
                                    ${it.caption ? `<p class="text-xs text-gray-600 mt-0.5 line-clamp-3">${esc(it.caption)}</p>` : ''}
                                    <div class="flex items-center gap-4 text-gray-400 text-xs mt-2">
                                        <span>♥ ${it.kind === 'live' ? it.likes.toLocaleString() : '—'}</span>
                                        <span>💬 ${it.kind === 'live' ? it.comments.toLocaleString() : '—'}</span>
                                        <span>🔁</span><span>↗</span>
                                    </div>
                                    ${it.kind === 'scheduled' && state.feedReorder ? `<div class="flex gap-1 mt-2">
                                        <button type="button" onclick="event.stopPropagation(); moveFeedItem('${it.id}', -1)" class="apple-btn-secondary px-2.5 py-1 text-[11px]">↑ Naik</button>
                                        <button type="button" onclick="event.stopPropagation(); moveFeedItem('${it.id}', 1)" class="apple-btn-secondary px-2.5 py-1 text-[11px]">↓ Turun</button>
                                    </div>` : ''}
                                </div>
                            </div>`).join('')}
                    </div>`;
                return;
            }

            /* TikTok / YouTube Shorts: slide fullscreen per video, scroll-snap. */
            const slides = ordered.map(it => ({
                ...it,
                rail: `<span class="phone-rail-item"><span class="phone-rail-icon">♥</span><span class="text-[10px] font-bold">—</span></span>
                       <span class="phone-rail-item"><span class="phone-rail-icon">💬</span><span class="text-[10px] font-bold">—</span></span>
                       <span class="phone-rail-item"><span class="phone-rail-icon">↗</span><span class="text-[10px] font-bold">Bagikan</span></span>`,
                badge: `📅 ${it.date} ${it.time} • ${it.status}`
            })).concat(live.map(it => ({
                ...it,
                rail: `<span class="phone-rail-item"><span class="phone-rail-icon">♥</span><span class="text-[10px] font-bold">${it.likes.toLocaleString()}</span></span>
                       <span class="phone-rail-item"><span class="phone-rail-icon">💬</span><span class="text-[10px] font-bold">${it.comments.toLocaleString()}</span></span>
                       <span class="phone-rail-item"><span class="phone-rail-icon">↗</span><span class="text-[10px] font-bold">Bagikan</span></span>`,
                badge: `✓ Live • ${it.date}`
            })));
            screen.innerHTML = slides.map((it, i) => `
                <div class="phone-slide" data-feed-key="${it.key}" onclick="selectFeedItem('${it.key}')">
                    ${it.thumb ? `<img src="${it.thumb}" class="absolute inset-0 w-full h-full object-cover">` : `<div class="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-black"></div>`}
                    <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/40"></div>
                    <div class="absolute top-3 left-3 right-3 flex items-center justify-between">
                        <span class="bg-black/50 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full">${it.badge}</span>
                        <span class="bg-black/50 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full">${i + 1}/${slides.length}</span>
                    </div>
                    <div class="phone-rail">${it.rail}</div>
                    <div class="absolute bottom-0 inset-x-0 p-4 pb-6 text-white">
                        <p class="font-extrabold text-sm">${esc(userName)}</p>
                        <p class="font-bold text-[13px] leading-snug mt-1 line-clamp-2">${esc(it.title)}</p>
                        ${it.caption ? `<p class="text-xs text-white/80 mt-1 line-clamp-2">${esc(it.caption)}</p>` : ''}
                        ${it.kind === 'scheduled' && state.feedReorder ? `<div class="flex gap-2 mt-3">
                            <button type="button" onclick="event.stopPropagation(); moveFeedItem('${it.id}', -1)" class="bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-bold">↑ Naik</button>
                            <button type="button" onclick="event.stopPropagation(); moveFeedItem('${it.id}', 1)" class="bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-bold">↓ Turun</button>
                        </div>` : ''}
                        ${it.kind === 'scheduled' ? `<p class="text-[10px] text-white/60 mt-2">Terjadwal — ${esc(it.brand)}</p>` : ''}
                    </div>
                </div>`).join('');
        }

        function renderFeedOrderPanel() {
            const list = document.getElementById('feed-order-list');
            if (!list) return;
            const { live } = getFeedItems();
            const ordered = getOrderedScheduled();
            if (ordered.length === 0 && live.length === 0) {
                list.innerHTML = `<p class="text-xs text-gray-400 text-center py-4">Antrean kosong.</p>`;
                return;
            }
            list.innerHTML = ordered.map((it, i) => `
                <div data-feed-key="${it.key}" draggable="${state.feedReorder}" ondragstart="feedDragStart(event, '${it.id}')" ondragover="feedDragOver(event)" ondrop="feedDrop(event, '${it.id}')" onclick="selectFeedItem('${it.key}')" class="feed-order-row ${state.feedReorder ? 'cursor-move' : ''}">
                    <span class="text-[11px] font-extrabold text-gray-400 w-5 text-center shrink-0">${i + 1}</span>
                    ${state.feedReorder ? `<span class="text-gray-300 shrink-0">⋮⋮</span>` : ''}
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-bold text-gray-900 truncate">${esc(it.title)}</p>
                        <p class="text-[10px] text-gray-500">${it.date} ${it.time} • ${it.status}</p>
                    </div>
                    ${state.feedReorder ? `<span class="flex gap-0.5 shrink-0">
                        <button type="button" onclick="event.stopPropagation(); moveFeedItem('${it.id}', -1)" class="bg-gray-100 hover:bg-gray-200 w-6 h-6 rounded-full text-[11px] font-bold cursor-pointer">↑</button>
                        <button type="button" onclick="event.stopPropagation(); moveFeedItem('${it.id}', 1)" class="bg-gray-100 hover:bg-gray-200 w-6 h-6 rounded-full text-[11px] font-bold cursor-pointer">↓</button>
                    </span>` : ''}
                </div>`).join('')
                + (live.length > 0 ? `
                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-4 mb-1.5 px-1">🔒 Sudah tayang (terkunci)</p>
                ${live.map(it => `
                    <div data-feed-key="${it.key}" onclick="selectFeedItem('${it.key}')" class="feed-order-row opacity-70">
                        <span class="text-[11px] font-extrabold text-gray-300 w-5 text-center shrink-0">🔒</span>
                        <div class="flex-1 min-w-0">
                            <p class="text-xs font-bold text-gray-700 truncate">${esc(it.title)}</p>
                            <p class="text-[10px] text-gray-400">✓ Live • ${it.date}</p>
                        </div>
                    </div>`).join('')}` : '');
        }

        function renderFeedInspector() {
            const body = document.getElementById('feed-inspector-body');
            if (!body) return;
            const { scheduled, live } = getFeedItems();
            const all = scheduled.concat(live);
            const it = all.find(x => x.key === state.feedSelected) || all[0];
            if (!it) {
                body.innerHTML = `<p class="text-xs text-gray-400">Klik item di HP atau di panel urutan untuk melihat detailnya.</p>`;
                return;
            }
            body.innerHTML = `
                <div class="space-y-3">
                    ${it.thumb ? `<img src="${it.thumb}" class="w-full aspect-[9/16] max-h-56 object-cover rounded-xl bg-gray-100">` : ''}
                    <div>
                        <p class="text-[10px] font-bold uppercase tracking-wider ${it.kind === 'live' ? 'text-green-700' : 'text-blue-600'}">${it.kind === 'live' ? '✓ Live di ' + state.feedPlatform : '📅 Terjadwal • ' + it.status}</p>
                        <h4 class="font-extrabold text-sm text-gray-900 mt-1 leading-snug">${esc(it.title)}</h4>
                        ${it.caption ? `<p class="text-xs text-gray-600 mt-1.5 leading-relaxed line-clamp-4">${esc(it.caption)}</p>` : ''}
                    </div>
                    <div class="text-xs text-gray-600 space-y-1 bg-gray-50 p-3 rounded-xl border border-gray-100">
                        <p><strong>Tanggal:</strong> ${it.date}${it.time ? ' ' + it.time : ''}</p>
                        ${it.brand ? `<p><strong>Brand:</strong> ${esc(it.brand)}</p>` : ''}
                        ${it.kind === 'live' ? `<p><strong>Performa:</strong> ▶ ${(it.views || 0).toLocaleString()} • ♥ ${(it.likes || 0).toLocaleString()} • 💬 ${(it.comments || 0).toLocaleString()}</p>` : ''}
                    </div>
                    ${it.kind === 'scheduled' ? `
                    <div class="flex gap-2">
                        <button type="button" onclick="editPostInComposer('${it.id}')" class="apple-btn flex-1 py-2 text-xs">Edit di Buat Post</button>
                        <button type="button" onclick="deletePostById('${it.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 flex-1 py-2 rounded-xl text-xs font-bold cursor-pointer">Hapus</button>
                    </div>` : (it.permalink ? `
                    <a href="${esc(it.permalink)}" target="_blank" class="apple-btn-secondary block text-center py-2 text-xs">Buka post asli ↗</a>` : '')}
                </div>`;
        }
