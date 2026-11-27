// ContentPlan — js/swipe.js
// Dipecah dari public/index.html baris 1300-1332, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        function togglePillar(el, pillarName) {
            el.classList.toggle('pillar-selected');
            if (state.selectedPillars.includes(pillarName)) {
                state.selectedPillars = state.selectedPillars.filter(p => p !== pillarName);
            } else {
                state.selectedPillars.push(pillarName);
            }
        }

        async function executeBatchGenerate() {
            const pillars = state.selectedPillars.length > 0 ? state.selectedPillars : ['Edukasi', 'Hiburan', 'Cerita Brand'];
            const brandName = document.getElementById('swipe-brand').value;
            if (!brandName) return showToast("Tambahkan brand terlebih dahulu!", true);

            const platform = document.getElementById('swipe-platform').value;
            const count = parseInt(document.getElementById('swipe-count').value);
            const btn = document.getElementById('btn-buat-batch');

            btn.innerText = "Meracik Batch dari Brand DNA...";
            btn.disabled = true;
            const res = await apiPost('generate_batch', { brandName, platform, pillars, count });
            btn.innerText = "Buat batch";
            btn.disabled = false;

            if (res.success) {
                showToast(`Berhasil membuat ${res.count} konten sesuai DNA ${brandName}!`);
                await bootstrapApp();
                navigate('calendar');
            } else {
                showToast("Gagal membuat batch: " + (res.error || "Unknown error"), true);
            }
        }

