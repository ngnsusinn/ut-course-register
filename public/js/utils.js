/**
 * Utility Functions Module
 * Common helper functions used across the application
 */

window.AppUtils = {
    /**
     * Log message to the log output panel
     * @param {string} message - Message to log
     * @param {boolean} isError - Whether this is an error message
     */
    log: (message, isError = false) => {
        const logOutput = document.getElementById('log-output');
        if (!logOutput) return;
        
        const timestamp = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Bangkok' });
        const logEntry = document.createElement('p');
        logEntry.innerHTML = `[${timestamp}] ${message}`;
        logEntry.className = isError ? 'text-red-400' : 'text-green-300';
        logOutput.appendChild(logEntry);
        logOutput.scrollTop = logOutput.scrollHeight;
    },

    /**
     * Toggle loading state on a button
     * @param {HTMLElement} button - Button element
     * @param {boolean} isLoading - Whether to show loading state
     */
    toggleLoading: (button, isLoading) => {
        if (!button) return;
        if (isLoading) {
            button.disabled = true;
            button.innerHTML = `<div class="loader"></div>`;
        } else {
            button.disabled = false;
            button.innerHTML = button.originalHTML;
        }
    },

    /**
     * Format day of week from number
     * @param {number} thu - Day number (2-8, where 8 is Sunday)
     * @returns {string} Formatted day string
     */
    formatDayOfWeek: (thu) => {
        if (thu === 8) return 'Chủ nhật';
        return `Thứ ${thu}`;
    },

    /**
     * Format schedule details for display
     * @param {Array} details - Schedule details array
     * @returns {string} HTML string
     */
    formatScheduleDetail: (details) => {
        if (!details || details.error || !Array.isArray(details) || details.length === 0) {
            return 'Không có thông tin lịch học';
        }
        return details.map(d => 
            `<div class="font-medium">${window.AppUtils.formatDayOfWeek(d.thu)} | Tiết ${d.tietHoc} | ${new Date(d.ngayBatDau).toLocaleDateString('vi-VN')} - ${new Date(d.ngayKetThuc).toLocaleDateString('vi-VN')}</div>`
        ).join('<hr class="my-1 border-gray-200">');
    },

    /**
     * Format selected class detail for display
     * @param {Object} cls - Class object
     * @param {Array} details - Schedule details
     * @returns {string} HTML string
     */
    formatSelectedClassDetail: (cls, details) => {
        if (!details || details.error) return `<span class="text-red-500">Không tải được lịch</span>`;
        if (!Array.isArray(details) || details.length === 0) return '<span>Chưa có thông tin lịch học</span>';
        return details.map(detail => 
            `<span>${cls.maLopHocPhan} | ${window.AppUtils.formatDayOfWeek(detail.thu)} | Tiết ${detail.tietHoc}</span>`
        ).join('<br>');
    },

    /**
     * Parse period string to array
     * @param {string} tietHoc - Period string like "1-3"
     * @returns {number[]} Array of period numbers
     */
    parsePeriods: (tietHoc) => {
        if (!tietHoc) return [];
        const parts = tietHoc.toString().split('-');
        if (parts.length !== 2) return [];
        const start = parseInt(parts[0]);
        const end = parseInt(parts[1]);
        const periods = [];
        for (let i = start; i <= end; i++) {
            periods.push(i);
        }
        return periods;
    },

    /**
     * Check if two period arrays overlap
     * @param {number[]} periods1 - First period array
     * @param {number[]} periods2 - Second period array
     * @returns {boolean} Whether periods overlap
     */
    periodsOverlap: (periods1, periods2) => {
        const CONFIG = window.AppConfig.get();
        // Check if either period set contains evening periods
        const hasEvening1 = periods1.some(p => CONFIG.EVENING_PERIODS.includes(p));
        const hasEvening2 = periods2.some(p => CONFIG.EVENING_PERIODS.includes(p));
        
        // If either period set is evening class, no conflict
        if (hasEvening1 || hasEvening2) {
            return false;
        }
        
        // Normal conflict check for non-evening periods
        return periods1.some(p => periods2.includes(p));
    },

    /**
     * Check if two date ranges overlap
     * @param {string} start1 - First range start date
     * @param {string} end1 - First range end date
     * @param {string} start2 - Second range start date
     * @param {string} end2 - Second range end date
     * @returns {boolean} Whether ranges overlap
     */
    dateRangesOverlap: (start1, end1, start2, end2) => {
        const s1 = new Date(start1).getTime();
        const e1 = new Date(end1).getTime();
        const s2 = new Date(start2).getTime();
        const e2 = new Date(end2).getTime();
        return s1 <= e2 && s2 <= e1;
    }
};
