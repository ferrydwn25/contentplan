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

        function goToToday() {
            const now = new Date();
            state.calYear = now.getFullYear();
            state.calMonth = now.getMonth();
            renderCalendar();
        }

        /* Warna per platform (2026-11-28): border kiri + dot event
         * diwarnai menurut platform — YouTube merah, TikTok cyan,
         * Instagram magenta, Threads hitam. Warna STATUS tetap
         * dipertahankan lewat background + warna teks (Ready hijau,
         * Idea/Draft abu, Published ungu, default/Planned biru), jadi
         * status dan platform tidak bertabrakan: platform = aksen kiri,
         * status = isi chip. */
        const platformCls = { 'YouTube': 'cal-plat-youtube', 'TikTok': 'cal-plat-tiktok', 'Instagram': 'cal-plat-instagram', 'Threads': 'cal-plat-threads' };

        /* Kelas warna platform untuk satu konten kalender. Nilai platform
         * di CONTENTS umumnya persis 'YouTube'/'TikTok'/'Instagram'/
         * 'Threads' (sesuai opsi comp-platform), tapi dinormalisasi juga
         * secara case-insensitive supaya varian dari Sheet tetap terwarnai.
         * Platform tak dikenal -> abu-abu netral. */
        function platformCalClass(p) {
            const key = String(p || '').trim();
            if (platformCls[key]) return platformCls[key];
            const s = key.toLowerCase();
            if (s.includes('youtube')) return 'cal-plat-youtube';
            if (s.includes('tiktok')) return 'cal-plat-tiktok';
            if (s.includes('instagram')) return 'cal-plat-instagram';
            if (s.includes('thread')) return 'cal-plat-threads';
            return 'cal-plat-other';
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

            const filteredContents = getFilteredContents();
            const todayStr = localDateStr(new Date());
            const statusCls = { 'Ready': 'cal-event-ready', 'Idea': 'cal-event-idea', 'Draft': 'cal-event-idea', 'Published': 'cal-event-published' };

            for (let i = 0; i < startOffset; i++) grid.innerHTML += `<div class="cal-cell bg-gray-50/50"></div>`;

            for (let day = 1; day <= daysInMonth; day++) {
                const fullDate = `${state.calYear}-${String(state.calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayContents = filteredContents.filter(c => String(c.scheduled_date).startsWith(fullDate));
                const isToday = fullDate === todayStr;
                let htmlEvents = '';

                dayContents.forEach(c => {
                    const tClean = cleanTimeStr(c.scheduled_time, '');
                    htmlEvents += `
                        <div class="cal-event ${statusCls[c.content_status] || ''} ${platformCalClass(c.platform)} flex items-center justify-between gap-1 group">
                            <span class="cal-dot"></span>
                            <span onclick="editPostInComposer('${c.content_id}')" class="truncate flex-1">${tClean ? esc(tClean) + ' · ' : ''}${esc(c.content_title)}</span>
                            <button type="button" onclick="event.stopPropagation(); deletePostById('${c.content_id}')" class="opacity-60 hover:opacity-100 text-red-600 font-bold px-1 cursor-pointer" title="Hapus jadwal">×</button>
                        </div>
                    `;
                });

                /* Slot kosong tidak ditampilkan (2026-11-28, permintaan
                 * Ferry): sel tanggal hanya berisi konten terjadwal; bila
                 * belum ada slot yang terisi, sel dibiarkan kosong. */

                grid.innerHTML += `<div class="cal-cell${isToday ? ' cal-today' : ''}"><div class="text-xs font-bold ${isToday ? 'text-blue-700' : 'text-gray-800'} mb-1">${day}${isToday ? ' <span class="text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full align-middle">Hari ini</span>' : ''}</div>${htmlEvents}</div>`;
            }
        }

