/**
 * Render Module
 * Helper functions for generating HTML content and rendering tables
 */

window.AppRender = {
    /**
     * Create registered table header HTML
     * @returns {string} Table header HTML
     */
    registeredTableHeader: () => `
        <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10"><tr>
            <th scope="col" class="px-6 py-3">Tên môn học & Lịch học</th>
            <th scope="col" class="px-6 py-3">Mã LHP</th>
            <th scope="col" class="px-6 py-3">Số TC</th>
            <th scope="col" class="px-6 py-3">Trạng thái</th>
            <th scope="col" class="px-6 py-3">Hành động</th>
        </tr></thead><tbody></tbody>
    `,

    /**
     * Create registered table row HTML
     * @param {Object} reg - Registered class data
     * @param {string} sourceBadge - Source badge HTML
     * @param {string} scheduleDetail - Schedule detail HTML
     * @param {string} maHocPhan - Subject code
     * @returns {string} Row HTML
     */
    registeredTableRow: (reg, sourceBadge, scheduleDetail, maHocPhan) => {
        const actionButtons = reg.isAllowCancel === false ? '' : `
            <button data-reg-id="${reg.id ?? ''}" data-ten-mon="${reg.tenMonHoc ?? ''}" data-source="${reg.source ?? ''}" class="font-medium text-red-600 hover:underline cancel-btn mr-3">Hủy</button>
            <button data-reg-id="${reg.id ?? ''}" 
                    data-reg-code="${reg.maLopHocPhan ?? ''}" 
                    data-reg-name="${reg.tenMonHoc ?? ''}" 
                    data-reg-source="${reg.source ?? ''}"
                    data-reg-subject-code="${maHocPhan ?? ''}"
                    data-reg-status="${reg.tenTrangThaiLopHocPhan || ''}"
                    class="font-medium text-blue-600 hover:underline swap-from-registered-btn">Đổi lớp</button>
        `;
        
        return `
            <th scope="row" class="px-6 py-4 font-medium text-gray-900">${reg.tenMonHoc} ${sourceBadge}<div class="text-xs mt-1 text-gray-600">${scheduleDetail}</div></th>
            <td class="px-6 py-4" data-label="Mã LHP">${reg.maLopHocPhan}</td>
            <td class="px-6 py-4" data-label="Số TC">${reg.soTinChi === 0 ? '' : (reg.soTinChi ?? 'N/A')}</td>
            <td class="px-6 py-4" data-label="Trạng thái">${reg.tenTrangThaiLopHocPhan || 'N/A'}</td>
            <td class="px-6 py-4" data-label="Hành động">${actionButtons}</td>
        `;
    },

    /**
     * Empty registered table message
     * @returns {string} Message HTML
     */
    emptyRegisteredTable: () => `<p class="text-gray-500 text-center py-8">Bạn chưa đăng ký học phần nào.</p>`,

    /**
     * Swap modal header HTML
     * @param {string} regName - Registered class name
     * @param {string} regCode - Registered class code
     * @returns {string} Header HTML
     */
    swapModalHeader: (regName, regCode) => `
        <div class="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex justify-between items-center">
            <div>
                <h2 class="text-2xl font-bold">🔄 Đổi lớp học phần</h2>
                <p class="text-sm text-blue-100 mt-1">Lớp hiện tại: ${regName} (${regCode})</p>
            </div>
            <button id="close-swap-modal" class="text-white hover:text-gray-200 transition">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>
    `,

    /**
     * Swap modal current schedule info
     * @param {string} scheduleDetail - Schedule detail HTML
     * @returns {string} Info HTML
     */
    swapModalCurrentSchedule: (scheduleDetail) => `
        <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
            <p class="text-sm text-gray-700">
                <span class="font-bold">📋 Lịch học hiện tại:</span><br>
                <div class="mt-2 text-gray-600">${scheduleDetail}</div>
            </p>
        </div>
    `,

    /**
     * Swap modal table header
     * @returns {string} Table header HTML
     */
    swapModalTableHeader: () => `
        <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10">
            <tr>
                <th scope="col" class="px-4 py-3">Mã lớp</th>
                <th scope="col" class="px-4 py-3">Lịch học</th>
                <th scope="col" class="px-4 py-3">Trạng thái</th>
                <th scope="col" class="px-4 py-3">Đã đăng ký</th>
                <th scope="col" class="px-4 py-3">Hành động</th>
            </tr>
        </thead>
        <tbody></tbody>
    `,

    /**
     * Swap modal class row
     * @param {Object} cls - Class data
     * @param {string} scheduleDetail - Schedule detail HTML
     * @param {Object} swapValidation - Swap validation result
     * @param {Object} registeredClassData - Registered class data for swap
     * @returns {string} Row HTML
     */
    swapModalTableRow: (cls, scheduleDetail, swapValidation, registeredClassData) => {
        const { id: regId, code: regCode, name: regName, source: regSource, subjectCode, status: regStatus } = registeredClassData;
        
        const statusBadge = cls.tenTrangThai === 'Mở đăng ký'
            ? `<span class="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">${cls.tenTrangThai}</span>`
            : `<span class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">${cls.tenTrangThai || 'N/A'}</span>`;
        
        const percentBadge = cls.phanTramDangKy >= 100
            ? `<span class="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">${cls.phanTramDangKy}%</span>`
            : cls.phanTramDangKy >= 80
                ? `<span class="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">${cls.phanTramDangKy}%</span>`
                : `<span class="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">${cls.phanTramDangKy}%</span>`;
        
        const swapButton = swapValidation.canSwap
            ? `<button class="swap-to-class-btn px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
                   data-target-id="${cls.id}"
                   data-target-code="${cls.maLopHocPhan}"
                   data-target-name="${cls.tenMonHoc}"
                   data-target-source="${cls.source}"
                   data-target-subject-code="${cls.maHocPhan || ''}"
                   data-reg-id="${regId}"
                   data-reg-code="${regCode}"
                   data-reg-name="${regName}"
                   data-reg-source="${regSource}"
                   data-reg-subject-code="${subjectCode || ''}"
                   data-reg-status="${regStatus || ''}">
                   Đổi sang lớp này
               </button>`
            : `<span class="text-xs text-red-600" title="${swapValidation.reason}">🔒 ${swapValidation.reason}</span>`;
        
        return `
            <td class="px-4 py-3 font-medium text-gray-900">${cls.maLopHocPhan}</td>
            <td class="px-4 py-3">
                <div class="text-xs text-gray-600">${scheduleDetail}</div>
            </td>
            <td class="px-4 py-3">${statusBadge}</td>
            <td class="px-4 py-3">${percentBadge}</td>
            <td class="px-4 py-3">${swapButton}</td>
        `;
    },

    /**
     * Swap confirm modal content
     * @param {string} regName - Registered class name
     * @param {string} regCode - Registered class code
     * @param {string} targetName - Target class name
     * @param {string} targetCode - Target class code
     * @returns {string} Modal content HTML
     */
    swapConfirmContent: (regName, regCode, targetName, targetCode) => `
        Xác nhận đổi lớp trùng lịch?<br><br>
        <div class="bg-gray-50 p-3 rounded mb-2">
        <p class="text-sm"><span class="font-semibold text-red-600">Hủy:</span> ${regName} <span class="text-gray-500">(${regCode})</span></p>
        <p class="text-sm"><span class="font-semibold text-green-600">Đăng ký:</span> ${targetName} <span class="text-gray-500">(${targetCode})</span></p>
        </div>
        <p class="text-sm text-gray-600">Lớp mới sẽ được thêm vào danh sách đổi lớp.</p>
    `,

    /**
     * Conflict tooltip content
     * @param {Array} conflicts - Array of conflict info
     * @param {Function} getRegisteredById - Function to get registered class by ID
     * @param {Function} canSwapClass - Function to check swap eligibility
     * @returns {string} Tooltip HTML
     */
    conflictTooltip: (conflicts, getRegisteredById, canSwapClass) => {
        const conflictMessages = conflicts.map(conflict => {
            const regClass = getRegisteredById(conflict.registeredId);
            const swapValidation = canSwapClass(regClass, null);
            
            const swapButton = swapValidation.canSwap
                ? `<button class="swap-from-tooltip-btn mt-2 px-2 py-1 text-xs font-semibold rounded bg-orange-500 text-white hover:bg-orange-600 transition"
                        data-reg-id="${regClass?.id || ''}"
                        data-reg-code="${conflict.registeredCode}"
                        data-reg-name="${conflict.registeredClass}">
                        🔄 Đổi lớp
                   </button>`
                : `<span class="text-xs text-red-200 mt-2 block">🔒 ${swapValidation.reason}</span>`;
            
            const uniqueConflicts = conflict.uniqueConflicts.map(c => 
                `${c.day}, Tiết ${c.conflictPeriod}`
            ).join('<br>• ');
            
            return `
                <div class="mb-3 pb-3 border-b border-red-500 last:border-b-0 last:mb-0 last:pb-0">
                    <div class="font-semibold text-sm">${conflict.registeredClass}</div>
                    <div class="text-xs text-red-200 mt-1">(${conflict.registeredCode})</div>
                    <div class="text-xs mt-2">
                        <span class="text-yellow-300">Trùng:</span><br>
                        • ${uniqueConflicts}
                    </div>
                    ${swapButton}
                </div>
            `;
        }).join('');
        
        return `
            <div class="flex items-center gap-2 mb-3 pb-2 border-b border-red-500">
                <svg class="w-6 h-6 text-yellow-300" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                </svg>
                <span class="font-bold text-lg">TRÙNG LỊCH HỌC</span>
            </div>
            ${conflictMessages}
            <div class="mt-3 pt-2 text-xs text-red-100">
                💡 Tip: Chọn lớp học khác hoặc hủy đăng ký lớp bị trùng
            </div>
        `;
    }
};
