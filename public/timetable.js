// ============================================
// TIMETABLE MODAL FUNCTIONALITY
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    const timetableModal = document.getElementById('timetable-modal');
    const viewTimetableBtn = document.getElementById('view-timetable-btn');
    const closeTimetableModal = document.getElementById('close-timetable-modal');
    const timetableDatePicker = document.getElementById('timetable-date-picker');
    const timetablePrevWeek = document.getElementById('timetable-prev-week');
    const timetableToday = document.getElementById('timetable-today');
    const timetableNextWeek = document.getElementById('timetable-next-week');
    const timetableContent = document.getElementById('timetable-content');
    const timetableTabBtns = document.querySelectorAll('.timetable-tab-btn');
    
    let currentDate = new Date();
    let currentPhase = 1; // Default to phase 1
    let registeredData = [];
    let selectedData = [];
    
    // Time period mapping
    const timePeriods = {
        1: { ca: 'Sáng', name: 'Ca 1', start: '06:45', end: '08:25' },
        2: { ca: 'Sáng', name: 'Ca 1', start: '06:45', end: '08:25' },
        3: { ca: 'Sáng', name: 'Ca 1', start: '08:25', end: '10:15' },
        4: { ca: 'Sáng', name: 'Ca 1', start: '08:25', end: '10:15' },
        5: { ca: 'Sáng', name: 'Ca 2', start: '10:25', end: '12:15' },
        6: { ca: 'Sáng', name: 'Ca 2', start: '10:25', end: '12:15' },
        7: { ca: 'Chiều', name: 'Ca 3', start: '12:25', end: '14:15' },
        8: { ca: 'Chiều', name: 'Ca 3', start: '12:25', end: '14:15' },
        9: { ca: 'Chiều', name: 'Ca 3', start: '14:15', end: '14:50' },
        10: { ca: 'Chiều', name: 'Ca 4', start: '14:50', end: '16:40' },
        11: { ca: 'Chiều', name: 'Ca 4', start: '15:40', end: '17:20' },
        12: { ca: 'Chiều', name: 'Ca 4', start: '15:40', end: '17:20' },
        13: { ca: 'Tối', name: 'Ca 5', start: '17:30', end: '19:20' },
        14: { ca: 'Tối', name: 'Ca 5', start: '17:30', end: '19:20' },
        15: { ca: 'Tối', name: 'Ca 5', start: '17:30', end: '20:00' },
        16: { ca: 'Tối', name: 'Ca 6', start: '20:10', end: '22:00' },
        17: { ca: 'Tối', name: 'Ca 6', start: '20:10', end: '22:00' },
        18: { ca: 'Tối', name: 'Ca 6', start: '20:10', end: '22:40' }
    };
    
    // Parse periods from string like "3-4" or "10-12"
    const parseTietHoc = (tietHoc) => {
        if (!tietHoc) return [];
        const parts = tietHoc.toString().split('-');
        if (parts.length !== 2) return [];
        const start = parseInt(parts[0]);
        const end = parseInt(parts[1]);
        if (isNaN(start) || isNaN(end)) return [];
        const periods = [];
        for (let i = start; i <= end; i++) {
            periods.push(i);
        }
        return periods;
    };
    
    // Get session (ca) from period number
    const getSessionFromPeriod = (period) => {
        const info = timePeriods[period];
        return info ? info.name : '';
    };
    
    // Get time range from periods
    const getTimeRange = (periods) => {
        if (!periods || periods.length === 0) return '';
        const firstPeriod = Math.min(...periods);
        const lastPeriod = Math.max(...periods);
        const startTime = timePeriods[firstPeriod]?.start || '';
        const endTime = timePeriods[lastPeriod]?.end || '';
        return `${startTime} - ${endTime}`;
    };
    
    // Get Monday of the week containing the given date
    const getMonday = (date) => {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.setDate(diff));
    };
    
    // Format date as DD/MM/YYYY
    const formatDate = (date) => {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    };
    
    // Get week days starting from Monday
    const getWeekDays = (monday) => {
        const days = [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(monday);
            day.setDate(monday.getDate() + i);
            days.push(day);
        }
        return days;
    };
    
    // Check if date is in range
    const isDateInRange = (date, startDate, endDate) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(endDate);
        e.setHours(0, 0, 0, 0);
        return d >= s && d <= e;
    };
    
    // Generate timetable HTML
    const generateTimetable = (weekDays, phase) => {
        const sessions = {
            'Sáng': ['Ca 1', 'Ca 2'],
            'Chiều': ['Ca 3', 'Ca 4'],
            'Tối': ['Ca 5', 'Ca 6']
        };
        
        // Filter classes by phase
        const phaseClasses = registeredData.filter(cls => {
            if (!cls.scheduleDetails || cls.scheduleDetails.length === 0) return false;
            // Check if class has schedules in the given phase
            return cls.scheduleDetails.some(schedule => {
                const classPhase = schedule.dotHoc || 1; // Default to phase 1 if not specified
                return classPhase === phase;
            });
        });
        
        // Build timetable grid
        const grid = {};
        
        phaseClasses.forEach(cls => {
            cls.scheduleDetails.forEach(schedule => {
                const classPhase = schedule.dotHoc || 1;
                if (classPhase !== phase) return;
                
                const thu = schedule.thu; // 2-8 (8 is Sunday)
                const periods = parseTietHoc(schedule.tietHoc);
                if (periods.length === 0) return;
                
                // Get session name for this period
                const session = getSessionFromPeriod(periods[0]);
                if (!session) return;
                
                // Check if any day in the week falls within this schedule
                weekDays.forEach((day, dayIndex) => {
                    const dayOfWeek = day.getDay() === 0 ? 8 : day.getDay() + 1; // Convert to 2-8
                    if (dayOfWeek === thu && isDateInRange(day, schedule.ngayBatDau, schedule.ngayKetThuc)) {
                        const key = `${session}-${dayIndex}`;
                        if (!grid[key]) {
                            grid[key] = [];
                        }
                        
                        // Check if class already exists in this cell
                        const exists = grid[key].some(item => item.maLopHocPhan === cls.maLopHocPhan);
                        if (!exists) {
                            grid[key].push({
                                tenMonHoc: cls.tenMonHoc,
                                maLopHocPhan: cls.maLopHocPhan,
                                tietHoc: schedule.tietHoc,
                                periods: periods,
                                phong: schedule.phong || 'N/A',
                                timeRange: getTimeRange(periods),
                                lmsLink: schedule.lmsLink || '',
                                isRegistered: true,
                                isSelected: selectedData.some(sel => sel.maLopHocPhan === cls.maLopHocPhan)
                            });
                        }
                    }
                });
            });
        });
        
        // Add selected classes that are not registered
        selectedData.forEach(cls => {
            if (registeredData.some(reg => reg.maLopHocPhan === cls.maLopHocPhan)) return;
            
            if (!cls.scheduleDetails || cls.scheduleDetails.length === 0) return;
            
            cls.scheduleDetails.forEach(schedule => {
                const classPhase = schedule.dotHoc || 1;
                if (classPhase !== phase) return;
                
                const thu = schedule.thu;
                const periods = parseTietHoc(schedule.tietHoc);
                if (periods.length === 0) return;
                
                const session = getSessionFromPeriod(periods[0]);
                if (!session) return;
                
                weekDays.forEach((day, dayIndex) => {
                    const dayOfWeek = day.getDay() === 0 ? 8 : day.getDay() + 1;
                    if (dayOfWeek === thu && isDateInRange(day, schedule.ngayBatDau, schedule.ngayKetThuc)) {
                        const key = `${session}-${dayIndex}`;
                        if (!grid[key]) {
                            grid[key] = [];
                        }
                        
                        const exists = grid[key].some(item => item.maLopHocPhan === cls.maLopHocPhan);
                        if (!exists) {
                            grid[key].push({
                                tenMonHoc: cls.tenMonHoc,
                                maLopHocPhan: cls.maLopHocPhan,
                                tietHoc: schedule.tietHoc,
                                periods: periods,
                                phong: schedule.phong || 'N/A',
                                timeRange: getTimeRange(periods),
                                lmsLink: schedule.lmsLink || '',
                                isRegistered: false,
                                isSelected: true
                            });
                        }
                    }
                });
            });
        });
        
        // Generate HTML
        let html = '<table class="w-full border-collapse" style="min-width: 900px;">';
        
        // Header row
        html += '<thead><tr class="bg-gradient-to-r from-teal-50 to-teal-100">';
        html += '<th class="border border-gray-300 px-2 py-3 text-center font-semibold" colspan="2">Ca học</th>';
        
        const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
        weekDays.forEach((day, index) => {
            const isToday = day.toDateString() === new Date().toDateString();
            const bgClass = isToday ? 'bg-teal-200' : '';
            html += `<th class="border border-gray-300 px-2 py-3 text-center font-semibold ${bgClass}">${dayNames[index]}<br><span class="text-sm font-normal">${formatDate(day)}</span></th>`;
        });
        
        html += '</tr></thead><tbody>';
        
        // Body rows
        Object.keys(sessions).forEach(caName => {
            const sessionList = sessions[caName];
            
            // Ca name row (rowspan)
            html += `<tr><td class="border border-gray-300 px-4 py-2 text-center font-bold bg-gray-100" rowspan="${sessionList.length + 1}">${caName}</td></tr>`;
            
            sessionList.forEach(session => {
                html += '<tr>';
                html += `<td class="border border-gray-300 px-4 py-2 text-center font-semibold bg-gray-50">${session}</td>`;
                
                for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                    const key = `${session}-${dayIndex}`;
                    const classes = grid[key] || [];
                    
                    const isToday = weekDays[dayIndex].toDateString() === new Date().toDateString();
                    const bgClass = isToday ? 'bg-teal-50' : '';
                    
                    if (classes.length === 0) {
                        html += `<td class="border border-gray-300 px-2 py-2 ${bgClass}"></td>`;
                    } else {
                        html += `<td class="border border-gray-300 px-2 py-2 ${bgClass}">`;
                        
                        classes.forEach(cls => {
                            const bgColor = cls.isRegistered ? 'rgb(0, 134, 137)' : 'rgb(255, 152, 0)';
                            html += `
                                <div class="mb-2 last:mb-0 p-2 rounded text-white text-sm" style="background-color: ${bgColor}">
                                    <p class="font-semibold">${cls.tenMonHoc}</p>
                                    <div class="mt-1 space-y-0.5 text-xs">
                                        <p class="font-mono">${cls.maLopHocPhan}</p>
                                        <div class="flex items-center gap-1">
                                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                            <span>Tiết: ${cls.tietHoc}</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            <span>${cls.timeRange}</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                                            <span>Phòng: ${cls.phong}</span>
                                        </div>
                                        ${cls.lmsLink ? `<a href="${cls.lmsLink}" target="_blank" class="inline-flex items-center gap-1 text-white underline hover:text-yellow-200"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>LMS</a>` : ''}
                                    </div>
                                </div>
                            `;
                        });
                        
                        html += '</td>';
                    }
                }
                
                html += '</tr>';
            });
        });
        
        html += '</tbody></table>';
        
        return html;
    };
    
    // Update timetable display
    const updateTimetable = () => {
        const monday = getMonday(currentDate);
        const weekDays = getWeekDays(monday);
        
        // Update date picker
        timetableDatePicker.valueAsDate = currentDate;
        
        // Generate timetable
        const html = generateTimetable(weekDays, currentPhase);
        timetableContent.innerHTML = html;
    };
    
    // Event handlers
    viewTimetableBtn?.addEventListener('click', () => {
        // Get registered and selected classes data
        // Access from window scope since it's defined in app.js
        if (typeof window.registeredClassesData !== 'undefined') {
            registeredData = window.registeredClassesData || [];
        }
        if (typeof window.selectedClasses !== 'undefined') {
            selectedData = Array.from(window.selectedClasses.values()) || [];
        }
        
        currentDate = new Date();
        timetableModal.classList.remove('hidden');
        updateTimetable();
    });
    
    closeTimetableModal?.addEventListener('click', () => {
        timetableModal.classList.add('hidden');
    });
    
    timetableModal?.addEventListener('click', (e) => {
        if (e.target === timetableModal) {
            timetableModal.classList.add('hidden');
        }
    });
    
    timetableDatePicker?.addEventListener('change', (e) => {
        currentDate = new Date(e.target.value);
        updateTimetable();
    });
    
    timetablePrevWeek?.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 7);
        updateTimetable();
    });
    
    timetableToday?.addEventListener('click', () => {
        currentDate = new Date();
        updateTimetable();
    });
    
    timetableNextWeek?.addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() + 7);
        updateTimetable();
    });
    
    timetableTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const phase = parseInt(btn.dataset.phase);
            currentPhase = phase;
            
            // Update active tab
            timetableTabBtns.forEach(b => {
                b.classList.remove('border-b-4', 'border-teal-600', 'text-teal-600');
                b.classList.add('text-gray-600');
            });
            btn.classList.add('border-b-4', 'border-teal-600', 'text-teal-600');
            btn.classList.remove('text-gray-600');
            
            updateTimetable();
        });
    });
    
    // Expose data to window for access from this module
    window.addEventListener('load', () => {
        if (typeof registeredClassesData !== 'undefined') {
            window.registeredClassesData = registeredClassesData;
        }
        if (typeof selectedClasses !== 'undefined') {
            window.selectedClasses = selectedClasses;
        }
    });
});
