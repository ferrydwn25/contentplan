// ContentPlan — js/composer.js
// Dipecah dari public/index.html baris 1333-1533, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        function renderComposerQueue() {
            const container = document.getElementById('composer-queue-list');
            if (!container) return;
            const list = getFilteredContents().filter(c => c.content_status !== 'Published');
            container.innerHTML = list.length === 0 ? `<p class="text-xs text-gray-400 text-center py-6">Antrean kosong.</p>` : '';
            list.forEach(c => {
                const tClean = cleanTimeStr(c.scheduled_time, '');
                container.innerHTML += `
                    <div class="p-3 rounded-xl border border-gray-100 hover:border-blue-400 bg-gray-50 flex items-start justify-between gap-2 group">
                        <div onclick="editPostInComposer('${c.content_id}')" class="flex-1 min-w-0 cursor-pointer">
                            <div class="flex justify-between text-[10px] font-bold text-gray-400 mb-1"><span>${c.platform}</span><span>${String(c.scheduled_date).split('T')[0]} ${tClean}</span></div>
                            <p class="text-xs font-bold text-gray-900 line-clamp-2">${c.content_title}</p>
                        </div>
                        <button type="button" onclick="deletePostById('${c.content_id}')" class="text-gray-400 hover:text-red-600 p-1 cursor-pointer" title="Hapus post"><i class="ph ph-trash text-sm"></i></button>
                    </div>
                `;
            });
        }

        function openNewComposerPost() {
            document.getElementById('comp-mode-title').innerText = "Buat post";
            document.getElementById('comp-id').value = "";
            document.getElementById('btn-comp-delete').classList.add('hidden');
            document.getElementById('comp-title').value = "";
            document.getElementById('comp-caption').value = "";
            document.getElementById('comp-thumb-url').value = "";
            document.getElementById('comp-status').value = "Ready";
            document.getElementById('comp-date').value = localDateStr(new Date());
            document.getElementById('comp-time').value = "19:00";
            if (state.activeBrand !== 'ALL') document.getElementById('comp-brand').value = state.activeBrand;
            updateLivePreview();
            navigate('composer');
        }

        function openComposerForSlot(dateStr, timeStr, brandName) {
            openNewComposerPost();
            document.getElementById('comp-date').value = dateStr;
            document.getElementById('comp-time').value = cleanTimeStr(timeStr, "19:00");
            if (brandName) document.getElementById('comp-brand').value = brandName;
            updateLivePreview();
        }

        function editPostInComposer(contentId) {
            const c = state.contents.find(x => x.content_id === contentId);
            if (!c) return;
            document.getElementById('comp-mode-title').innerText = "Edit post";
            document.getElementById('comp-id').value = c.content_id;
            document.getElementById('btn-comp-delete').classList.remove('hidden');
            if (c.brand_name) document.getElementById('comp-brand').value = c.brand_name;
            document.getElementById('comp-platform').value = c.platform || "YouTube";
            document.getElementById('comp-pillar').value = c.content_pillar || "Edukasi";
            document.getElementById('comp-status').value = c.content_status || "Ready";
            document.getElementById('comp-title').value = c.content_title || "";
            document.getElementById('comp-caption').value = c.caption || "";
            document.getElementById('comp-thumb-url').value = c.thumbnail_url || "";
            document.getElementById('comp-date').value = String(c.scheduled_date).split('T')[0];
            document.getElementById('comp-time').value = cleanTimeStr(c.scheduled_time, "19:00");
            updateLivePreview();
            navigate('composer');
        }

        async function deletePostById(contentId) {
            if (!contentId) return;
            const res = await apiPost('delete_post', { contentId });
            if (res.success) {
                showToast("Postingan berhasil dihapus!");
                if (document.getElementById('comp-id').value === contentId) openNewComposerPost();
                bootstrapApp();
            } else {
                showToast("Gagal menghapus post: " + (res.error || "Error"), true);
            }
        }

        function deleteCurrentComposerPost() {
            const id = document.getElementById('comp-id').value;
            if (id) deletePostById(id);
        }

        function updateLivePreview() {
            const brand = document.getElementById('comp-brand').value || "Brand";
            const platform = document.getElementById('comp-platform').value || "YouTube";
            const title = document.getElementById('comp-title').value || "Judul / Hook konten...";
            const caption = document.getElementById('comp-caption').value || "Caption postingan...";
            const imgUrl = document.getElementById('comp-thumb-url').value.trim();

            document.getElementById('prev-platform-badge').innerText = platform;
            document.getElementById('prev-avatar').innerText = brand.charAt(0).toUpperCase();
            document.getElementById('prev-username').innerText = "@" + brand.replace(/\s+/g, '');
            document.getElementById('prev-title').innerText = title;
            document.getElementById('prev-caption').innerText = caption;

            const imgEl = document.getElementById('prev-bg-img');
            const emptyEl = document.getElementById('prev-empty-media');
            if (imgUrl) {
                imgEl.src = imgUrl;
                imgEl.classList.remove('hidden');
                emptyEl.classList.add('hidden');
            } else {
                imgEl.classList.add('hidden');
                emptyEl.classList.remove('hidden');
            }
        }

        async function runComposerAI() {
            const prompt = document.getElementById('comp-ai-prompt').value.trim();
            if (!prompt) return showToast("Ceritain dulu ide post yang kamu mau!", true);
            const btn = document.getElementById('btn-comp-ai');
            btn.innerText = "Meracik...";
            btn.disabled = true;
            const res = await apiPost('ai_caption', {
                prompt,
                brandName: document.getElementById('comp-brand').value,
                platform: document.getElementById('comp-platform').value
            });
            btn.innerText = "Generate";
            btn.disabled = false;
            if (res.success) {
                document.getElementById('comp-title').value = res.title;
                document.getElementById('comp-caption').value = res.caption;
                updateLivePreview();
                showToast("Draft hook & caption diracik dari Brand DNA!");
            } else {
                showToast("Gagal generate: " + res.error, true);
            }
        }

        async function submitComposerPost(autoQueue) {
            const payload = {
                content_id: document.getElementById('comp-id').value,
                brand_name: document.getElementById('comp-brand').value,
                platform: document.getElementById('comp-platform').value,
                content_pillar: document.getElementById('comp-pillar').value,
                content_status: document.getElementById('comp-status').value,
                content_title: document.getElementById('comp-title').value.trim(),
                caption: document.getElementById('comp-caption').value,
                thumbnail_url: document.getElementById('comp-thumb-url').value,
                scheduled_date: document.getElementById('comp-date').value,
                scheduled_time: document.getElementById('comp-time').value
            };
            if (!payload.brand_name) return showToast("Pilih atau buat brand dulu!", true);
            if (!payload.content_title) return showToast("Judul / Hook tidak boleh kosong!", true);

            const btn = document.getElementById(autoQueue ? 'btn-save-queue' : 'btn-save-manual');
            const origText = btn.innerHTML;
            btn.innerText = "Menyimpan...";
            btn.disabled = true;

            const res = await apiPost('save_composer_post', { payload, autoQueue });
            btn.innerHTML = origText;
            btn.disabled = false;

            if (res.success) {
                if (autoQueue) {
                    if (res.autoQueued) {
                        showToast(`Dijadwalkan ke slot berikutnya: ${res.scheduled_date} jam ${res.scheduled_time}`);
                    } else {
                        /* GAS lama (sebelum deploy v10) belum mengenal autoQueue:
                         * post tersimpan di jadwal form, bukan slot berikutnya. */
                        showToast(`Tersimpan di jadwal form — auto-queue belum aktif di GAS (perlu deploy v10). Jadwal: ${res.scheduled_date} jam ${res.scheduled_time}`, true);
                    }
                } else {
                    showToast(`Tersimpan! Jadwal: ${res.scheduled_date} jam ${res.scheduled_time}`);
                }
                await bootstrapApp();
                navigate('calendar');
            } else {
                showToast("Gagal menyimpan: " + (res.error || "Error"), true);
            }
        }

        function populateComposerAssetDropdown() {
            const sel = document.getElementById('comp-asset-select');
            if (!sel) return;
            sel.innerHTML = '<option value="">-- Pilih dari Perpustakaan Aset --</option>';
            state.assets.forEach(a => {
                sel.innerHTML += `<option value="${a.file_url}">${a.file_name}</option>`;
            });
        }

        function selectAssetForComposer() {
            document.getElementById('comp-thumb-url').value = document.getElementById('comp-asset-select').value;
            updateLivePreview();
        }

        function handleDriveFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;
            document.getElementById('upload-idle-state').classList.add('hidden');
            document.getElementById('upload-loading-state').classList.remove('hidden');

            const reader = new FileReader();
            reader.onload = async function(e) {
                const brandName = state.activeBrand === 'ALL' ? 'General' : state.activeBrand;
                const res = await apiPost('upload_asset', {
                    base64Data: e.target.result,
                    fileName: file.name,
                    mimeType: file.type,
                    brandName
                });
                document.getElementById('upload-idle-state').classList.remove('hidden');
                document.getElementById('upload-loading-state').classList.add('hidden');
                if (res.success) {
                    showToast("Aset berhasil diunggah ke Google Drive!");
                    bootstrapApp();
                } else {
                    showToast("Gagal upload: " + res.error, true);
                }
            };
            reader.readAsDataURL(file);
        }

