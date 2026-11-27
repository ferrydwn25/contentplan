// ContentPlan — js/oauth.js
// Dipecah dari public/index.html baris 752-857, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        function updateSwipeDNAIndicator() {
            const el = document.getElementById('swipe-dna-indicator');
            const sel = document.getElementById('swipe-brand');
            if (!el || !sel) return;
            const b = state.brands.find(x => x.brand_name === sel.value);
            if (b) {
                el.innerHTML = `<i class="ph-fill ph-brain"></i> DNA Aktif: ${esc(b.brand_name)} • Mood: ${esc(b.mood || b.tone_of_voice || 'Default')}`;
            }
        }

        // =========================================================================
        // OAUTH CONNECTIONS ("Posting ke")
        // =========================================================================
        function connectOAuthPlatform(platform) {
            const targetBrand = state.activeBrand === 'ALL'
                ? (state.brands[0] ? state.brands[0].brand_name : 'Bacon Files')
                : state.activeBrand;
            window.location.href = `/api/oauth?action=connect&platform=${encodeURIComponent(platform)}&brand=${encodeURIComponent(targetBrand)}`;
        }

        async function disconnectOAuth(connId, platformName) {
            const conn = state.connections.find(c => c.conn_id === connId);
            const label = conn ? `${conn.username} (${platformName || conn.platform})` : (platformName || 'OAuth');
            if (!await confirmDialog(`Putuskan koneksi ${label}? Feeds, analitik, dan auto-publish dari akun ini akan berhenti.`, 'Ya, putuskan')) return;
            const res = await apiPost('disconnect_oauth', { connId });
            if (res.success) {
                showToast(`Koneksi ${platformName || 'OAuth'} berhasil dibatalkan!`);
                bootstrapApp();
            } else {
                showToast("Gagal memutuskan koneksi: " + (res.error || "Error"), true);
            }
        }

        function renderSidebarOAuth() {
            const container = document.getElementById('sidebar-oauth-list');
            if (!container) return;
            const platforms = [
                { name: 'Instagram', icon: 'ph-instagram-logo' },
                { name: 'TikTok', icon: 'ph-tiktok-logo' },
                { name: 'Threads', icon: 'ph-at' },
                { name: 'YouTube', icon: 'ph-youtube-logo' }
            ];
            container.innerHTML = '';

            platforms.forEach(p => {
                const matchingConns = state.connections.filter(c =>
                    c.platform === p.name && (state.activeBrand === 'ALL' || c.brand_name === state.activeBrand)
                );

                if (matchingConns.length > 0) {
                    const accountBadges = matchingConns.map(c => {
                        const label = state.activeBrand === 'ALL'
                            ? `${c.username} (${c.brand_name})`
                            : c.username;
                        return `
                            <div class="flex items-center justify-between gap-1 bg-green-50 border border-green-200 text-green-800 rounded-lg px-2 py-1 mt-1">
                                <span class="text-[10px] font-bold truncate" title="${esc(label)}">✓ ${esc(label)}</span>
                                <button type="button" onclick="disconnectOAuth('${c.conn_id}', '${p.name}')" class="text-red-500 hover:text-red-700 font-extrabold text-xs px-1 cursor-pointer" title="Batalkan / Putuskan koneksi ${esc(c.username)}">×</button>
                            </div>
                        `;
                    }).join('');

                    container.innerHTML += `
                        <div class="py-1 px-1">
                            <div class="flex items-center justify-between">
                                <span class="text-xs font-bold text-gray-800 flex items-center gap-2"><i class="ph-fill ${p.icon} text-base text-green-600"></i> ${p.name}</span>
                                <button type="button" onclick="connectOAuthPlatform('${p.name}')" class="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer">+ Akun</button>
                            </div>
                            ${accountBadges}
                        </div>
                    `;
                } else {
                    container.innerHTML += `
                        <div class="flex items-center justify-between py-1 px-1">
                            <span class="text-xs font-medium text-gray-600 flex items-center gap-2"><i class="ph ${p.icon} text-base"></i> ${p.name}</span>
                            <button type="button" onclick="connectOAuthPlatform('${p.name}')" class="bg-gray-900 hover:bg-black text-white text-[11px] font-bold px-3 py-1 rounded-full cursor-pointer">Hubungkan</button>
                        </div>
                    `;
                }
            });
        }

        function renderSettingsOAuthCards() {
            const container = document.getElementById('settings-oauth-cards');
            if (!container) return;
            const platforms = ['Instagram', 'TikTok', 'Threads', 'YouTube'];
            container.innerHTML = '';

            platforms.forEach(p => {
                const conn = state.connections.find(c =>
                    c.platform === p && (state.activeBrand === 'ALL' || c.brand_name === state.activeBrand)
                );
                container.innerHTML += `
                    <div class="apple-card p-6 flex flex-col justify-between gap-4">
                        <div class="flex justify-between items-center">
                            <h4 class="font-bold text-base text-gray-900">Koneksi ${p}</h4>
                            ${conn
                                ? `<button type="button" onclick="disconnectOAuth('${conn.conn_id}', '${p}')" class="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer">Cancel Hubungkan (${esc(conn.username)})</button>`
                                : `<button type="button" onclick="connectOAuthPlatform('${p}')" class="bg-gray-900 text-white px-4 py-2 rounded-full text-xs font-bold cursor-pointer">Hubungkan ${p}</button>`
                            }
                        </div>
                        <p class="text-xs text-gray-500 leading-relaxed">
                            Sekali tersambung via OAuth 2.0, sistem otomatis menarik feeds, metrik analitik, komentar masuk, dan auto-publish sesuai slot jadwal.
                        </p>
                    </div>
                `;
            });
        }

