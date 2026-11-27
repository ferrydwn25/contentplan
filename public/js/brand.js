// ContentPlan — js/brand.js
// Dipecah dari public/index.html baris 1582-1743, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        function renderBrandContextCards() {
            const container = document.getElementById('brand-context-cards');
            if (!container) return;
            container.innerHTML = '';
            if (state.brands.length === 0) {
                container.innerHTML = `<div class="col-span-full apple-card p-8 text-center text-xs text-gray-500">Belum ada brand. Klik "+ Tambah Brand Baru" di atas.</div>`;
                return;
            }
            state.brands.forEach(b => {
                container.innerHTML += `
                    <div class="apple-card p-5 flex flex-col justify-between gap-4">
                        <div class="space-y-2.5">
                            <div class="flex justify-between items-start gap-2">
                                <div>
                                    <h4 class="font-extrabold text-base text-gray-900">${b.brand_name}</h4>
                                    <span class="text-[11px] bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-bold inline-block mt-1">${b.niche || 'General'}</span>
                                </div>
                                <div class="flex gap-1">
                                    <button type="button" onclick="editBrandForm('${b.brand_id}')" class="p-2 text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer" title="Edit Brand DNA"><i class="ph ph-pencil-simple"></i></button>
                                    <button type="button" onclick="deleteBrandItem('${b.brand_id}', '${b.brand_name}')" class="p-2 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer" title="Hapus Brand"><i class="ph ph-trash"></i></button>
                                </div>
                            </div>
                            <div class="text-xs text-gray-600 space-y-1 bg-gray-50 p-3 rounded-xl border border-gray-100">
                                <p><strong>Mood:</strong> ${b.mood || '-'}</p>
                                <p><strong>Gaya Narasi:</strong> ${b.narrative_style || '-'}</p>
                                <p><strong>Guidelines:</strong> ${b.guidelines || '-'}</p>
                            </div>
                            ${b.learned_patterns ? `
                                <div class="text-[11px] bg-indigo-50/70 text-indigo-800 p-2.5 rounded-xl border border-indigo-100">
                                    <strong><i class="ph-fill ph-sparkle"></i> Hasil Learning:</strong> ${b.learned_patterns}
                                </div>
                            ` : ''}
                        </div>
                        <button type="button" onclick="triggerAutoLearn('${b.brand_name}', this)" class="apple-btn-secondary w-full py-2 text-xs flex items-center justify-center gap-1.5">
                            <i class="ph ph-brain"></i> Pelajari dari Postingan Sebelumnya
                        </button>
                    </div>
                `;
            });
        }

        function openNewBrandForm() {
            document.getElementById('brand-modal-title').innerText = "Tambah Brand Baru";
            document.getElementById('bc-id').value = '';
            document.getElementById('bc-name').value = '';
            document.getElementById('bc-niche').value = '';
            document.getElementById('bc-mood').value = '';
            document.getElementById('bc-tone').value = '';
            document.getElementById('bc-audience').value = '';
            document.getElementById('bc-narrative').value = '';
            document.getElementById('bc-guidelines').value = '';
            document.getElementById('bc-hooks').value = '';
            document.getElementById('bc-hook').value = '';
            document.getElementById('bc-pillar-edukasi').value = '';
            document.getElementById('bc-pillar-cerita').value = '';
            document.getElementById('bc-pillar-hiburan').value = '';
            document.getElementById('bc-pillar-bts').value = '';
            document.getElementById('bc-pillar-interaksi').value = '';
            document.getElementById('bc-pillar-mitos').value = '';
            document.getElementById('brand-modal').classList.remove('hidden');
            document.getElementById('brand-modal').classList.add('flex');
        }

        function editBrandForm(brandId) {
            const b = state.brands.find(x => x.brand_id === brandId);
            if (!b) return;
            let pMap = {};
            try { pMap = JSON.parse(b.pillar_learning || '{}'); } catch (e) {}

            document.getElementById('brand-modal-title').innerText = `Edit DNA: ${b.brand_name}`;
            document.getElementById('bc-id').value = b.brand_id;
            document.getElementById('bc-name').value = b.brand_name || '';
            document.getElementById('bc-niche').value = b.niche || '';
            document.getElementById('bc-mood').value = b.mood || '';
            document.getElementById('bc-tone').value = b.tone_of_voice || '';
            document.getElementById('bc-audience').value = b.target_audience || '';
            document.getElementById('bc-narrative').value = b.narrative_style || '';
            document.getElementById('bc-guidelines').value = b.guidelines || '';
            document.getElementById('bc-hooks').value = b.hook_formulas || '';
            document.getElementById('bc-hook').value = b.product_or_core_hook || '';
            document.getElementById('bc-pillar-edukasi').value = pMap['Edukasi'] || '';
            document.getElementById('bc-pillar-cerita').value = pMap['Cerita Brand'] || '';
            document.getElementById('bc-pillar-hiburan').value = pMap['Hiburan'] || '';
            document.getElementById('bc-pillar-bts').value = pMap['Behind The Scenes'] || '';
            document.getElementById('bc-pillar-interaksi').value = pMap['Interaksi'] || '';
            document.getElementById('bc-pillar-mitos').value = pMap['Mitos vs Fakta'] || '';
            document.getElementById('brand-modal').classList.remove('hidden');
            document.getElementById('brand-modal').classList.add('flex');
        }

        function closeBrandModal() {
            document.getElementById('brand-modal').classList.add('hidden');
            document.getElementById('brand-modal').classList.remove('flex');
        }

        async function submitBrandContext() {
            const brandName = document.getElementById('bc-name').value.trim();
            if (!brandName) return showToast("Nama Brand wajib diisi!", true);

            const btn = document.getElementById('btn-save-brand');
            btn.innerText = "Menyimpan...";
            btn.disabled = true;

            const pillarLearningObj = {
                "Edukasi": document.getElementById('bc-pillar-edukasi').value.trim(),
                "Cerita Brand": document.getElementById('bc-pillar-cerita').value.trim(),
                "Hiburan": document.getElementById('bc-pillar-hiburan').value.trim(),
                "Behind The Scenes": document.getElementById('bc-pillar-bts').value.trim(),
                "Interaksi": document.getElementById('bc-pillar-interaksi').value.trim(),
                "Mitos vs Fakta": document.getElementById('bc-pillar-mitos').value.trim()
            };

            const res = await apiPost('save_brand_context', {
                payload: {
                    brand_id: document.getElementById('bc-id').value,
                    brand_name: brandName,
                    niche: document.getElementById('bc-niche').value,
                    mood: document.getElementById('bc-mood').value,
                    tone_of_voice: document.getElementById('bc-tone').value,
                    target_audience: document.getElementById('bc-audience').value,
                    narrative_style: document.getElementById('bc-narrative').value,
                    guidelines: document.getElementById('bc-guidelines').value,
                    hook_formulas: document.getElementById('bc-hooks').value,
                    product_or_core_hook: document.getElementById('bc-hook').value,
                    pillar_learning: JSON.stringify(pillarLearningObj)
                }
            });

            btn.innerText = "Simpan Brand DNA";
            btn.disabled = false;

            if (res.success) {
                closeBrandModal();
                showToast(`Brand DNA "${brandName}" berhasil disimpan!`);
                await bootstrapApp();
            } else {
                showToast("Gagal menyimpan brand: " + (res.error || "Cek koneksi GAS"), true);
            }
        }

        async function deleteBrandItem(brandId, brandName) {
            await apiPost('delete_brand_context', { brandId });
            showToast(`Brand "${brandName}" dihapus.`);
            if (state.activeBrand === brandName) state.activeBrand = 'ALL';
            bootstrapApp();
        }

        async function triggerAutoLearn(brandName, btnEl) {
            const orig = btnEl.innerHTML;
            btnEl.innerText = "Menganalisis histori post...";
            btnEl.disabled = true;
            const res = await apiPost('learn_brand_style', { brandName });
            btnEl.innerHTML = orig;
            btnEl.disabled = false;

            if (res.success) {
                showToast(`Pola gaya bahasa ${brandName} berhasil dipelajari!`);
                bootstrapApp();
            } else {
                showToast(res.error || "Belum ada data post untuk dipelajari.", true);
            }
        }
