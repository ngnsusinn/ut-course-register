document.addEventListener('DOMContentLoaded', () => {
    // CSS Toggle Switch (đã được tối ưu với Tailwind)
    const style = document.createElement('style');
    style.innerHTML = `
        input:checked~.dot{transform:translateX(100%);background-color:#48bb78}
        input:checked~.block{background-color:#a7f3d0}
        .payment-modal{display:none;position:fixed;z-index:50;left:0;top:0;width:100%;height:100%;overflow:auto;background-color:rgba(0,0,0,0.4)}
        .payment-modal-content{background-color:#fff;margin:5% auto;padding:24px;border:none;width:90%;max-width:800px;border-radius:1rem;box-shadow:0 4px 6px rgba(0,0,0,0.1)}
        .close-modal{color:#6b7280;font-size:1.75rem;font-weight:700;cursor:pointer}
        .close-modal:hover,.close-modal:focus{color:#1f2937}
    `;
    document.head.appendChild(style);

    // DOM Elements
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const delayInput = document.getElementById('delay-input');
    const loginBtn = document.getElementById('login-btn');
    const startInsertionBtn = document.getElementById('start-insertion-btn');
    const startRegistrationBtn = document.getElementById('start-registration-btn');
    const stopBtn = document.getElementById('stop-btn');
    const refreshRegisteredBtn = document.getElementById('refresh-registered-btn');
    const searchInput = document.getElementById('search-schedule');
    const subjectFilter = document.getElementById('subject-filter');
    const scheduleContainer = document.getElementById('schedule-container');
    const registeredContainer = document.getElementById('registered-container');
    const selectedList = document.getElementById('selected-classes-list');
    const logOutput = document.getElementById('log-output');
    const registrationControls = document.getElementById('registration-controls');
    const loginForm = document.getElementById('login-form');

    // Dynamically created elements
    let userPanel, greetingMsg, prerequisiteToggle, prerequisiteToggleContainer, fetchBtn, logoutBtn, progressBarContainer, progressBarElement, progressBarText, vipStatusElement, upgradeVipBtn;

    // State
    let authToken = null;
    let dotId = null;
    let userId = null;
    let vipStatus = { hasVIP: false };
    let allScheduleData = [];
    let registeredClassesData = []; // Store registered classes for conflict detection
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;
    let currentOrder = null;
    let paymentCheckInterval = null;
    let vipExpiryCheckInterval = null;

    // Assign originalHTML safely
    const buttons = [loginBtn, startInsertionBtn, startRegistrationBtn, stopBtn, refreshRegisteredBtn];
    buttons.forEach(btn => { if (btn) btn.originalHTML = btn.innerHTML; });

    // === BACKEND COMMUNICATION ===
    const backendRequest = async (action, payload = {}) => {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const response = await fetch('/api/handler', { method: 'POST', headers, body: JSON.stringify({ action, payload }) });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP Error: ${response.status}` }));
                log(`Lỗi '${action}': ${errorData.message}`, true);
                return null;
            }
            return await response.json();
        } catch (error) {
            log(`Lỗi mạng khi gọi backend: ${error.message}`, true);
            return null;
        }
    };

    // --- UTILITY FUNCTIONS ---
    const log = (message, isError = false) => {
        const timestamp = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Bangkok' });
        const logEntry = document.createElement('p');
        logEntry.innerHTML = `[${timestamp}] ${message}`;
        logEntry.className = isError ? 'text-red-400' : 'text-green-300';
        logOutput.appendChild(logEntry);
        logOutput.scrollTop = logOutput.scrollHeight;
    };

    const toggleLoading = (button, isLoading) => {
        if (!button) return;
        if (isLoading) {
            button.disabled = true;
            button.innerHTML = `<div class="loader"></div>`;
        } else {
            button.disabled = false;
            button.innerHTML = button.originalHTML;
        }
    };

    const formatDayOfWeek = (thu) => {
        if (thu === 8) return 'Chủ nhật';
        return `Thứ ${thu}`;
    };

    const formatScheduleDetail = (details) => {
        if (!details || details.error || !Array.isArray(details) || details.length === 0) {
            return 'Không có thông tin lịch học';
        }
        return details.map(d => `<div class="font-medium">${formatDayOfWeek(d.thu)} | Tiết ${d.tietHoc} | ${new Date(d.ngayBatDau).toLocaleDateString('vi-VN')} - ${new Date(d.ngayKetThuc).toLocaleDateString('vi-VN')}</div>`).join('<hr class="my-1 border-gray-200">');
    };

    const formatSelectedClassDetail = (cls, details) => {
        if (!details || details.error) return `<span class="text-red-500">Không tải được lịch</span>`;
        if (!Array.isArray(details) || details.length === 0) return '<span>Chưa có thông tin lịch học</span>';
        return details.map(detail => `<span>${cls.maLopHocPhan} | ${formatDayOfWeek(detail.thu)} | Tiết ${detail.tietHoc}</span>`).join('<br>');
    };

    // --- SCHEDULE CONFLICT DETECTION ---
    
    // Parse period string "1-3" or "4-6" to array [1, 2, 3] or [4, 5, 6]
    const parsePeriods = (tietHoc) => {
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
    };

    // Check if two period arrays overlap
    // Example: [1,2,3] and [2,3,4] overlap, [1,2,3] and [4,5,6] don't overlap
    // Exception: Period 16-18 (evening class) never conflicts with any other periods
    const periodsOverlap = (periods1, periods2) => {
        // Check if either period set contains evening periods (16, 17, 18)
        const eveningPeriods = [16, 17, 18];
        const hasEvening1 = periods1.some(p => eveningPeriods.includes(p));
        const hasEvening2 = periods2.some(p => eveningPeriods.includes(p));
        
        // If either period set is evening class, no conflict
        if (hasEvening1 || hasEvening2) {
            return false;
        }
        
        // Normal conflict check for non-evening periods
        return periods1.some(p => periods2.includes(p));
    };

    // Check if two date ranges overlap
    const dateRangesOverlap = (start1, end1, start2, end2) => {
        const s1 = new Date(start1).getTime();
        const e1 = new Date(end1).getTime();
        const s2 = new Date(start2).getTime();
        const e2 = new Date(end2).getTime();
        return s1 <= e2 && s2 <= e1;
    };

    // Check if a class schedule conflicts with registered classes
    const checkScheduleConflict = (classScheduleDetails, registeredClassesData) => {
        if (!classScheduleDetails || !Array.isArray(classScheduleDetails) || classScheduleDetails.length === 0) {
            return { hasConflict: false, conflicts: [] };
        }

        const conflicts = [];

        for (const schedule of classScheduleDetails) {
            const schedulePeriods = parsePeriods(schedule.tietHoc);
            if (schedulePeriods.length === 0) continue;

            for (const registered of registeredClassesData) {
                if (!registered.scheduleDetails || !Array.isArray(registered.scheduleDetails)) continue;

                for (const regSchedule of registered.scheduleDetails) {
                    const regPeriods = parsePeriods(regSchedule.tietHoc);
                    if (regPeriods.length === 0) continue;

                    // Check if same day of week
                    if (schedule.thu === regSchedule.thu) {
                        // Check if date ranges overlap
                        if (dateRangesOverlap(
                            schedule.ngayBatDau, schedule.ngayKetThuc,
                            regSchedule.ngayBatDau, regSchedule.ngayKetThuc
                        )) {
                            // Check if periods overlap
                            if (periodsOverlap(schedulePeriods, regPeriods)) {
                                conflicts.push({
                                    registeredClass: registered.tenMonHoc,
                                    registeredCode: registered.maLopHocPhan,
                                    day: formatDayOfWeek(schedule.thu),
                                    period: schedule.tietHoc,
                                    conflictPeriod: regSchedule.tietHoc
                                });
                            }
                        }
                    }
                }
            }
        }

        return {
            hasConflict: conflicts.length > 0,
            conflicts: conflicts
        };
    };

    // --- VIP FUNCTIONS ---
    const showVIPModal = async () => {
        const plansRes = await backendRequest('getVIPPlans');
        if (!plansRes || !plansRes.success) {
            return log('Không thể tải thông tin gói VIP', true);
        }

        const modal = document.createElement('div');
        modal.className = 'payment-modal';
        modal.id = 'vip-modal';

        const plans = plansRes.plans;
        const sepayConfig = plansRes.sepayConfig;
        
        // Check if user has VIP to show appropriate title
        const isRenewal = vipStatus.hasVIP;
        const modalTitle = isRenewal ? '🔄 Gia hạn VIP' : '🌟 Nâng cấp VIP';

        modal.innerHTML = `
            <div class="payment-modal-content bg-white rounded-xl shadow-md p-6">
                <span class="close-modal float-right" onclick="document.getElementById('vip-modal').remove()">&times;</span>
                <h2 class="text-2xl font-bold mb-6 text-gray-800 text-center">${modalTitle}</h2>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    ${Object.entries(plans).map(([key, plan]) => `
                        <div class="border border-gray-200 rounded-lg p-4 text-center hover:border-blue-500 transition duration-300 cursor-pointer plan-card" data-plan="${key}">
                            <h3 class="font-bold text-lg text-gray-800 mb-2">${plan.name}</h3>
                            <p class="text-2xl font-bold text-blue-600 mb-2">${(plan.price).toLocaleString('vi-VN')}đ</p>
                            <p class="text-gray-600 mb-4">${isRenewal ? 'Gia hạn thêm' : ''} ${plan.duration} ngày</p>
                            <button class="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition duration-300 buy-plan-btn" data-plan="${key}">
                                ${isRenewal ? 'Gia hạn' : 'Chọn gói này'}
                            </button>
                        </div>
                    `).join('')}
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

        document.body.appendChild(modal);
        modal.style.display = 'block';

        // Handle plan selection
        modal.querySelectorAll('.buy-plan-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const plan = e.target.dataset.plan;
                await createVIPOrder(plan, plans[plan], sepayConfig);
            });
        });

        // Handle cancel payment
        // Handle cancel payment - CẬP NHẬT MỚI
