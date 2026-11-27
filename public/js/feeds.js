// ContentPlan — js/feeds.js
// Dipecah dari public/index.html baris 858-1010, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        // =========================================================================
        // FEEDS & GRID PREVIEW
        // =========================================================================
        function setFeedPlatform(plat) {
            state.feedPlatform = plat;
            ['Instagram', 'TikTok', 'YouTube', 'Threads'].forEach(p => {
                const btn = document.getElementById('feed-tab-' + p);
                if (!btn) return;
                btn.className = p === plat
                    ? 'bg-gray-900 text-white px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer'
                    : 'text-gray-600 hover:bg-gray-100 px-3.5 py-1.5 rounded-full text-xs font-bold cursor-pointer';
            });
            renderFeedsView();
            fetchLivePlatformFeeds(false);
        }

        async function fetchLivePlatformFeeds(showNotif = true) {
            const btn = document.getElementById('btn-sync-feeds');
            if (btn) { btn.innerText = "Menarik Feeds..."; btn.disabled = true; }

            try {
                const res = await fetch(`/api/social-sync?mode=feeds&brand=${encodeURIComponent(state.activeBrand)}&platform=${encodeURIComponent(state.feedPlatform)}`);
                const json = await safeJsonResponse(res);
                if (json.success) {
                    state.liveFeeds = json.posts || [];
                    renderFeedsView();
                    if (showNotif) showToast(`Berhasil menarik ${state.liveFeeds.length} post dari ${state.feedPlatform}!`);
                } else if (showNotif) {
                    showToast("Gagal menarik feeds: " + (json.error || "Cek koneksi OAuth"), true);
                }
            } catch (e) {
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

        function renderFeedsView() {
            const grid = document.getElementById('feeds-grid-container');
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

            const scheduledPosts = getFilteredContents()
                .filter(c => c.platform === state.feedPlatform && c.content_status !== 'Published')
                .sort((a, b) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)));

            const livePosts = state.liveFeeds.filter(p => p.platform === state.feedPlatform);

            if (state.feedPlatform === 'Threads') {
                grid.className = "space-y-3";
            } else {
                grid.className = "grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4";
            }

            grid.innerHTML = '';

            scheduledPosts.forEach(c => {
                const tClean = cleanTimeStr(c.scheduled_time, '19:00');
                const dClean = String(c.scheduled_date).split('T')[0];

                if (state.feedPlatform === 'Threads') {
                    grid.innerHTML += `
                        <div onclick="editPostInComposer('${c.content_id}')" class="apple-card p-5 border-l-4 border-blue-600 cursor-pointer hover:bg-blue-50/20">
                            <div class="flex justify-between items-center text-xs mb-2">
                                <span class="font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">📅 Terjadwal: ${dClean} ${tClean}</span>
                                <span class="text-gray-400 font-semibold">${c.brand_name}</span>
                            </div>
                            <h4 class="font-bold text-sm text-gray-900">${c.content_title}</h4>
                            <p class="text-xs text-gray-600 mt-1 line-clamp-2">${c.caption || ''}</p>
                        </div>
                    `;
                } else {
                    const aspect = state.feedPlatform === 'Instagram' ? 'aspect-square' : 'aspect-[9/16]';
                    grid.innerHTML += `
                        <div onclick="editPostInComposer('${c.content_id}')" class="apple-card overflow-hidden relative ${aspect} bg-gray-900 text-white group cursor-pointer border-2 border-blue-500">
                            ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" class="w-full h-full object-cover opacity-80 group-hover:scale-105 transition">` : ''}
                            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent p-3 flex flex-col justify-between">
                                <div class="flex justify-between items-start gap-1">
                                    <span class="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">📅 ${dClean} ${tClean}</span>
                                    <button type="button" onclick="event.stopPropagation(); deletePostById('${c.content_id}')" class="bg-black/60 hover:bg-red-600 text-white w-6 h-6 rounded-full text-xs font-bold cursor-pointer">×</button>
                                </div>
                                <div>
                                    <span class="text-[10px] text-blue-300 font-bold uppercase">${c.content_status}</span>
                                    <p class="font-bold text-xs leading-snug line-clamp-2 mt-0.5">${c.content_title}</p>
                                </div>
                            </div>
                        </div>
                    `;
                }
            });

            livePosts.forEach(p => {
                if (state.feedPlatform === 'Threads') {
                    grid.innerHTML += `
                        <div class="apple-card p-5 space-y-2">
                            <div class="flex justify-between items-center text-xs">
                                <span class="font-bold text-green-700 bg-green-50 px-2.5 py-0.5 rounded-full">✓ Live di Threads</span>
                                <span class="text-gray-400">${String(p.published_at).split('T')[0]}</span>
                            </div>
                            <p class="text-sm text-gray-800">${p.caption}</p>
                        </div>
                    `;
                } else {
                    const aspect = state.feedPlatform === 'Instagram' ? 'aspect-square' : 'aspect-[9/16]';
                    grid.innerHTML += `
                        <a href="${p.permalink || '#'}" target="_blank" class="apple-card overflow-hidden relative ${aspect} bg-gray-800 text-white group block">
                            ${p.thumbnail ? `<img src="${p.thumbnail}" class="w-full h-full object-cover group-hover:scale-105 transition">` : ''}
                            <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/30 p-3 flex flex-col justify-between">
                                <span class="bg-black/60 backdrop-blur-sm text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-full self-start">✓ Live</span>
                                <div>
                                    <p class="font-bold text-xs line-clamp-2">${p.title}</p>
                                    <div class="flex items-center gap-3 text-[10px] text-gray-300 mt-1 font-semibold">
                                        ${p.views > 0 ? `<span>▶ ${p.views.toLocaleString()}</span>` : ''}
                                        <span>♥ ${p.likes.toLocaleString()}</span>
                                        <span>💬 ${p.comments.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        </a>
                    `;
                }
            });

            if (scheduledPosts.length === 0 && livePosts.length === 0) {
                grid.className = "apple-card p-12 text-center";
                grid.innerHTML = `
                    <i class="ph ph-squares-four text-4xl text-gray-300 mb-2"></i>
                    <h4 class="font-bold text-base text-gray-900">Belum ada feed untuk ${state.feedPlatform}</h4>
                    <p class="text-xs text-gray-500 mt-1">Buat jadwal post di Kalender/Buat Post atau klik "Tarik Feeds API" di pojok kanan atas.</p>
                `;
            }
        }

