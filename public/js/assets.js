// ContentPlan — js/assets.js
// Dipecah dari public/index.html baris 1534-1550, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        /* Pakai aset di Composer tanpa menyisipkan URL ke string JS inline
         * (URL dengan ' akan merusak handler). Nilai dibaca dari data-url. */
        function useAssetInComposer(btn) {
            openNewComposerPost();
            document.getElementById('comp-thumb-url').value = btn.getAttribute('data-url') || '';
            updateLivePreview();
        }

        function renderAssetsGallery() {
            const grid = document.getElementById('assets-gallery-grid');
            if (!grid) return;
            grid.innerHTML = state.assets.length === 0 ? `<p class="col-span-full text-center text-xs text-gray-400 py-8">Belum ada aset.</p>` : '';
            state.assets.forEach(a => {
                grid.innerHTML += `
                    <div class="apple-card overflow-hidden">
                        <img src="${esc(a.file_url)}" alt="${esc(a.file_name)}" class="w-full aspect-square object-cover bg-gray-100">
                        <div class="p-3 space-y-2">
                            <p class="text-xs font-bold truncate">${esc(a.file_name)}</p>
                            <button type="button" onclick="useAssetInComposer(this)" data-url="${esc(a.file_url)}" class="apple-btn-secondary w-full py-1.5 text-[11px]">Pakai di Post</button>
                        </div>
                    </div>
                `;
            });
        }

