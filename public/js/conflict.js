/**
 * Conflict Detection Module
 * Handles schedule conflict checking between classes
 */

window.AppConflict = {
    /**
     * Check if a class schedule conflicts with registered classes
     * @param {Array} classScheduleDetails - Schedule details of the class to check
     * @param {Array} registeredClassesData - Array of registered classes
     * @returns {Object} Conflict check result
     */
    checkScheduleConflict: (classScheduleDetails, registeredClassesData) => {
        const Utils = window.AppUtils;
        
        if (!classScheduleDetails || !Array.isArray(classScheduleDetails) || classScheduleDetails.length === 0) {
            return { hasConflict: false, conflicts: [] };
        }

        // Use Map to group conflicts by registered class (maLopHocPhan)
        const conflictMap = new Map();

        for (const schedule of classScheduleDetails) {
            const schedulePeriods = Utils.parsePeriods(schedule.tietHoc);
            if (schedulePeriods.length === 0) continue;

            for (const registered of registeredClassesData) {
                if (!registered.scheduleDetails || !Array.isArray(registered.scheduleDetails)) continue;

                for (const regSchedule of registered.scheduleDetails) {
                    const regPeriods = Utils.parsePeriods(regSchedule.tietHoc);
                    if (regPeriods.length === 0) continue;

                    // Check if same day of week
                    if (schedule.thu === regSchedule.thu) {
                        // Check if date ranges overlap
                        if (Utils.dateRangesOverlap(
                            schedule.ngayBatDau, schedule.ngayKetThuc,
                            regSchedule.ngayBatDau, regSchedule.ngayKetThuc
                        )) {
                            // Check if periods overlap
                            if (Utils.periodsOverlap(schedulePeriods, regPeriods)) {
                                // Group by registered class code to avoid duplicates
                                const key = registered.maLopHocPhan;
                                
                                if (!conflictMap.has(key)) {
                                    conflictMap.set(key, {
                                        registeredClass: registered.tenMonHoc,
                                        registeredCode: registered.maLopHocPhan,
                                        conflicts: []
                                    });
                                }
                                
                                // Add this specific conflict detail
                                conflictMap.get(key).conflicts.push({
                                    day: Utils.formatDayOfWeek(schedule.thu),
                                    period: schedule.tietHoc,
                                    conflictPeriod: regSchedule.tietHoc
                                });
                            }
                        }
                    }
                }
            }
        }

        // Convert map to array and format conflicts
        const conflicts = Array.from(conflictMap.values()).map(conflict => {
            // Get unique day-period combinations
            const uniqueConflicts = [];
            const seen = new Set();
            
            for (const c of conflict.conflicts) {
                const key = `${c.day}-${c.period}-${c.conflictPeriod}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueConflicts.push(c);
                }
            }
            
            return {
                registeredClass: conflict.registeredClass,
                registeredCode: conflict.registeredCode,
                uniqueConflicts: uniqueConflicts
            };
        });

        return {
            hasConflict: conflicts.length > 0,
            conflicts: conflicts
        };
    },

    /**
     * Check schedule conflict between two specific classes
     * @param {Array} schedule1 - First class schedule
     * @param {Array} schedule2 - Second class schedule
     * @returns {boolean} Whether schedules conflict
     */
    checkConflictBetweenTwo: (schedule1, schedule2) => {
        const Utils = window.AppUtils;
        
        if (!schedule1 || !Array.isArray(schedule1) || schedule1.length === 0) return false;
        if (!schedule2 || !Array.isArray(schedule2) || schedule2.length === 0) return false;
        
        for (const s1 of schedule1) {
            const periods1 = Utils.parsePeriods(s1.tietHoc);
            if (periods1.length === 0) continue;
            
            for (const s2 of schedule2) {
                const periods2 = Utils.parsePeriods(s2.tietHoc);
                if (periods2.length === 0) continue;
                
                // Check if same day of week
                if (s1.thu === s2.thu) {
                    // Check if date ranges overlap
                    if (Utils.dateRangesOverlap(s1.ngayBatDau, s1.ngayKetThuc, s2.ngayBatDau, s2.ngayKetThuc)) {
                        // Check if periods overlap
                        if (Utils.periodsOverlap(periods1, periods2)) {
                            return true;
                        }
                    }
                }
            }
        }
        
        return false;
    }
};
