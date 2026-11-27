// ContentPlan — js/calendar.js
// Dipecah dari public/index.html baris 1243-1299, dipindah VERBATIM tanpa perubahan
// nama fungsi, id elemen, urutan, atau endpoint. Script klasik (bukan ES module)
// supaya fungsi global tetap bisa dipanggil inline onclick di index.html.
        // =========================================================================
        // KALENDER, SWIPE, COMPOSER, ASSETS, SLOT & BRAND DNA
        // =========================================================================
        function changeCalMonth(delta) {
            state.calMonth += delta;
            if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
            if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
            renderCalendar();
        }

        function renderCalendar() {
            const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
            document.getElementById('cal-month-label').innerText = `${monthNames[state.calMonth]} ${state.calYear}`;
            const grid = document.getElementById('calendar-grid');
            if (!grid) return;
            grid.innerHTML = '';

            const firstDay = new Date(state.calYear, state.calMonth, 1).getDay();
            const startOffset = firstDay === 0 ? 6 : firstDay - 1;
            const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
            const dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

            const filteredContents = getFilteredContents();
            const activeSlots = state.activeBrand === 'ALL' ? state.slots : state.slots.filter(s => s.brand_name === state.activeBrand);

            for (let i = 0; i < startOffset; i++) grid.innerHTML += `<div class="cal-cell bg-gray-50/50"></div>`;

            for (let day = 1; day <= daysInMonth; day++) {
                const fullDate = `${state.calYear}-${String(state.calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayKey = dayKeys[(startOffset + day - 1) % 7];
                const dayContents = filteredContents.filter(c => String(c.scheduled_date).startsWith(fullDate));
                let htmlEvents = '';

                dayContents.forEach(c => {
                    const tClean = cleanTimeStr(c.scheduled_time, '');
                    htmlEvents += `
                        <div class="cal-event flex items-center justify-between gap-1 group">
                            <span onclick="editPostInComposer('${c.content_id}')" class="truncate flex-1">${tClean ? esc(tClean) + ' · ' : ''}${esc(c.content_title)}</span>
                            <button type="button" onclick="event.stopPropagation(); deletePostById('${c.content_id}')" class="opacity-60 hover:opacity-100 text-red-600 font-bold px-1 cursor-pointer" title="Hapus jadwal">×</button>
                        </div>
                    `;
                });

                activeSlots.forEach(slot => {
                    if (String(slot[dayKey]).toUpperCase() === "TRUE") {
                        const slotClean = cleanTimeStr(slot.time_slot, '19:00');
                        const isFilled = dayContents.some(c => cleanTimeStr(c.scheduled_time, '') === slotClean && c.brand_name === slot.brand_name);
                        if (!isFilled) {
                            htmlEvents += `<div onclick="openComposerForSlot('${fullDate}', '${slotClean}', '${slot.slot_id}')" class="slot-pill">Slot ${slotClean}</div>`;
                        }
                    }
                });

                grid.innerHTML += `<div class="cal-cell"><div class="text-xs font-bold text-gray-800 mb-1">${day}</div>${htmlEvents}</div>`;
            }
        }

