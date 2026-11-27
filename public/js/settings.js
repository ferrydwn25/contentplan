// ContentPlan — js/settings.js
// Dipecah dari public/index.html baris 1551-1581, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        function renderSlotMatrix() {
            const tbody = document.getElementById('slot-matrix-body');
            if (!tbody) return;
            const selectedBrand = document.getElementById('slot-brand-filter').value;
            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            const brandSlots = state.slots.filter(s => s.brand_name === selectedBrand);
            tbody.innerHTML = '';

            if (brandSlots.length === 0) {
                tbody.innerHTML = `<tr><td colspan="9" class="py-6 text-xs text-gray-400">Belum ada slot jam untuk brand ini. Klik "+ Tambah jam" di atas.</td></tr>`;
                return;
            }

            brandSlots.forEach(s => {
                const slotClean = cleanTimeStr(s.time_slot, '19:00');
                let checkboxes = days.map(d => `
                    <td class="py-3"><input type="checkbox" ${String(s[d]).toUpperCase() === 'TRUE' ? 'checked' : ''} onchange="apiPost('toggle_slot', {slotId:'${s.slot_id}', dayKey:'${d}', value:this.checked})" class="w-4 h-4 accent-indigo-600 cursor-pointer"></td>
                `).join('');
                tbody.innerHTML += `<tr><td class="py-3 text-left font-bold">${slotClean}</td>${checkboxes}<td><button type="button" onclick="apiPost('delete_slot', {slotId:'${s.slot_id}'}).then(bootstrapApp)" class="text-red-500 cursor-pointer"><i class="ph ph-trash"></i></button></td></tr>`;
            });
        }

        async function createNewSlot() {
            const brandName = document.getElementById('slot-brand-filter').value;
            if (!brandName) return showToast("Pilih brand terlebih dahulu!", true);
            const timeSlot = document.getElementById('new-slot-time').value;
            await apiPost('add_slot', { brandName, timeSlot });
            showToast(`Slot jam ${timeSlot} ditambahkan!`);
            bootstrapApp();
        }