// Handle cancel payment - CẬP NHẬT MỚI VỚI CUSTOM MODAL
modal.querySelector('#cancel-payment-btn')?.addEventListener('click', async () => {
    if (!currentOrder) return;
    
    showConfirmModal(
        'Bạn có chắc chắn muốn hủy đơn hàng thanh toán này không? Thao tác này không thể hoàn tác.',
        async () => {
            // User confirmed - cancel the order
            const cancelRes = await backendRequest('cancelOrder', { orderId: currentOrder.id });
            
            if (cancelRes && cancelRes.success) {
                log('✅ Đã hủy đơn hàng thành công');
                if (paymentCheckInterval) {
                    clearInterval(paymentCheckInterval);
                }
                currentOrder = null;
                modal.remove();
            } else {
                log('❌ Không thể hủy đơn hàng: ' + (cancelRes?.message || 'Lỗi'), true);
            }
        },
        () => {
            // User cancelled - do nothing
            log('Tiếp tục chờ thanh toán');
        }
    );
});


    };

    const createVIPOrder = async (planKey, planData, sepayConfig) => {
        const orderRes = await backendRequest('createVIPOrder', { userId, plan: planKey });

        if (!orderRes || !orderRes.success) {
            return log('Không thể tạo đơn hàng', true);
        }

        currentOrder = orderRes.order;
        log(`✅ Tạo đơn hàng #${currentOrder.orderCode} thành công`);

        // Show payment section
        document.getElementById('payment-section').classList.remove('hidden');
        document.querySelectorAll('.plan-card').forEach(card => card.classList.add('opacity-50'));
        document.querySelectorAll('.buy-plan-btn').forEach(btn => btn.disabled = true);

        // Update payment info - use orderCode instead of id
        const qrUrl = `https://qr.sepay.vn/img?bank=${sepayConfig.bankName}&acc=${sepayConfig.accountNumber}&template=compact&amount=${currentOrder.amount}&des=${currentOrder.orderCode}`;
        document.getElementById('qr-code').src = qrUrl;
        document.getElementById('amount-display').textContent = `${currentOrder.amount.toLocaleString('vi-VN')}đ`;
        document.getElementById('content-display').textContent = currentOrder.orderCode;

        // Start checking payment status
        startPaymentCheck();
    };

    const startPaymentCheck = () => {
    if (paymentCheckInterval) clearInterval(paymentCheckInterval);
    
    const orderCreatedTime = new Date(currentOrder.createdAt).getTime();
    const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    
    paymentCheckInterval = setInterval(async () => {
        if (!currentOrder) {
            clearInterval(paymentCheckInterval);
            return;
        }
        
        // Check if order has timed out
        const now = new Date().getTime();
        if (now - orderCreatedTime > TIMEOUT_MS) {
            clearInterval(paymentCheckInterval);
            document.getElementById('payment-status').innerHTML = 
                '<span class="text-red-600 font-bold">⚠️ Đơn hàng đã hết hạn (quá 15 phút)</span>';
            log('Đơn hàng đã bị hủy do quá thời gian thanh toán', true);
            
            setTimeout(() => {
                document.getElementById('vip-modal')?.remove();
                currentOrder = null;
            }, 3000);
            return;
        }
        
        // Check payment status
        const statusRes = await backendRequest('checkOrderStatus', { orderId: currentOrder.id });
        
        if (statusRes && statusRes.success) {
            if (statusRes.order.status === 'Paid') {
                clearInterval(paymentCheckInterval);
                document.getElementById('payment-status').innerHTML = 
                    '<span class="text-green-600 font-bold">✓ Thanh toán thành công!</span>';
                log('Thanh toán VIP thành công!');
                
                setTimeout(async () => {
                    document.getElementById('vip-modal')?.remove();
                    await checkAndUpdateVIPStatus();
                }, 2000);
            } else if (statusRes.order.status === 'Cancelled') {
                clearInterval(paymentCheckInterval);
                document.getElementById('payment-status').innerHTML = 
                    '<span class="text-red-600 font-bold">✗ Đơn hàng đã bị hủy</span>';
                log('Đơn hàng đã bị hủy', true);
                
                setTimeout(() => {
                    document.getElementById('vip-modal')?.remove();
                    currentOrder = null;
                }, 2000);
            }
        }
    }, 2000); // Check every 2 seconds
};


    const checkAndUpdateVIPStatus = async () => {
        const vipRes = await backendRequest('checkVIPStatus', { userId });
        if (vipRes && vipRes.success) {
            const previousVIPStatus = vipStatus.hasVIP;
            vipStatus = vipRes.vip;
            updateVIPDisplay();
            
            // If VIP status changed from active to expired
            if (previousVIPStatus && !vipStatus.hasVIP) {
                log('⚠️ VIP của bạn đã hết hạn. Vui lòng gia hạn để tiếp tục sử dụng.', true);
                
                // Reset UI to non-VIP state
                allScheduleData = [];
                selectedClasses.clear();
                updateSelectedList();
                renderScheduleTable();
                
                // Clear cache
                localStorage.removeItem('userDataCache');
                
                // Show VIP modal
                setTimeout(() => {
                    showVIPModal();
                }, 1000);
            }
        }
    };
    
    // Start auto-check VIP expiry every 7 seconds
    const startVIPExpiryCheck = () => {
        if (vipExpiryCheckInterval) clearInterval(vipExpiryCheckInterval);
        
        vipExpiryCheckInterval = setInterval(async () => {
            if (!authToken || !userId) {
                clearInterval(vipExpiryCheckInterval);
                return;
            }
            
            await checkAndUpdateVIPStatus();
        }, 7000); // Check every 7 seconds
    };
    
    // Stop VIP expiry check
    const stopVIPExpiryCheck = () => {
        if (vipExpiryCheckInterval) {
            clearInterval(vipExpiryCheckInterval);
            vipExpiryCheckInterval = null;
        }
    };
	
    const updateVIPDisplay = () => {
    if (!vipStatusElement) return;

    const isVip = !!vipStatus.hasVIP;

    if (isVip) {
        vipStatusElement.innerHTML = `
            <div class="text-center">
                <p class="font-bold text-blue-700 text-lg">⭐ Tài khoản VIP</p>
                <p class="text-sm text-gray-700">Thời hạn còn lại: <span class="font-semibold text-blue-600">${vipStatus.daysLeft} ngày</span></p>
                <p class="text-xs text-gray-500 mt-1">Hết hạn vào ngày: ${new Date(vipStatus.expiryDate).toLocaleDateString('vi-VN')}</p>
            </div>
        `;
        
        // Change button to "Gia hạn VIP" when user has VIP
        upgradeVipBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span>Gia hạn VIP</span>
        `;
        upgradeVipBtn.classList.remove('hidden');

        if (prerequisiteToggleContainer) prerequisiteToggleContainer.classList.remove('hidden');
        if (prerequisiteToggle) prerequisiteToggle.disabled = false; // <-- enable checkbox for VIP

        if (fetchBtn) fetchBtn.classList.remove('hidden');
        if (selectedList) selectedList.classList.remove('hidden');
    } else {
        vipStatusElement.innerHTML = `
            <div class="text-center p-3 bg-gray-100 rounded-lg">
                <p class="text-sm text-gray-600">Bạn chưa có VIP - Nâng cấp để sử dụng đầy đủ tính năng!</p>
            </div>
        `;
        
        // Reset button to "Nâng cấp VIP" when no VIP
        upgradeVipBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span>Nâng cấp VIP</span>
        `;
        upgradeVipBtn.classList.remove('hidden');

        if (prerequisiteToggleContainer) prerequisiteToggleContainer.classList.add('hidden');
        if (prerequisiteToggle) {
            prerequisiteToggle.disabled = true; // <-- disable for non-VIP
            prerequisiteToggle.checked = false; // optional: reset check state
        }

        if (fetchBtn) fetchBtn.classList.add('hidden');
        if (selectedList) selectedList.classList.add('hidden');
    }
};

	// === CUSTOM CONFIRMATION MODAL ===
