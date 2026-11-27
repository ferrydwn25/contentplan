// ContentPlan — js/inbox.js
// Dipecah dari public/index.html baris 1011-1122, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        // =========================================================================
        // UNIFIED INBOX ("Balasan")
        // =========================================================================
        async function syncInboxFromApis() {
            const btn = document.getElementById('btn-sync-inbox');
            btn.innerText = "Menarik Komentar...";
            btn.disabled = true;

            try {
                const res = await fetch(`/api/social-sync?mode=sync_inbox&brand=${encodeURIComponent(state.activeBrand)}`);
                const json = await safeJsonResponse(res);
                if (json.success) {
                    showToast(`Sinkronisasi selesai! ${json.fetchedCount} komentar diperiksa dari API.`);
                    await bootstrapApp();
                } else {
                    showToast("Gagal sinkronisasi: " + (json.error || "Cek koneksi OAuth"), true);
                }
            } catch (e) {
                showToast("Error API Inbox: " + e.message, true);
            } finally {
                btn.innerHTML = `<i class="ph ph-arrows-clockwise"></i> Sinkronkan Komentar API`;
                btn.disabled = false;
            }
        }

        function setInboxFilter(status) {
            state.inboxFilter = status;
            document.getElementById('tab-inbox-unreplied').className = status === 'Unreplied'
                ? 'bg-gray-900 text-white px-4 py-2 rounded-full text-xs font-bold'
                : 'apple-btn-secondary px-4 py-2 rounded-full text-xs font-bold';
            document.getElementById('tab-inbox-replied').className = status === 'Replied'
                ? 'bg-gray-900 text-white px-4 py-2 rounded-full text-xs font-bold'
                : 'apple-btn-secondary px-4 py-2 rounded-full text-xs font-bold';
            renderUnifiedInbox();
        }

        function renderUnifiedInbox() {
            const container = document.getElementById('inbox-list-container');
            const badge = document.getElementById('inbox-badge');
            if (!container) return;

            const brandFiltered = state.activeBrand === 'ALL' ? state.inbox : state.inbox.filter(m => m.brand_name === state.activeBrand);
            const unrepliedCount = brandFiltered.filter(m => m.status === 'Unreplied').length;

            if (badge) {
                if (unrepliedCount > 0) {
                    badge.innerText = unrepliedCount;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }

            const list = brandFiltered.filter(m => m.status === state.inboxFilter);
            container.innerHTML = '';

            if (list.length === 0) {
                container.innerHTML = `
                    <div class="apple-card p-12 text-center">
                        <h4 class="font-bold text-base text-gray-900">Antrean kosong</h4>
                        <p class="text-xs text-gray-500 mt-1">Klik "Sinkronkan Komentar API" untuk menarik komentar terbaru dari akun yang terhubung.</p>
                    </div>
                `;
                return;
            }

            list.forEach(m => {
                container.innerHTML += `
                    <div class="apple-card p-5 space-y-3">
                        <div class="flex justify-between items-center text-xs">
                            <span class="font-bold text-gray-900">${esc(m.sender_username)} <span class="text-blue-600 font-semibold">• ${esc(m.platform)}</span> <span class="text-gray-400 font-normal">(${esc(m.brand_name)})</span></span>
                            <span class="text-gray-400">${String(m.received_at).split('T')[0]}</span>
                        </div>
                        <p class="text-sm text-gray-800 bg-gray-50 p-3 rounded-xl">"${esc(m.comment_text)}"</p>
                        ${m.status === 'Unreplied' ? `
                            <div class="flex gap-2">
                                <input type="text" id="reply-input-${m.msg_id}" class="apple-input text-xs" placeholder="Tulis balasan langsung ke ${esc(m.platform)}...">
                                <button type="button" onclick="sendInboxReply('${m.msg_id}')" class="bg-gray-900 text-white px-4 py-2 rounded-xl text-xs font-bold cursor-pointer">Balas</button>
                            </div>
                        ` : `
                            <p class="text-xs text-green-700 font-semibold">✓ Dibalas: "${esc(m.reply_text)}"</p>
                        `}
                    </div>
                `;
            });
        }

        async function sendInboxReply(msgId) {
            const input = document.getElementById(`reply-input-${msgId}`);
            if (!input || !input.value.trim()) return;
            const replyText = input.value.trim();
            /* platform/brand diambil dari state, bukan disisipkan ke string
             * onclick — nama brand bisa mengandung ' yang merusak handler. */
            const item = state.inbox.find(m => String(m.msg_id) === String(msgId)) || {};
            const platform = item.platform || '';
            const brandName = item.brand_name || '';

            const res = await fetch('/api/social-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'send_reply',
                    msgId,
                    platform,
                    brand: brandName,
                    replyText
                })
            });
            const json = await safeJsonResponse(res);
            if (json.success) {
                showToast(json.apiSent ? `Balasan terkirim langsung ke ${platform}!` : "Balasan disimpan di antrean.");
                bootstrapApp();
            } else {
                showToast("Gagal membalas: " + (json.error || "Error"), true);
            }
        }

