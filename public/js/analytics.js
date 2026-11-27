// ContentPlan — js/analytics.js
// Dipecah dari public/index.html baris 1123-1242, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        // =========================================================================
        // ANALYTICS & RETENTION INSIGHTS
        // =========================================================================
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
            if (ctx) {
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