const showConfirmModal = (message, onConfirm, onCancel) => {
    // Remove existing modal if any
    document.getElementById('confirm-modal')?.remove();
    
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'payment-modal';
    modal.style.display = 'block';
    
    modal.innerHTML = `
        <div class="payment-modal-content" style="max-width: 450px; margin: 15% auto;">
            <div class="text-center">
                <div class="mb-4">
                    <svg class="mx-auto h-12 w-12 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                </div>
                <h3 class="text-xl font-bold text-gray-900 mb-3">Xác nhận hủy thanh toán</h3>
                <p class="text-gray-700 mb-6">${message}</p>
                <div class="flex space-x-3 justify-center">
                    <button id="confirm-cancel-btn" class="bg-red-600 hover:bg-red-700 text-white font-semibold px-6 py-2 rounded-lg transition duration-300">
                        Xác nhận hủy
                    </button>
                    <button id="confirm-keep-btn" class="bg-gray-500 hover:bg-gray-600 text-white font-semibold px-6 py-2 rounded-lg transition duration-300">
                        Tiếp tục thanh toán
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
        modal.remove();
        if (onConfirm) onConfirm();
    });
    
    document.getElementById('confirm-keep-btn').addEventListener('click', () => {
        modal.remove();
        if (onCancel) onCancel();
    });
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
            if (onCancel) onCancel();
        }
    });
};

    // --- UI UPDATE FUNCTIONS ---
    const updateUIAfterLogin = (profile) => {
        loginForm.classList.add('hidden');

        // Create user panel if not exists
        if (!document.getElementById('user-panel-content')) {
            const panelContainer = document.createElement('div');
            panelContainer.id = 'user-panel-content';
            panelContainer.className = 'space-y-4';
            panelContainer.innerHTML = `
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
                        <div class="ml-3 text-gray-700 font-medium">Bao gồm môn điều kiện</div>
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
            `;
            loginForm.parentNode.insertBefore(panelContainer, loginForm.nextSibling);

            // Re-assign element variables
            greetingMsg = document.getElementById('greeting-msg');
            vipStatusElement = document.getElementById('vip-status');
            upgradeVipBtn = document.getElementById('upgrade-vip-btn');
            prerequisiteToggle = document.getElementById('prerequisite-toggle');
            prerequisiteToggleContainer = document.getElementById('prerequisite-toggle-container');
            fetchBtn = document.getElementById('fetch-schedule-btn');
            logoutBtn = document.getElementById('logout-btn');
            progressBarContainer = document.getElementById('progress-bar-container');
            progressBarElement = document.getElementById('progress-bar-element');
            progressBarText = document.getElementById('progress-bar-text');

            // Add event listeners
            if (fetchBtn) fetchBtn.originalHTML = fetchBtn.innerHTML;
            if (logoutBtn) logoutBtn.originalHTML = logoutBtn.innerHTML;
            fetchBtn.addEventListener('click', fetchFullSchedule);
            logoutBtn.addEventListener('click', handleLogout);
            upgradeVipBtn.addEventListener('click', showVIPModal);
            prerequisiteToggle.addEventListener('change', fetchRegisteredClasses);
        }

        greetingMsg.textContent = `Xin chào, ${profile.hoDem} ${profile.ten}!`;
        document.getElementById('user-panel-content').classList.remove('hidden');

        // Update VIP display
        updateVIPDisplay();
    };

    const resetUI = () => {
        loginForm.classList.remove('hidden');
        const panel = document.getElementById('user-panel-content');
        if (panel) panel.classList.add('hidden');

        scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập để xem dữ liệu.</p>';
        registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có dữ liệu.</p>';
        logOutput.innerHTML = '';
        subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>';
        searchInput.value = '';
        allScheduleData = [];
        selectedClasses.clear();
        updateSelectedList();

        if (paymentCheckInterval) clearInterval(paymentCheckInterval);
        currentOrder = null;
    };

    const updateProgressBar = (current, total, message = '') => {
        if (!progressBarContainer) return;
        if (current === -1) {
            progressBarContainer.classList.add('hidden');
            return;
        }
        progressBarContainer.classList.remove('hidden');
        const percentage = total > 0 ? (current / total) * 100 : 0;
        progressBarElement.style.width = `${percentage}%`;
        progressBarText.textContent = message;
    };

    // --- CORE LOGIC FUNCTIONS ---
    // Save cached data to localStorage
    const saveCachedData = () => {
        try {
            const cacheData = {
                allScheduleData,
                registeredClassesData,
                selectedClasses: Array.from(selectedClasses.entries()),
                subjectTypeMap: Array.from(subjectTypeMap.entries()),
                prerequisiteToggleState: prerequisiteToggle?.checked || false,
                timestamp: new Date().getTime()
            };
            localStorage.setItem('userDataCache', JSON.stringify(cacheData));
        } catch (error) {
            console.error('Failed to save cache:', error);
        }
    };

    // Load cached data from localStorage
    const loadCachedData = () => {
        try {
            const cached = localStorage.getItem('userDataCache');
            if (!cached) return false;

            const cacheData = JSON.parse(cached);
            
            // Cache expires after 24 hours
            const CACHE_DURATION = 24 * 60 * 60 * 1000;
            if (new Date().getTime() - cacheData.timestamp > CACHE_DURATION) {
                localStorage.removeItem('userDataCache');
                return false;
            }

            // Restore data
            allScheduleData = cacheData.allScheduleData || [];
            registeredClassesData = cacheData.registeredClassesData || [];
            selectedClasses = new Map(cacheData.selectedClasses || []);
            subjectTypeMap = new Map(cacheData.subjectTypeMap || []);
            
            // Restore prerequisite toggle state
            if (prerequisiteToggle && cacheData.prerequisiteToggleState !== undefined) {
                prerequisiteToggle.checked = cacheData.prerequisiteToggleState;
            }

            return true;
        } catch (error) {
            console.error('Failed to load cache:', error);
            localStorage.removeItem('userDataCache');
            return false;
        }
    };

    const handleLogin = async () => {
        toggleLoading(loginBtn, true);
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !password) {
            log("Vui lòng nhập tên đăng nhập và mật khẩu.", true);
            toggleLoading(loginBtn, false);
            return;
        }

        const tokenRes = await backendRequest('login', { username, password });

        if (tokenRes && tokenRes.token) {
            authToken = tokenRes.token;
            
            // Save session to localStorage with JWT token
            localStorage.setItem('userSession', JSON.stringify({
                token: authToken,
                username: username,
                loginTime: new Date().getTime()
            }));
            
            log("✅ Đăng nhập thành công.");
            const initialData = await backendRequest('getInitialData');
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                userId = initialData.profile.maSinhVien || initialData.profile.username;
                vipStatus = initialData.vip || { hasVIP: false };
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                updateUIAfterLogin(initialData.profile);
                
                // Try to load cached data first
                const hasCachedData = loadCachedData();
                
                if (hasCachedData) {
                    log('📦 Đã khôi phục dữ liệu từ cache');
                    
                    // Update UI with cached data
                    if (allScheduleData.length > 0) {
                        renderScheduleTable();
                        // Update button text to "Tải lại"
                        if (fetchBtn) {
                            const btnSpan = fetchBtn.querySelector('span');
                            if (btnSpan) btnSpan.textContent = 'Tải lại lịch học';
                            fetchBtn.originalHTML = fetchBtn.innerHTML;
                        }
                    }
                    
                    if (registeredClassesData.length > 0) {
                        renderRegisteredTable(registeredClassesData);
                    }
                    
                    if (selectedClasses.size > 0) {
                        updateSelectedList();
                    }
                } else {
                    // No cache, fetch fresh data
                    await fetchRegisteredClasses();
                }
                
                // Start VIP expiry check
                startVIPExpiryCheck();
            } else {
                log(`❌ Lỗi lấy dữ liệu ban đầu: ${initialData?.message || 'Không rõ'}`, true);
                authToken = null;
                localStorage.removeItem('userSession');
            }
        } else {
            log(`❌ Đăng nhập thất bại: ${tokenRes?.message || 'Lỗi không xác định'}`, true);
        }
        toggleLoading(loginBtn, false);
    };

    // Validate JWT token with portal API (via backend proxy to avoid CORS)
    const validateTokenWithPortal = async (token) => {
        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    action: 'validateToken'
                })
            });
            
            const data = await response.json();
            
            if (data.success && data.valid) {
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Token validation failed:', error);
            return false;
        }
    };

    // Auto-login with saved session
    const autoLogin = async () => {
        const session = localStorage.getItem('userSession');
        if (!session) return false;
        
        try {
            const { token, loginTime } = JSON.parse(session);
            
            // Session expires after 24 hours
            const SESSION_DURATION = 24 * 60 * 60 * 1000;
            if (new Date().getTime() - loginTime > SESSION_DURATION) {
                localStorage.removeItem('userSession');
                return false;
            }
            
            // Validate token with portal API
            const isValid = await validateTokenWithPortal(token);
            
            if (!isValid) {
                log('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', true);
                localStorage.removeItem('userSession');
                return false;
            }
            
            // Token is valid, restore session
            authToken = token;
            
            log('✅ Đã khôi phục phiên đăng nhập');
            
            const initialData = await backendRequest('getInitialData');
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                userId = initialData.profile.maSinhVien || initialData.profile.username;
                vipStatus = initialData.vip || { hasVIP: false };
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                updateUIAfterLogin(initialData.profile);
                
                // Try to load cached data first
                const hasCachedData = loadCachedData();
                
                if (hasCachedData) {
                    log('📦 Đã khôi phục dữ liệu từ cache');
                    
                    // Update UI with cached data
                    if (allScheduleData.length > 0) {
                        renderScheduleTable();
                        // Update button text to "Tải lại"
                        if (fetchBtn) {
                            const btnSpan = fetchBtn.querySelector('span');
                            if (btnSpan) btnSpan.textContent = 'Tải lại lịch học';
                            fetchBtn.originalHTML = fetchBtn.innerHTML;
                        }
                    }
                    
                    if (registeredClassesData.length > 0) {
                        renderRegisteredTable(registeredClassesData);
                    }
                    
                    if (selectedClasses.size > 0) {
                        updateSelectedList();
                    }
                } else {
                    // No cache, fetch fresh data
                    await fetchRegisteredClasses();
                }
                
                // Start VIP expiry check
                startVIPExpiryCheck();
                
                return true;
            } else {
                log('❌ Không thể tải dữ liệu, vui lòng đăng nhập lại', true);
                localStorage.removeItem('userSession');
                authToken = null;
                return false;
            }
        } catch (error) {
            console.error('Auto-login failed:', error);
            localStorage.removeItem('userSession');
            return false;
        }
    };

    const handleLogout = async () => {
        await stopProcess();
        
        // Stop VIP expiry check
        stopVIPExpiryCheck();
        
        authToken = null;
        dotId = null;
        userId = null;
        vipStatus = { hasVIP: false };
        
        // Clear session and cache
        localStorage.removeItem('userSession');
        localStorage.removeItem('userDataCache');

        // Reset fetch button to its initial state for the next login
        if (fetchBtn) {
            const btnSpan = fetchBtn.querySelector('span');
            if (btnSpan) {
                btnSpan.textContent = 'Tải lịch học';
            }
            fetchBtn.originalHTML = fetchBtn.innerHTML;
        }

        resetUI();
        log("Đã đăng xuất.");
    };

    const fetchFullSchedule = async () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        if (!vipStatus.hasVIP) {
            log("⚠️ Bạn cần nâng cấp VIP để lấy dữ liệu lịch học.", true);
            return;
        }
        toggleLoading(fetchBtn, true);
        isProcessStopped = false;
        log("♻️ Bắt đầu lấy toàn bộ lịch học từ server...");

        const fetchPrerequisites = prerequisiteToggle?.checked || false;

        const scheduleRes = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites, userId });

        if (scheduleRes && scheduleRes.success) {
            allScheduleData = scheduleRes.schedule;
            subjectTypeMap = new Map(Object.entries(scheduleRes.subjectTypes));
            log(`✅ Đã tải thành công ${allScheduleData.length} lớp học phần.`);

            // Save to cache
            saveCachedData();

            // Update button's originalHTML to its new state before toggling loading off
            fetchBtn.originalHTML = fetchBtn.originalHTML.replace('Tải lịch học', 'Tải lại lịch học');

            await renderScheduleTable();
        } else {
            log("❌ Lỗi khi tải lịch học từ server.", true);
        }
        updateProgressBar(-1);
        toggleLoading(fetchBtn, false);
    };

    const fetchRegisteredClasses = async () => {
        if (!authToken) return;
        toggleLoading(refreshRegisteredBtn, true);
        const fetchPrerequisites = vipStatus.hasVIP && prerequisiteToggle?.checked || false;

        const registeredRes = await backendRequest('getRegisteredClasses', { dotId, fetchPrerequisites, userId });

        if (registeredRes && registeredRes.success) {
            registeredClassesData = registeredRes.body; // Save for conflict detection
            await renderRegisteredTable(registeredRes.body);
            
            // Save to cache
            saveCachedData();
            
            // Re-render schedule table to update conflict highlights
            renderScheduleTable();
            log(`✅ Tải danh sách đã đăng ký thành công (${registeredRes.body.length} lớp).`);
        } else {
            log("❌ Lỗi khi tải danh sách đã đăng ký.", true);
        }
        toggleLoading(refreshRegisteredBtn, false);
    };

    const cancelRegistration = async (registrationId, tenMonHoc, source) => {
        if (!confirm(`Bạn có chắc muốn hủy môn "${tenMonHoc}" không?`)) return;
        log(`Đang hủy môn ${tenMonHoc}...`);

        const result = await backendRequest('cancel', { registrationId, source });

        if (result && result.success) {
            log(`✅ Hủy thành công.`);
            await fetchRegisteredClasses();
        } else {
            log(`❌ Hủy thất bại: ${result?.message || 'Lỗi'}`, true);
        }
    };

    const startInsertion = () => {
        if (!vipStatus.hasVIP) {
            log("⚠️ Bạn cần nâng cấp VIP để thực hiện chèn lớp.", true);
            return;
        }
        if (selectedClasses.size === 0) return log("Vui lòng chọn lớp để chèn.", true);
        stopProcess();
        isProcessStopped = false;
        toggleActionButtons(true);
        log("🚀 Bắt đầu quá trình chèn lớp...");

        const classesBySubject = new Map();
        selectedClasses.forEach(cls => {
            if (!classesBySubject.has(cls.maHocPhan)) classesBySubject.set(cls.maHocPhan, []);
            classesBySubject.get(cls.maHocPhan).push(cls);
        });
        const delay = parseInt(delayInput.value, 10) || 1000;

        classesBySubject.forEach((classes, maHocPhan) => {
            const tenMonHoc = classes[0].tenMonHoc || maHocPhan;
            const source = classes[0].source;

            const intervalId = setInterval(async () => {
                if (isProcessStopped) return;
                const statusRes = await backendRequest('checkClassStatus', { dotId, maHocPhan, source });

                if (!statusRes || !statusRes.success) return;

                for (const availableClass of statusRes.body) {
                    if (selectedClasses.has(availableClass.id.toString()) && availableClass.phanTramDangKy < 100) {
                        log(`[${tenMonHoc}] 🔔 Phát hiện lớp còn chỗ: ${availableClass.maLopHocPhan}`);
                        const regResult = await backendRequest('register', { classId: availableClass.id, source });

                        if (regResult && regResult.success) {
                            log(`🎉 [${tenMonHoc}] ĐĂNG KÝ THÀNH CÔNG! Dừng chèn cho môn này.`);
                            clearInterval(registrationIntervals.get(maHocPhan));
                            registrationIntervals.delete(maHocPhan);
                            classes.forEach(c => selectedClasses.delete(c.id.toString()));
                            await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                            if (registrationIntervals.size === 0) await stopProcess();
                            return;
                        } else {
                            log(`❌ [${tenMonHoc}] Chèn thất bại: ${regResult?.message || 'Lỗi'}`, true);
                        }
                    }
                }
            }, delay);
            registrationIntervals.set(maHocPhan, intervalId);
        });
    };

    const startRegistration = () => {
        if (!vipStatus.hasVIP) {
            log("⚠️ Bạn cần nâng cấp VIP để thực hiện đăng ký.", true);
            return;
        }
        if (selectedClasses.size === 0) return log("Vui lòng chọn lớp để đăng ký.", true);
        stopProcess();
        isProcessStopped = false;
        toggleActionButtons(true);
        log("🚀 Bắt đầu đăng ký liên tục...");

        const classesBySubject = new Map();
        selectedClasses.forEach(cls => {
            if (!classesBySubject.has(cls.maHocPhan)) classesBySubject.set(cls.maHocPhan, []);
            classesBySubject.get(cls.maHocPhan).push(cls);
        });
        const delay = parseInt(delayInput.value, 10) || 1000;

        classesBySubject.forEach((classes, maHocPhan) => {
            const tenMonHoc = classes[0].tenMonHoc;

            const intervalId = setInterval(async () => {
                if (isProcessStopped) return;
                for (const cls of classes) {
                    if (isProcessStopped) return;
                    log(`[${tenMonHoc}] ⏳ Gửi yêu cầu đăng ký lớp ${cls.maLopHocPhan}...`);
                    const result = await backendRequest('register', { classId: cls.id, source: cls.source });

                    if (result && (result.success || result.message === 'Bạn đã đăng ký môn này rồi.')) {
                        log(`🎉 [${tenMonHoc}] THÀNH CÔNG! Dừng đăng ký cho môn này.`);
                        clearInterval(registrationIntervals.get(maHocPhan));
                        registrationIntervals.delete(maHocPhan);
                        classes.forEach(c => selectedClasses.delete(c.id.toString()));
                        await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                        if (registrationIntervals.size === 0) await stopProcess();
                        return;
                    } else if (result) {
                        log(`❌ [${tenMonHoc}] Thất bại: ${result.message}`, true);
                    }
                }
            }, delay);
            registrationIntervals.set(maHocPhan, intervalId);
        });
    };

    const stopProcess = async () => {
        isProcessStopped = true;
        log("🛑 Đang dừng tất cả các quá trình...");
        registrationIntervals.forEach(clearInterval);
        registrationIntervals.clear();
        toggleActionButtons(false);
        log("🛑 Đã dừng tất cả quá trình.");
    };

    const toggleActionButtons = (isProcessing) => {
        if (vipStatus.hasVIP) {
            startInsertionBtn.classList.toggle('hidden', isProcessing);
            startRegistrationBtn.classList.toggle('hidden', isProcessing);
        }
        stopBtn.classList.toggle('hidden', !isProcessing);
    };

    // --- RENDER FUNCTIONS ---
    const renderScheduleTable = async () => {
        const query = searchInput.value.toLowerCase();
        const selectedSubject = subjectFilter.value;
        if (allScheduleData.length > 0) {
            const subjects = [...new Set(allScheduleData.map(cls => cls.tenMonHoc))].sort();
            subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>' + subjects.map(s => `<option value="${s}" ${s === selectedSubject ? 'selected' : ''}>${s}</option>`).join('');
        }
        // Show all classes including "Đã khóa lớp"
        const filteredData = allScheduleData.filter(cls =>
            (!selectedSubject || cls.tenMonHoc === selectedSubject) &&
            (`${cls.tenMonHoc} ${cls.maLopHocPhan} ${cls.maHocPhan}`.toLowerCase().includes(query))
        );
        if (filteredData.length === 0) {
            scheduleContainer.innerHTML = allScheduleData.length === 0 ? '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập và nhấn "Lấy Lịch Học".</p>' : '<p class="text-gray-500 text-center py-8">Không tìm thấy lớp học phần nào.</p>';
            return;
        }
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10"><tr>
                <th scope="col" class="px-6 py-3">Tên môn học & Lịch học</th><th scope="col" class="px-6 py-3">Mã LHP</th>
                <th scope="col" class="px-6 py-3">Loại HP</th><th scope="col" class="px-6 py-3">Số TC</th>
                <th scope="col" class="px-6 py-3">Trạng thái</th><th scope="col" class="px-6 py-3">Đã đăng ký</th>
            </tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        filteredData.forEach(cls => {
            const row = document.createElement('tr');
            const isSelected = selectedClasses.has(cls.id.toString());
            
            // Check if class is locked
            const isLocked = cls.tenTrangThai === 'Đã khóa lớp';
            
            // Check for schedule conflict
            const conflictCheck = checkScheduleConflict(cls.scheduleDetails, registeredClassesData);
            const hasConflict = conflictCheck.hasConflict;
            
            // Build row class and cursor based on status
            let rowClass = 'bg-white border-b transition-colors duration-200';
            if (isLocked) {
                // Locked class - gray background, not clickable
                rowClass += ' bg-gray-200 cursor-not-allowed opacity-60';
            } else if (hasConflict) {
                // Conflict - red background, not clickable
                rowClass += ' bg-red-100 cursor-not-allowed';
            } else if (isSelected) {
                // Selected - blue background, clickable
                rowClass += ' bg-blue-200 cursor-pointer hover:bg-sky-100';
            } else {
                // Normal - white background, clickable
                rowClass += ' cursor-pointer hover:bg-sky-100';
            }
            
            row.className = rowClass;
            row.dataset.classId = cls.id;
            
            // Store locked status
            if (isLocked) {
                row.dataset.isLocked = 'true';
            }
            
            // Store conflict info for tooltip
            if (hasConflict) {
                row.dataset.hasConflict = 'true';
                row.dataset.conflictInfo = JSON.stringify(conflictCheck.conflicts);
            }
            
            const isBatBuoc = subjectTypeMap.get(cls.maHocPhan);
            const typeHtml = cls.source === 'dkhpdk'
                ? `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-purple-200 text-purple-800 whitespace-nowrap">Điều kiện</span>`
                : (isBatBuoc === undefined
                    ? 'N/A'
                    : (isBatBuoc
                        ? `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-green-200 text-green-800 whitespace-nowrap">Bắt buộc</span>`
                        : `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-red-200 text-red-800 whitespace-nowrap">Tự chọn</span>`));
            
            // Add warnings below subject name (only conflict warning, not locked)
            let warnings = '';
            if (hasConflict) {
                warnings += '<div class="text-xs mt-1 text-red-600 font-bold">⚠️ TRÙNG LỊCH</div>';
            }
            
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900">${cls.tenMonHoc}${warnings}<div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(cls.scheduleDetails)}</div></th>
                <td class="px-6 py-4" data-label="Mã LHP">${cls.maLopHocPhan}</td>
                <td class="px-6 py-4 whitespace-nowrap" data-label="Loại HP">${typeHtml}</td>
                <td class="px-6 py-4" data-label="Số TC">${cls.soTinChi === 0 ? '' : (cls.soTinChi ?? 'N/A')}</td>
                <td class="px-6 py-4" data-label="Trạng thái">${cls.tenTrangThai || 'N/A'}</td>
                <td class="px-6 py-4 font-semibold ${cls.phanTramDangKy >= 100 ? 'text-red-500' : 'text-green-500'}" data-label="Đã ĐK">${cls.phanTramDangKy}%</td>`;
            tbody.appendChild(row);
        });
        scheduleContainer.innerHTML = '';
        scheduleContainer.appendChild(table);
    };

    const renderRegisteredTable = async (data) => {
        if (!data || data.length === 0) {
            registeredContainer.innerHTML = `<p class="text-gray-500 text-center py-8">Bạn chưa đăng ký học phần nào.</p>`;
            return;
        }
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10"><tr>
                <th scope="col" class="px-6 py-3">Tên môn học & Lịch học</th><th scope="col" class="px-6 py-3">Mã LHP</th>
                <th scope="col" class="px-6 py-3">Số TC</th><th scope="col" class="px-6 py-3">Trạng thái</th>
                <th scope="col" class="px-6 py-3">Hành động</th>
            </tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        data.forEach(reg => {
            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50';
            const sourceBadge = reg.source === 'dkhpdk' ? `<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-purple-200 text-purple-800">Điều kiện</span>` : '';
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900">${reg.tenMonHoc} ${sourceBadge}<div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(reg.scheduleDetails)}</div></th>
                <td class="px-6 py-4" data-label="Mã LHP">${reg.maLopHocPhan}</td>
                <td class="px-6 py-4" data-label="Số TC">${reg.soTinChi === 0 ? '' : (reg.soTinChi ?? 'N/A')}</td>
                <td class="px-6 py-4" data-label="Trạng thái">${reg.tenTrangThaiLopHocPhan || 'N/A'}</td>
                <td class="px-6 py-4" data-label="Hành động">${
                    reg.isAllowCancel === false
                        ? ''
                        : `<button data-reg-id="${reg.id ?? ''}" data-ten-mon="${reg.tenMonHoc ?? ''}" data-source="${reg.source ?? ''}" class="font-medium text-red-600 hover:underline cancel-btn">Hủy</button>`
                }</td>`;
            tbody.appendChild(row);
        });
        registeredContainer.innerHTML = '';
        registeredContainer.appendChild(table);
    };

    const updateSelectedList = async () => {
        if (!vipStatus.hasVIP) {
            selectedList.innerHTML = `<p class="text-gray-500">Chưa có lớp nào được chọn. Nâng cấp VIP để chọn lớp.</p>`;
            registrationControls.classList.add('hidden');
            return;
        }
        if (selectedClasses.size === 0) {
            selectedList.innerHTML = `<p class="text-gray-500">Chưa có lớp nào được chọn.</p>`;
            registrationControls.classList.add('hidden');
            
            // Save to cache even when empty
            saveCachedData();
            return;
        }
        selectedList.innerHTML = [...selectedClasses.values()].map(cls => {
            const sourceBadge = cls.source === 'dkhpdk' ? `<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded-sm bg-purple-200 text-purple-800">ĐK</span>` : '';
            return `
                <div class="flex justify-between items-center bg-blue-50 p-2 rounded-md hover:bg-blue-100">
                    <div>
                        <p class="font-semibold text-sm text-blue-800">${cls.tenMonHoc} ${sourceBadge}</p>
                        <div class="text-xs text-gray-600 mt-1">${formatSelectedClassDetail(cls, cls.scheduleDetails)}</div>
                    </div>
                    <button data-class-id="${cls.id}" class="remove-selected-btn text-red-500 hover:text-red-700 ml-2">&times;</button>
                </div>`;
        }).join('');
        registrationControls.classList.remove('hidden');
        
        // Save to cache whenever selection changes
        saveCachedData();
    };

    // --- EVENT LISTENERS ---
    
    // Try auto-login on page load
    autoLogin().then(success => {
        if (!success) {
            // Show login form if auto-login failed
            loginForm.classList.remove('hidden');
        }
    });
    
    loginBtn.addEventListener('click', handleLogin);
    refreshRegisteredBtn.addEventListener('click', fetchRegisteredClasses);
    startInsertionBtn.addEventListener('click', startInsertion);
    startRegistrationBtn.addEventListener('click', startRegistration);
    stopBtn.addEventListener('click', stopProcess);
    searchInput.addEventListener('input', () => renderScheduleTable());
    subjectFilter.addEventListener('change', () => renderScheduleTable());
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    document.addEventListener('click', (e) => {
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow) {
            // Check if class is locked
            if (scheduleRow.dataset.isLocked === 'true') {
                log('🔒 Không thể chọn lớp này vì đã bị khóa', true);
                return;
            }
            
            // Check if row has conflict
            if (scheduleRow.dataset.hasConflict === 'true') {
                const conflicts = JSON.parse(scheduleRow.dataset.conflictInfo);
                const conflictMessages = conflicts.map(c => 
                    `- ${c.registeredClass} (${c.registeredCode}): ${c.day}, Tiết ${c.conflictPeriod}`
                ).join('\n');
                log(`⚠️ Không thể chọn lớp này vì trùng lịch với:\n${conflictMessages}`, true);
                return;
            }
            
            if (!vipStatus.hasVIP) {
                log("⚠️ Bạn cần nâng cấp VIP để chọn lớp.", true);
                return;
            }
            const classId = scheduleRow.dataset.classId;
            const cls = allScheduleData.find(c => c.id.toString() === classId);
            if (!cls) return;
            if (selectedClasses.has(classId)) selectedClasses.delete(classId);
            else selectedClasses.set(classId, cls);
            scheduleRow.classList.toggle('bg-blue-200');
            updateSelectedList();
        }
        const removeBtn = e.target.closest('.remove-selected-btn');
        if (removeBtn) {
            if (!vipStatus.hasVIP) {
                log("⚠️ Bạn cần nâng cấp VIP để chỉnh sửa danh sách lớp.", true);
                return;
            }
            const classId = removeBtn.dataset.classId;
            selectedClasses.delete(classId);
            const rowToUpdate = document.querySelector(`#schedule-container tr[data-class-id='${classId}']`);
            if (rowToUpdate) rowToUpdate.classList.remove('bg-blue-200');
            updateSelectedList();
        }
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const { regId, tenMon, source } = cancelBtn.dataset;
            cancelRegistration(regId, tenMon, source);
        }
    });

    // Add hover tooltip for conflict rows
    let tooltipElement = null;
    
    document.addEventListener('mouseover', (e) => {
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow && scheduleRow.dataset.hasConflict === 'true') {
            // Remove existing tooltip
            if (tooltipElement) {
                tooltipElement.remove();
                tooltipElement = null;
            }
            
            // Create tooltip
            const conflicts = JSON.parse(scheduleRow.dataset.conflictInfo);
            const conflictMessages = conflicts.map(c => 
                `<div class="py-1">• <strong>${c.registeredClass}</strong> (${c.registeredCode})<br/>&nbsp;&nbsp;${c.day}, Tiết ${c.conflictPeriod} (trùng với tiết ${c.period})</div>`
            ).join('');
            
            tooltipElement = document.createElement('div');
            tooltipElement.className = 'fixed bg-red-600 text-white text-sm px-4 py-3 rounded-lg shadow-lg z-50 max-w-md';
            tooltipElement.innerHTML = `
                <div class="font-bold mb-2">⚠️ TRÙNG LỊCH HỌC</div>
                ${conflictMessages}
            `;
            
            document.body.appendChild(tooltipElement);
            
            // Position tooltip near cursor
            const updateTooltipPosition = (event) => {
                const x = event.clientX + 15;
                const y = event.clientY + 15;
                tooltipElement.style.left = x + 'px';
                tooltipElement.style.top = y + 'px';
            };
            
            updateTooltipPosition(e);
            scheduleRow.addEventListener('mousemove', updateTooltipPosition);
            scheduleRow.addEventListener('mouseleave', () => {
                if (tooltipElement) {
                    tooltipElement.remove();
                    tooltipElement = null;
                }
            });
        }
    });
});
