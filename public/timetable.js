// ============================================
// TIMETABLE MODAL FUNCTIONALITY
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    const timetableModal = document.getElementById('timetable-modal');
    // viewTimetableBtn is dynamic, handled via global function or delegation
    const closeTimetableModal = document.getElementById('close-timetable-modal');
    const timetableContent = document.getElementById('timetable-content');
    const timetableTabBtns = document.querySelectorAll('.timetable-tab-btn');
    
    let currentPhase = 1; // Default to phase 1
    let registeredData = [];
    let selectedData = [];
    
    // Expose show function globally
    window.showTimetableModal = () => {
        // Get data from global scope (exposed in app.js)
        if (window.getRegisteredClassesData) registeredData = window.getRegisteredClassesData();
        if (window.getSelectedClassesData) selectedData = window.getSelectedClassesData();
        
        timetableModal.classList.remove('hidden');
        generateTimetable(currentPhase);
    };

    // Close modal
    if (closeTimetableModal) {
        closeTimetableModal.addEventListener('click', () => {
            timetableModal.classList.add('hidden');
        });
    }
    
    // Close on click outside
    timetableModal.addEventListener('click', (e) => {
        if (e.target === timetableModal) {
            timetableModal.classList.add('hidden');
        }
    });

    // Tab switching
    timetableTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            timetableTabBtns.forEach(b => {
                b.classList.remove('bg-blue-50', 'text-blue-600', 'shadow-sm');
                b.classList.add('text-slate-500');
            });
            btn.classList.remove('text-slate-500');
            btn.classList.add('bg-blue-50', 'text-blue-600', 'shadow-sm');
            
            currentPhase = parseInt(btn.dataset.phase);
            generateTimetable(currentPhase);
        });
    });
    
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
    
    // Get session (ca) from first period number (for classes spanning multiple sessions)
    // Ca 1: 1-3, Ca 2: 4-6, Ca 3: 7-9, Ca 4: 10-12, Ca 5: 13-15, Ca 6: 16-18
    const getSessionFromPeriod = (firstPeriod) => {
        if (firstPeriod >= 1 && firstPeriod <= 3) return 'Ca 1';
        if (firstPeriod >= 4 && firstPeriod <= 6) return 'Ca 2';
        if (firstPeriod >= 7 && firstPeriod <= 9) return 'Ca 3';
        if (firstPeriod >= 10 && firstPeriod <= 12) return 'Ca 4';
        if (firstPeriod >= 13 && firstPeriod <= 15) return 'Ca 5';
        if (firstPeriod >= 16 && firstPeriod <= 18) return 'Ca 6';
        return '';
    };
    
    // Get time range from periods
    const getTimeRange = (periods) => {
        if (!periods || periods.length === 0) return '';
        const timePeriods = {
            1: '06:45', 2: '07:35', 3: '08:25', 4: '09:25',
            5: '10:25', 6: '11:25', 7: '12:25', 8: '13:25',
            9: '14:15', 10: '14:50', 11: '15:40', 12: '16:40',
            13: '17:30', 14: '18:30', 15: '19:20', 16: '20:10',
            17: '21:00', 18: '21:50'
        };
        const firstPeriod = Math.min(...periods);
        const lastPeriod = Math.max(...periods);
        const startTime = timePeriods[firstPeriod] || '';
        const endTime = timePeriods[lastPeriod + 1] || timePeriods[lastPeriod] || '';
        return `${startTime} - ${endTime}`;
    };
    
    // Generate timetable HTML
    const generateTimetable = (phase) => {
        const sessions = {
            'Sáng': ['Ca 1', 'Ca 2'],
            'Chiều': ['Ca 3', 'Ca 4'],
            'Tối': ['Ca 5', 'Ca 6']
        };
        
        const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
        
        // Build timetable grid: grid[thu][session] = [classes]
        const grid = {};
        
        // Initialize grid for all days and sessions
        for (let thu = 2; thu <= 8; thu++) {
            grid[thu] = {};
            Object.values(sessions).flat().forEach(session => {
                grid[thu][session] = [];
            });
        }
        
        // Auto-detect phases based on earliest ngayBatDau of each class
        // Collect earliest start date for each class (by maLopHocPhan)
        let classStartDates = new Map(); // maLopHocPhan -> earliest start date
        
        registeredData.forEach(cls => {
            if (cls.scheduleDetails && cls.scheduleDetails.length > 0) {
                let earliestDate = null;
                cls.scheduleDetails.forEach(schedule => {
                    if (schedule.ngayBatDau) {
                        const date = new Date(schedule.ngayBatDau);
                        if (!earliestDate || date < earliestDate) {
                            earliestDate = date;
                        }
                    }
                });
                if (earliestDate) {
                    classStartDates.set(cls.maLopHocPhan, {
                        date: earliestDate,
                        tenMonHoc: cls.tenMonHoc
                    });
                }
            }
        });
        
        selectedData.forEach(cls => {
            if (cls.scheduleDetails && cls.scheduleDetails.length > 0) {
                let earliestDate = null;
                cls.scheduleDetails.forEach(schedule => {
                    if (schedule.ngayBatDau) {
                        const date = new Date(schedule.ngayBatDau);
                        if (!earliestDate || date < earliestDate) {
                            earliestDate = date;
                        }
                    }
                });
                if (earliestDate && !classStartDates.has(cls.maLopHocPhan)) {
                    classStartDates.set(cls.maLopHocPhan, {
                        date: earliestDate,
                        tenMonHoc: cls.tenMonHoc
                    });
                }
            }
        });
        
        // Get all unique earliest dates and sort
        let uniqueStartDates = [...classStartDates.values()].map(v => v.date);
        uniqueStartDates = [...new Set(uniqueStartDates.map(d => d.getTime()))].map(t => new Date(t));
        uniqueStartDates.sort((a, b) => a - b);
        
        let phaseBoundary = null;
        
        console.log('Classes with earliest start dates:');
        classStartDates.forEach((value, key) => {
            console.log(`  ${value.tenMonHoc} (${key}): ${value.date.toLocaleDateString('vi-VN')}`);
        });
        
        if (uniqueStartDates.length > 1) {
            // Find the largest gap between consecutive start dates
            let maxGap = 0;
            let maxGapIndex = -1;
            
            for (let i = 0; i < uniqueStartDates.length - 1; i++) {
                const gap = uniqueStartDates[i + 1] - uniqueStartDates[i];
                const gapDays = gap / (24 * 60 * 60 * 1000);
                
                console.log(`Gap: ${uniqueStartDates[i].toLocaleDateString('vi-VN')} → ${uniqueStartDates[i + 1].toLocaleDateString('vi-VN')} = ${Math.round(gapDays)} days`);
                
                if (gap > maxGap) {
                    maxGap = gap;
                    maxGapIndex = i;
                }
            }
            
            const maxGapDays = maxGap / (24 * 60 * 60 * 1000);
            
            // If gap is at least 2 days, use it as phase boundary
            if (maxGapDays >= 2 && maxGapIndex >= 0) {
                phaseBoundary = uniqueStartDates[maxGapIndex + 1];
                console.log('✓ Phase boundary detected at:', phaseBoundary.toLocaleDateString('vi-VN'));
                console.log('  Largest gap:', Math.round(maxGapDays), 'days');
                console.log('  Phase 1: Before', phaseBoundary.toLocaleDateString('vi-VN'));
                console.log('  Phase 2: From', phaseBoundary.toLocaleDateString('vi-VN'), 'onwards');
            } else {
                console.log('✗ No significant gap found (largest gap:', Math.round(maxGapDays), 'days). All schedules will be in Phase 1.');
            }
        }
        
        // Helper function to determine phase of a schedule
        const getSchedulePhase = (schedule) => {
            if (!schedule.ngayBatDau || !phaseBoundary) return 1;
            const startDate = new Date(schedule.ngayBatDau);
            return startDate < phaseBoundary ? 1 : 2;
        };
        
        // Process registered classes
        console.log('Processing registered data for phase:', phase);
        registeredData.forEach(cls => {
            if (!cls.scheduleDetails || cls.scheduleDetails.length === 0) return;
            
            cls.scheduleDetails.forEach(schedule => {
                // Filter by phase
                if (getSchedulePhase(schedule) !== phase) return;
                
                const thu = schedule.thu; // 2-8
                if (!thu || thu < 2 || thu > 8) return;
                
                const periods = parseTietHoc(schedule.tietHoc);
                if (periods.length === 0) return;
                
                const session = getSessionFromPeriod(periods[0]);
                if (!session) return;
                
                // Check if already exists
                const exists = grid[thu][session].some(item => item.maLopHocPhan === cls.maLopHocPhan);
                if (!exists) {
                    grid[thu][session].push({
                        tenMonHoc: cls.tenMonHoc,
                        maLopHocPhan: cls.maLopHocPhan,
                        tietHoc: schedule.tietHoc,
                        periods: periods,
                        phong: schedule.phong || 'N/A',
                        timeRange: getTimeRange(periods),
                        lmsLink: schedule.lmsLink || '',
                        isRegistered: true
                    });
                }
            });
        });
        
        // Process selected classes
        console.log('Processing selected data for phase:', phase);
        selectedData.forEach(cls => {
            // Skip if already registered
            if (registeredData.some(reg => reg.maLopHocPhan === cls.maLopHocPhan)) return;
            
            if (!cls.scheduleDetails || cls.scheduleDetails.length === 0) return;
            
            cls.scheduleDetails.forEach(schedule => {
                // Filter by phase
                if (getSchedulePhase(schedule) !== phase) return;
                
                const thu = schedule.thu;
                if (!thu || thu < 2 || thu > 8) return;
                
                const periods = parseTietHoc(schedule.tietHoc);
                if (periods.length === 0) return;
                
                const session = getSessionFromPeriod(periods[0]);
                if (!session) return;
                
                const exists = grid[thu][session].some(item => item.maLopHocPhan === cls.maLopHocPhan);
                if (!exists) {
                    grid[thu][session].push({
                        tenMonHoc: cls.tenMonHoc,
                        maLopHocPhan: cls.maLopHocPhan,
                        tietHoc: schedule.tietHoc,
                        periods: periods,
                        phong: schedule.phong || 'N/A',
                        timeRange: getTimeRange(periods),
                        lmsLink: schedule.lmsLink || '',
                        isRegistered: false
                    });
                }
            });
        });
        
        // Generate HTML
        let html = '<table class="w-full border-collapse" style="min-width: 900px;">';
        
        // Header row
        html += '<thead><tr class="bg-gradient-to-r from-teal-50 to-teal-100">';
        html += '<th class="border border-gray-300 px-2 py-3 text-center font-semibold" colspan="2">Ca học</th>';
        
        dayNames.forEach(dayName => {
            html += `<th class="border border-gray-300 px-2 py-3 text-center font-semibold">${dayName}</th>`;
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
                
                // Loop through days (thu 2-8)
                for (let thu = 2; thu <= 8; thu++) {
                    const classes = grid[thu][session] || [];
                    
                    if (classes.length === 0) {
                        html += '<td class="border border-gray-300 px-2 py-2"></td>';
                    } else {
                        html += '<td class="border border-gray-300 px-2 py-2">';
                        
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
        const html = generateTimetable(currentPhase);
        timetableContent.innerHTML = html;
    };
    
    // Event handlers - viewTimetableBtn is handled in app.js via window.showTimetableModal()
    
    closeTimetableModal?.addEventListener('click', () => {
        timetableModal.classList.add('hidden');
    });
    
    timetableModal?.addEventListener('click', (e) => {
        if (e.target === timetableModal) {
            timetableModal.classList.add('hidden');
        }
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
});
