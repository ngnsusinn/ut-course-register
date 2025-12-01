/**
 * HTML Templates Module
 * Centralized HTML template strings for the application
 */

window.AppTemplates = {
    // === VIP SECTION TEMPLATES ===
    
    /**
     * VIP star icon SVG
     */
    vipStarIcon: `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
    `,

    /**
     * VIP status display for active VIP users
     */
    vipStatusActive: (daysLeft, expiryDate) => `
        <div class="text-center">
            <p class="font-bold text-blue-700 text-lg">⭐ Tài khoản VIP</p>
            <p class="text-sm text-gray-700">Thời hạn còn lại: <span class="font-semibold text-blue-600">${daysLeft} ngày</span></p>
            <p class="text-xs text-gray-500 mt-1">Hết hạn vào ngày: ${new Date(expiryDate).toLocaleDateString('vi-VN')}</p>
        </div>
    `,

    /**
     * VIP status display for non-VIP users
     */
    vipStatusInactive: `
        <div class="text-center p-3 bg-gray-100 rounded-lg">
            <p class="text-sm text-gray-600">Bạn chưa có VIP - Nâng cấp để sử dụng đầy đủ tính năng!</p>
        </div>
    `,

    /**
     * VIP button content
     */
    vipButton: (isRenewal) => `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
        <span>${isRenewal ? 'Gia hạn VIP' : 'Nâng cấp VIP'}</span>
    `,

    /**
     * VIP plan card
     */
    vipPlanCard: (key, plan, isRenewal) => `
        <div class="border border-gray-200 rounded-lg p-4 text-center hover:border-blue-500 transition duration-300 cursor-pointer plan-card" data-plan="${key}">
            <h3 class="font-bold text-lg text-gray-800 mb-2">${plan.name}</h3>
            <p class="text-2xl font-bold text-blue-600 mb-2">${plan.price.toLocaleString('vi-VN')}đ</p>
            <p class="text-gray-600 mb-4">${isRenewal ? 'Gia hạn thêm' : ''} ${plan.duration} ngày</p>
            <button class="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition duration-300 buy-plan-btn" data-plan="${key}">
                ${isRenewal ? 'Gia hạn' : 'Chọn gói này'}
            </button>
        </div>
    `,

    /**
     * Full VIP modal HTML
     */
    vipModal: (plans, sepayConfig, isRenewal) => {
        const modalTitle = isRenewal ? '🔄 Gia hạn VIP' : '🌟 Nâng cấp VIP';
        const planCards = Object.entries(plans).map(([key, plan]) => 
            window.AppTemplates.vipPlanCard(key, plan, isRenewal)
        ).join('');
        
        return `
            <div class="payment-modal-content bg-white rounded-xl shadow-md p-6">
                <span class="close-modal float-right" onclick="document.getElementById('vip-modal').remove()">&times;</span>
                <h2 class="text-2xl font-bold mb-6 text-gray-800 text-center">${modalTitle}</h2>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    ${planCards}
                </div>
                <div id="payment-section" class="hidden">
                    <h3 class="text-xl font-bold mb-4 text-gray-800 border-t pt-4">Thông tin thanh toán</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="border border-gray-200 rounded-lg p-4 bg-gray-50 text-center">
                            <p class="font-bold text-gray-800 mb-2">Cách 1: Quét mã QR</p>
                            <img id="qr-code" class="mx-auto mb-4" style="max-width:250px">
                            <p class="text-sm text-gray-600">Trạng thái: <span id="payment-status">Chờ thanh toán...</span> <div class="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-blue-500"></div></p>
                        </div>
                        <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
                            <p class="font-bold text-gray-800 mb-2 text-center">Cách 2: Chuyển khoản thủ công</p>
                            <div class="text-center mb-4">
                                <img src="https://qr.sepay.vn/assets/img/banklogo/MB.png" class="inline-block" style="max-height:50px">
                                <p class="font-bold text-gray-800">Ngân hàng ${sepayConfig.bankName}</p>
                            </div>
                            <table class="w-full text-sm text-gray-600">
                                <tbody>
                                    <tr><td class="py-1 font-medium">Chủ TK:</td><td class="font-bold text-gray-800">${sepayConfig.accountName}</td></tr>
                                    <tr><td class="py-1 font-medium">Số TK:</td><td class="font-bold text-gray-800">${sepayConfig.accountNumber}</td></tr>
                                    <tr><td class="py-1 font-medium">Số tiền:</td><td class="font-bold text-gray-800" id="amount-display"></td></tr>
                                    <tr><td class="py-1 font-medium">Nội dung:</td><td class="font-bold text-gray-800" id="content-display"></td></tr>
                                </tbody>
                            </table>
                            <p class="bg-yellow-50 p-2 rounded mt-4 text-xs text-gray-600">⚠️ Lưu ý: Vui lòng giữ nguyên nội dung chuyển khoản để hệ thống tự động xác nhận</p>
                        </div>
                    </div>
                    <div class="text-center mt-6">
                        <button id="cancel-payment-btn" class="bg-gray-500 text-white px-6 py-2 rounded-lg hover:bg-gray-600 transition duration-300">
                            Hủy thanh toán
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Payment status display
     */
    paymentStatus: {
        waiting: '<span id="payment-status">Chờ thanh toán...</span> <div class="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-blue-500"></div>',
        success: '<span class="text-green-600 font-bold">✓ Thanh toán thành công!</span>',
        cancelled: '<span class="text-red-600 font-bold">✗ Đơn hàng đã bị hủy</span>',
        expired: '<span class="text-red-600 font-bold">⚠️ Đơn hàng đã hết hạn (quá 15 phút)</span>'
    },

    // === USER PANEL TEMPLATES ===

    /**
     * User panel HTML structure
     */
    userPanel: `
        <div id="greeting-msg" class="mt-4 text-lg font-semibold text-blue-700"></div>
        
        <div id="vip-status-section" class="my-3 p-3 bg-blue-50 rounded-lg border-2 border-blue-200">
            <div id="vip-status"></div>
        </div>
        
        <button id="upgrade-vip-btn" class="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold py-2 px-4 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition duration-300 flex items-center justify-center space-x-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span>Nâng cấp VIP</span>
        </button>
        
        <div id="prerequisite-toggle-container" class="flex items-center justify-center my-3">
            <label for="prerequisite-toggle" class="flex items-center cursor-pointer">
                <div class="relative">
                    <input type="checkbox" id="prerequisite-toggle" class="sr-only" disabled>
                    <div class="block bg-gray-600 w-14 h-8 rounded-full"></div>
                    <div class="dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition"></div>
                </div>
                <div class="ml-3 text-gray-700 font-medium">Lấy dữ liệu môn điều kiện</div>
            </label>
        </div>
        
        <div id="progress-bar-container" class="my-4 hidden">
            <div class="w-full bg-gray-200 rounded-full h-2.5">
                <div id="progress-bar-element" class="bg-blue-600 h-2.5 rounded-full" style="width: 0%"></div>
            </div>
            <p id="progress-bar-text" class="text-center text-sm text-gray-600 mt-1"></p>
        </div>
        
        <button id="fetch-schedule-btn" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-300 flex items-center justify-center space-x-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM6 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" />
            </svg>
            <span>Tải lịch học</span>
        </button>
        
        <button id="logout-btn" class="w-full bg-gray-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 transition duration-300">Đăng xuất</button>
    `,

    // === SCHEDULE TABLE TEMPLATES ===

    /**
     * Empty schedule message
     */
    emptySchedule: (hasData) => hasData 
        ? '<p class="text-gray-500 text-center py-8">Không tìm thấy lớp học phần nào.</p>'
        : '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập và nhấn "Lấy Lịch Học".</p>',

    /**
     * Schedule table header
     */
    scheduleTableHeader: `
        <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10"><tr>
            <th scope="col" class="px-6 py-3">Tên môn học & Lịch học</th>
            <th scope="col" class="px-6 py-3">Mã LHP</th>
            <th scope="col" class="px-6 py-3">Loại HP</th>
            <th scope="col" class="px-6 py-3">Số TC</th>
            <th scope="col" class="px-6 py-3">Trạng thái</th>
            <th scope="col" class="px-6 py-3">Đã đăng ký</th>
        </tr></thead><tbody></tbody>
    `,

    /**
     * Subject type badge
     * Logic:
     * - source = 'dkhpdk' → Điều kiện (màu tím) - không cần check isBatBuoc
     * - isBatBuoc = true → Bắt buộc (màu đỏ)
     * - isBatBuoc = false → Tự chọn (màu xanh dương)
     */
    subjectTypeBadge: (source, isBatBuoc) => {
        // source dkhpdk luôn là Điều kiện
        if (source === 'dkhpdk') {
            return `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-purple-200 text-purple-800 whitespace-nowrap">Điều kiện</span>`;
        }
        
        if (isBatBuoc === undefined) return 'N/A';
        
        if (isBatBuoc === true) {
            return `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-red-200 text-red-800 whitespace-nowrap">Bắt buộc</span>`;
        }
        
        // isBatBuoc = false
        return `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-blue-200 text-blue-800 whitespace-nowrap">Tự chọn</span>`;
    },

    /**
     * Source badge (ĐK badge for dkhpdk)
     */
    sourceBadge: (source) => source === 'dkhpdk' 
        ? `<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded-sm bg-purple-200 text-purple-800">ĐK</span>` 
        : '',

    /**
     * Conflict warning icon
     */
    conflictWarningIcon: `
        <svg class="w-4 h-4 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
        </svg>
    `,

    /**
     * Conflict item in warning box
     * @param {Object} conflict - Conflict data with registeredId, registeredCode, registeredClass
     * @param {Object} regClass - Full registered class object from cache
     * @param {Object} targetCls - Target class being considered
     */
    conflictItem: (conflict, regClass, targetCls) => `
        <div class="flex items-center justify-between gap-2 py-1.5 px-2 bg-white rounded border border-red-200">
            <div class="flex items-center gap-2 min-w-0">
                <span class="text-xs font-mono font-semibold text-red-600 whitespace-nowrap">${conflict.registeredCode}</span>
                <span class="text-xs text-gray-600 truncate">${conflict.registeredClass}</span>
            </div>
            <button class="swap-from-conflict-btn flex-shrink-0 px-2.5 py-1 text-xs font-semibold rounded bg-orange-500 text-white hover:bg-orange-600 transition whitespace-nowrap"
                    data-reg-id="${conflict.registeredId || regClass?.id || ''}"
                    data-reg-code="${conflict.registeredCode}"
                    data-reg-name="${conflict.registeredClass}"
                    data-reg-source="${regClass?.source || 'dkhp'}"
                    data-reg-subject-code="${regClass?.maHocPhan || ''}"
                    data-reg-status="${regClass?.tenTrangThaiLopHocPhan || ''}"
                    data-target-id="${targetCls.id}"
                    data-target-code="${targetCls.maLopHocPhan}"
                    data-target-name="${targetCls.tenMonHoc}">
                🔄 Đổi lớp
            </button>
        </div>
    `,

    /**
     * Conflict warning box
     */
    conflictWarningBox: (conflictItemsHtml) => `
        <div class="mt-2 p-2 bg-red-50 border-l-4 border-red-500 rounded">
            <div class="flex items-center gap-2 mb-2">
                ${window.AppTemplates.conflictWarningIcon}
                <p class="text-xs font-bold text-red-800">TRÙNG LỊCH HỌC</p>
            </div>
            <div class="space-y-1.5">
                ${conflictItemsHtml}
            </div>
        </div>
    `,

    // === SELECTED CLASSES TEMPLATES ===

    /**
     * Selected class item
     */
    selectedClassItem: (cls, scheduleDetail, sourceBadge) => `
        <div class="flex justify-between items-center bg-blue-50 p-2 rounded-md hover:bg-blue-100">
            <div>
                <p class="font-semibold text-sm text-blue-800">${cls.tenMonHoc} ${sourceBadge}</p>
                <div class="text-xs text-gray-600 mt-1">${scheduleDetail}</div>
            </div>
            <button data-class-id="${cls.id}" class="remove-selected-btn text-red-500 hover:text-red-700 ml-2">&times;</button>
        </div>
    `,

    /**
     * Swap icon SVG for selected list
     */
    swapIcon: `<svg class="w-4 h-4 text-yellow-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/>
    </svg>`,

    /**
     * Swap pending class item
     */
    swapPendingClassItem: (regClass, targetClass, regSourceBadge, targetSourceBadge) => `
        <div class="flex justify-between items-center bg-yellow-50 border-2 border-yellow-400 p-2 rounded-md hover:bg-yellow-100">
            <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                    <svg class="w-4 h-4 text-yellow-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
                    </svg>
                    <span class="text-xs font-bold text-yellow-700">ĐỔI LỚP</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="line-through text-gray-500 text-xs">
                        <span class="font-semibold">${regClass.tenMonHoc}</span> ${regSourceBadge}
                        <span class="text-gray-400">(${regClass.maLopHocPhan})</span>
                    </div>
                    <span class="text-yellow-600 font-bold">→</span>
                    <div class="text-sm font-semibold text-yellow-800">
                        ${targetClass.tenMonHoc} ${targetSourceBadge}
                        <span class="text-yellow-600">(${targetClass.maLopHocPhan})</span>
                    </div>
                </div>
            </div>
            <button data-class-id="${targetClass.id}" class="remove-swap-btn text-red-500 hover:text-red-700 ml-2">&times;</button>
        </div>
    `,

    /**
     * Empty selected list message
     */
    emptySelectedList: (hasVIP) => hasVIP
        ? `<p class="text-gray-500">Chưa có lớp nào được chọn.</p>`
        : `<p class="text-gray-500">Chưa có lớp nào được chọn. Nâng cấp VIP để chọn lớp.</p>`,

    // === ICONS ===
    icons: {
        swap: `<svg class="w-4 h-4 text-yellow-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd"/>
        </svg>`,
        warning: `<svg class="mx-auto h-12 w-12 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>`,
        schedule: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM6 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" />
        </svg>`
    }
};
