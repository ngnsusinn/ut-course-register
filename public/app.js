document.addEventListener('DOMContentLoaded', () => {
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
    let swapPendingClasses = new Map(); // Store classes pending swap: key = targetClassId, value = { registered, target }
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;
    let currentOrder = null;
    let paymentCheckInterval = null;
    let vipExpiryCheckInterval = null;
    
    // Expose data for timetable module
    window.getRegisteredClassesData = () => registeredClassesData;
    window.getSelectedClassesData = () => {
        const allClasses = [];
        
        // Add regular selected classes
        selectedClasses.forEach(cls => {
            allClasses.push(cls);
        });
        
        // Add target classes from swap pending (not registered classes)
        swapPendingClasses.forEach(swap => {
            allClasses.push(swap.target);
        });
        
        return allClasses;
    };

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

        // Use Map to group conflicts by registered class (maLopHocPhan)
        const conflictMap = new Map();

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
                uniqueConflicts: uniqueConflicts // Keep detailed conflict info for tooltip
            };
        });

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

        // Remove existing modal if any
        document.getElementById('vip-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'vip-modal';
        modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in';

        const plans = plansRes.plans;
        
        // Check if user has VIP to show appropriate title
        const isRenewal = vipStatus.hasVIP;
        const modalTitle = isRenewal ? 'Gia hạn VIP' : 'Nâng cấp VIP';
        const modalDesc = isRenewal ? 'Gia hạn để duy trì các tính năng đặc biệt' : 'Mở khóa các tính năng mạnh mẽ giúp bạn đăng ký học phần dễ dàng hơn';

        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                <div class="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 class="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <span class="text-yellow-500">👑</span> ${modalTitle}
                        </h2>
                        <p class="text-sm text-slate-500 mt-1">${modalDesc}</p>
                    </div>
                    <button class="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition close-modal-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                
                <div class="p-8 overflow-y-auto custom-scrollbar bg-white">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        ${Object.entries(plans).map(([key, plan]) => {
                            const isPopular = key === 'semester'; // Assuming semester is popular
                            return `
                            <div class="relative border ${isPopular ? 'border-blue-500 shadow-blue-100 ring-1 ring-blue-500' : 'border-slate-200'} rounded-2xl p-6 hover:shadow-xl transition-all duration-300 flex flex-col h-full group bg-white">
                                ${isPopular ? '<div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-blue-500/30">PHỔ BIẾN NHẤT</div>' : ''}
                                
                                <h3 class="font-bold text-lg text-slate-800 mb-2 group-hover:text-blue-600 transition-colors">${plan.name}</h3>
                                <div class="mb-4">
                                    <span class="text-3xl font-bold text-slate-900">${(plan.price / 1000).toLocaleString('vi-VN')}k</span>
                                    <span class="text-slate-500 text-sm">/${plan.duration} ngày</span>
                                </div>
                                
                                <ul class="space-y-3 mb-8 flex-1">
                                    <li class="flex items-start gap-2 text-sm text-slate-600">
                                        <svg class="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                        <span>Đăng ký tự động</span>
                                    </li>
                                    <li class="flex items-start gap-2 text-sm text-slate-600">
                                        <svg class="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                        <span>Săn lớp nhanh chóng</span>
                                    </li>
                                    <li class="flex items-start gap-2 text-sm text-slate-600">
                                        <svg class="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                        <span>Hỗ trợ 24/7</span>
                                    </li>
                                </ul>
                                
                                <button class="w-full bg-slate-900 hover:bg-blue-600 text-white font-bold py-3 rounded-xl transition-all duration-300 shadow-lg hover:shadow-blue-500/30 buy-plan-btn flex items-center justify-center gap-2" data-plan="${key}">
                                    <span>${isRenewal ? 'Gia hạn ngay' : 'Chọn gói này'}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                                </button>
                            </div>
                        `}).join('')}
                    </div>
                    
                    <div class="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-blue-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <div class="text-sm text-blue-800">
                            <p class="font-bold mb-1">Lưu ý quan trọng</p>
                            <p>Hệ thống sẽ chuyển hướng bạn đến cổng thanh toán Zypage. Vui lòng không tắt trình duyệt trong quá trình thanh toán. Tài khoản sẽ được kích hoạt tự động ngay sau khi thanh toán thành công.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close modal event
        modal.querySelector('.close-modal-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // Handle plan selection
        modal.querySelectorAll('.buy-plan-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const planKey = e.currentTarget.dataset.plan;
                const plan = plans[planKey];
                
                // Redirect to Zypage
                const zypageUrl = `https://zypage.com/payment?amount=${plan.price}&content=${userId}`;
                
                // Show loading state on button
                const btn = e.currentTarget;
                const originalContent = btn.innerHTML;
                btn.innerHTML = '<div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>';
                btn.disabled = true;
                
                log(`Đang chuyển hướng đến trang thanh toán...`);
                
                setTimeout(() => {
                    window.open(zypageUrl, '_blank');
                    modal.remove();
                }, 800);
            });
        });
    };

    // Removed createVIPOrder and startPaymentCheck as we are redirecting directly
    const createVIPOrder = async () => {};
    const startPaymentCheck = () => {};


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
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                </div>
                <div>
                    <p class="font-bold text-slate-800 text-sm">Thành viên VIP</p>
                    <p class="text-xs text-slate-500">Còn lại <span class="font-bold text-orange-500">${vipStatus.daysLeft} ngày</span></p>
                </div>
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

        if (prerequisiteToggleContainer) prerequisiteToggleContainer.classList.remove('opacity-50', 'pointer-events-none');
        if (prerequisiteToggle) prerequisiteToggle.disabled = false;

        if (fetchBtn) fetchBtn.classList.remove('hidden');
        if (selectedList) selectedList.classList.remove('hidden');
    } else {
        vipStatusElement.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </div>
                <div>
                    <p class="font-bold text-slate-800 text-sm">Tài khoản thường</p>
                    <p class="text-xs text-slate-500">Nâng cấp để mở khóa tính năng</p>
                </div>
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

        if (prerequisiteToggleContainer) prerequisiteToggleContainer.classList.add('opacity-50', 'pointer-events-none');
        if (prerequisiteToggle) {
            prerequisiteToggle.disabled = true;
            prerequisiteToggle.checked = false;
            // Reset visual toggle state
            const dot = prerequisiteToggle.nextElementSibling?.nextElementSibling;
            const block = prerequisiteToggle.nextElementSibling;
            if(dot && block) {
                dot.classList.remove('translate-x-4');
                block.classList.add('bg-slate-200');
                block.classList.remove('bg-blue-500');
            }
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
    modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-fade-in';
    
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100">
            <div class="p-6 text-center">
                <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-amber-100 mb-6">
                    <svg class="h-10 w-10 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                </div>
                <h3 class="text-xl font-bold text-slate-800 mb-2">Xác nhận hành động</h3>
                <p class="text-slate-500 mb-8">${message}</p>
                <div class="flex space-x-3 justify-center">
                    <button id="confirm-cancel-btn" class="flex-1 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold px-4 py-2.5 rounded-xl transition duration-200">
                        Hủy bỏ
                    </button>
                    <button id="confirm-keep-btn" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-xl transition duration-200 shadow-lg shadow-blue-500/30">
                        Xác nhận
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
        modal.remove();
        if (onCancel) onCancel();
    });
    
    document.getElementById('confirm-keep-btn').addEventListener('click', () => {
        modal.remove();
        if (onConfirm) onConfirm();
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
            panelContainer.className = 'space-y-5 animate-fade-in';
            panelContainer.innerHTML = `
                <div class="flex items-center gap-3 pb-4 border-b border-slate-100">
                    <div class="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl">
                        ${profile.hoDem ? profile.hoDem.charAt(0) : 'U'}
                    </div>
                    <div>
                        <div id="greeting-msg" class="font-bold text-slate-800 text-lg"></div>
                        <div class="text-xs text-slate-500 font-medium">${profile.maSinhVien || 'Student'}</div>
                    </div>
                </div>
                
                <div id="vip-status-section" class="bg-slate-50 rounded-xl border border-slate-200 p-4">
                    <div id="vip-status"></div>
                </div>
                
                <button id="upgrade-vip-btn" class="w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all duration-300 transform hover:-translate-y-0.5 flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span>Nâng cấp VIP</span>
                </button>
                
                <div id="prerequisite-toggle-container" class="flex items-center justify-between px-1">
                    <span class="text-sm font-medium text-slate-600">Bao gồm môn điều kiện</span>
                    <label for="prerequisite-toggle" class="flex items-center cursor-pointer relative">
                        <input type="checkbox" id="prerequisite-toggle" class="sr-only" disabled>
                        <div class="block bg-slate-200 w-10 h-6 rounded-full transition-colors duration-300 ease-in-out peer-checked:bg-blue-500"></div>
                        <div class="dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 ease-in-out peer-checked:translate-x-4 shadow-sm"></div>
                    </label>
                </div>
                
                <div id="progress-bar-container" class="hidden space-y-2">
                    <div class="flex justify-between text-xs font-medium text-slate-500">
                        <span>Tiến độ</span>
                        <span id="progress-bar-text">0%</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div id="progress-bar-element" class="bg-blue-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button id="fetch-schedule-btn" class="col-span-1 bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM6 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" />
                        </svg>
                        <span>Lấy lịch</span>
                    </button>

                    <button id="view-timetable-btn" class="col-span-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-bold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd" />
                        </svg>
                        <span>Xem TKB</span>
                    </button>
                    
                    <button id="logout-btn" class="col-span-2 border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        <span>Đăng xuất</span>
                    </button>
                </div>
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
            document.getElementById('view-timetable-btn')?.addEventListener('click', () => {
                if (window.showTimetableModal) window.showTimetableModal();
            });
            prerequisiteToggle.addEventListener('change', fetchRegisteredClasses);
            
            // Add toggle listener for custom checkbox style
            prerequisiteToggle.addEventListener('change', function() {
                const dot = this.nextElementSibling.nextElementSibling;
                const block = this.nextElementSibling;
                if(this.checked) {
                    dot.classList.add('translate-x-4');
                    block.classList.remove('bg-slate-200');
                    block.classList.add('bg-blue-500');
                } else {
                    dot.classList.remove('translate-x-4');
                    block.classList.add('bg-slate-200');
                    block.classList.remove('bg-blue-500');
                }
            });
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
        swapPendingClasses.clear();
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
    // Save cached data to localStorage (include user info)
    const saveCachedData = () => {
        try {
            const cacheData = {
                userId: userId, // Store current userId to verify cache ownership
                allScheduleData,
                registeredClassesData,
                selectedClasses: Array.from(selectedClasses.entries()),
                swapPendingClasses: Array.from(swapPendingClasses.entries()),
                subjectTypeMap: Array.from(subjectTypeMap.entries()),
                prerequisiteToggleState: prerequisiteToggle?.checked || false,
                timestamp: new Date().getTime()
            };
            localStorage.setItem('userDataCache', JSON.stringify(cacheData));
        } catch (error) {
            console.error('Failed to save cache:', error);
        }
    };

    // Load cached data from localStorage (check user ID match)
    const loadCachedData = (currentUserId) => {
        try {
            const cached = localStorage.getItem('userDataCache');
            if (!cached) return false;

            const cacheData = JSON.parse(cached);
            
            // Check if cached data belongs to a different user
            if (cacheData.userId && cacheData.userId !== currentUserId) {
                console.log('Cache belongs to different user, clearing...');
                localStorage.removeItem('userDataCache');
                return false;
            }
            
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
            swapPendingClasses = new Map(cacheData.swapPendingClasses || []);
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
                
                // Try to load cached data first (check if belongs to current user)
                const hasCachedData = loadCachedData(userId);
                
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
                
                // Try to load cached data first (check if belongs to current user)
                const hasCachedData = loadCachedData(userId);
                
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
        // Always fetch prerequisites (set to true)
        const fetchPrerequisites = true;

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

    // Swap class function - Cancel registered class and register target class
    const swapClass = async (registeredData, targetData) => {
        const { id: regId, code: regCode, name: regName, source: regSource } = registeredData;
        const { id: targetId, code: targetCode, name: targetName, source: targetSource } = targetData;
        
        log(`🔄 Bắt đầu đổi lớp: ${regName} → ${targetName}`);
        
        // Step 1: Validate registered class can be cancelled
        log(`🔍 Kiểm tra lớp đã đăng ký ${regCode}...`);
        const registeredClass = registeredClassesData.find(c => c.id.toString() === regId);
        
        if (!registeredClass) {
            log(`❌ Không tìm thấy thông tin lớp đã đăng ký ${regCode}`, true);
            return false;
        }
        
        // Check if registered class can be cancelled based on status
        const registeredStatus = registeredClass.tenTrangThaiLopHocPhan || '';
        
        if (registeredStatus === 'Đã khóa lớp') {
            log(`❌ Không thể hủy lớp ${regCode} - Trạng thái: ${registeredStatus}`, true);
            return false;
        }
        
        if (registeredStatus === 'Đã mở chính thức') {
            log(`❌ Không thể hủy lớp ${regCode} - Trạng thái: ${registeredStatus}`, true);
            return false;
        }
        
        if (registeredStatus === 'Đang lên kế hoạch') {
            log(`❌ Không thể hủy lớp ${regCode} - Trạng thái: ${registeredStatus}`, true);
            return false;
        }
        
        if (registeredStatus !== 'Đang chờ đăng ký' && registeredClass.isAllowCancel === false) {
            log(`❌ Không thể hủy lớp ${regCode} - Trạng thái: ${registeredStatus}`, true);
            return false;
        }
        
        log(`✓ Lớp ${regCode} có thể hủy (trạng thái: ${registeredStatus})`);
        
        // Step 2: Validate target class can be registered
        log(`📊 Kiểm tra lớp đích ${targetCode}...`);
        const targetClass = allScheduleData.find(c => c.id.toString() === targetId);
        
        if (!targetClass) {
            log(`❌ Không tìm thấy thông tin lớp đích ${targetCode}`, true);
            return false;
        }
        
        // Check target class status
        const targetStatus = targetClass.tenTrangThai || '';
        
        if (targetStatus === 'Đã khóa lớp') {
            log(`❌ Không thể đăng ký lớp ${targetCode} - Trạng thái: ${targetStatus}`, true);
            return false;
        }
        
        if (targetStatus === 'Đang lên kế hoạch') {
            log(`❌ Không thể đăng ký lớp ${targetCode} - Trạng thái: ${targetStatus}`, true);
            return false;
        }
        
        // Check if target class has available slots
        if (targetClass.phanTramDangKy >= 100) {
            log(`❌ Lớp ${targetCode} đã đầy (${targetClass.phanTramDangKy}%), không thể đổi lớp`, true);
            return false;
        }
        
        log(`✓ Lớp ${targetCode} có thể đăng ký (trạng thái: ${targetStatus}, ${targetClass.phanTramDangKy}% đã đăng ký)`);
        
        // Step 3: Cancel registered class
        log(`🗑️ Đang hủy lớp ${regName} (${regCode})...`);
        const cancelResult = await backendRequest('cancel', { registrationId: regId, source: regSource });
        
        if (!cancelResult || !cancelResult.success) {
            log(`❌ Hủy lớp ${regCode} thất bại: ${cancelResult?.message || 'Lỗi'}`, true);
            return false;
        }
        
        log(`✅ Đã hủy lớp ${regCode} thành công`);
        
        // Step 4: Register target class
        log(`📝 Đang đăng ký lớp ${targetName} (${targetCode})...`);
        const registerResult = await backendRequest('register', { classId: targetId, source: targetSource });
        
        if (!registerResult || !registerResult.success) {
            log(`❌ Đăng ký lớp ${targetCode} thất bại: ${registerResult?.message || 'Lỗi'}`, true);
            log(`⚠️ LƯU Ý: Bạn đã hủy lớp ${regCode}, vui lòng đăng ký lại thủ công!`, true);
            return false;
        }
        
        log(`✅ Đăng ký lớp ${targetCode} thành công!`);
        log(`🎉 Đổi lớp hoàn tất: ${regName} → ${targetName}`);
        
        // Refresh registered classes list
        await fetchRegisteredClasses();
        
        return true;
    };

    const startInsertion = () => {
        if (!vipStatus.hasVIP) {
            log("⚠️ Bạn cần nâng cấp VIP để thực hiện chèn lớp.", true);
            return;
        }
        
        const totalClasses = selectedClasses.size + swapPendingClasses.size;
        if (totalClasses === 0) {
            return log("Vui lòng chọn lớp để chèn.", true);
        }
        
        stopProcess();
        isProcessStopped = false;
        toggleActionButtons(true);
        log("🚀 Bắt đầu quá trình chèn lớp...");

        const classesBySubject = new Map();
        
        // Add regular selected classes
        selectedClasses.forEach(cls => {
            if (!classesBySubject.has(cls.maHocPhan)) classesBySubject.set(cls.maHocPhan, []);
            classesBySubject.get(cls.maHocPhan).push({ type: 'regular', class: cls });
        });
        
        // Add swap pending classes (only target classes for insertion)
        swapPendingClasses.forEach((swap, targetClassId) => {
            const targetClass = swap.target;
            if (!classesBySubject.has(targetClass.maHocPhan)) classesBySubject.set(targetClass.maHocPhan, []);
            classesBySubject.get(targetClass.maHocPhan).push({ 
                type: 'swap', 
                class: targetClass,
                registeredClass: swap.registered
            });
        });
        
        const delay = parseInt(delayInput.value, 10) || 1000;

        classesBySubject.forEach((classItems, maHocPhan) => {
            const tenMonHoc = classItems[0].class.tenMonHoc || maHocPhan;
            const source = classItems[0].class.source;

            const intervalId = setInterval(async () => {
                if (isProcessStopped) return;
                const statusRes = await backendRequest('checkClassStatus', { dotId, maHocPhan, source });

                if (!statusRes || !statusRes.success) return;

                for (const availableClass of statusRes.body) {
                    const matchedItem = classItems.find(item => item.class.id.toString() === availableClass.id.toString());
                    
                    if (matchedItem && availableClass.phanTramDangKy < 100) {
                        if (matchedItem.type === 'swap') {
                            // Handle swap: cancel old class first, then register new class
                            const regClass = matchedItem.registeredClass;
                            log(`[${tenMonHoc}] 🔔 Đổi lớp: ${regClass.maLopHocPhan} → ${availableClass.maLopHocPhan}`);
                            
                            const swapResult = await swapClass(
                                {
                                    id: regClass.id,
                                    code: regClass.maLopHocPhan,
                                    name: regClass.tenMonHoc,
                                    source: regClass.source
                                },
                                {
                                    id: availableClass.id,
                                    code: availableClass.maLopHocPhan,
                                    name: availableClass.tenMonHoc,
                                    source: availableClass.source
                                }
                            );
                            
                            if (swapResult) {
                                log(`🎉 [${tenMonHoc}] ĐỔI LỚP THÀNH CÔNG! Dừng chèn cho môn này.`);
                                swapPendingClasses.delete(matchedItem.class.id.toString());
                                updateSelectedList();
                                clearInterval(registrationIntervals.get(maHocPhan));
                                registrationIntervals.delete(maHocPhan);
                                break;
                            }
                        } else {
                            // Handle regular registration
                            log(`[${tenMonHoc}] 🔔 Phát hiện lớp còn chỗ: ${availableClass.maLopHocPhan}`);
                            const regResult = await backendRequest('register', { classId: availableClass.id, source });

                            if (regResult && regResult.success) {
                                log(`🎉 [${tenMonHoc}] ĐĂNG KÝ THÀNH CÔNG! Dừng chèn cho môn này.`);
                                clearInterval(registrationIntervals.get(maHocPhan));
                                registrationIntervals.delete(maHocPhan);
                                selectedClasses.delete(availableClass.id.toString());
                                await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                                if (registrationIntervals.size === 0) await stopProcess();
                                return;
                            } else {
                                log(`❌ [${tenMonHoc}] Chèn thất bại: ${regResult?.message || 'Lỗi'}`, true);
                            }
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
        
        const totalClasses = selectedClasses.size + swapPendingClasses.size;
        if (totalClasses === 0) {
            return log("Vui lòng chọn lớp để đăng ký.", true);
        }
        
        stopProcess();
        isProcessStopped = false;
        toggleActionButtons(true);
        log("🚀 Bắt đầu đăng ký liên tục...");

        const classesBySubject = new Map();
        
        // Add regular selected classes
        selectedClasses.forEach(cls => {
            if (!classesBySubject.has(cls.maHocPhan)) classesBySubject.set(cls.maHocPhan, []);
            classesBySubject.get(cls.maHocPhan).push({ type: 'regular', class: cls });
        });
        
        // Add swap pending classes
        swapPendingClasses.forEach((swap, targetClassId) => {
            const targetClass = swap.target;
            if (!classesBySubject.has(targetClass.maHocPhan)) classesBySubject.set(targetClass.maHocPhan, []);
            classesBySubject.get(targetClass.maHocPhan).push({ 
                type: 'swap', 
                class: targetClass,
                registeredClass: swap.registered
            });
        });
        
        const delay = parseInt(delayInput.value, 10) || 1000;

        classesBySubject.forEach((classItems, maHocPhan) => {
            const tenMonHoc = classItems[0].class.tenMonHoc;

            const intervalId = setInterval(async () => {
                if (isProcessStopped) return;
                
                for (const item of classItems) {
                    if (isProcessStopped) return;
                    
                    if (item.type === 'swap') {
                        // Handle swap registration
                        const regClass = item.registeredClass;
                        log(`[${tenMonHoc}] 🔄 Thử đổi lớp: ${regClass.maLopHocPhan} → ${item.class.maLopHocPhan}`);
                        
                        const swapResult = await swapClass(
                            {
                                id: regClass.id,
                                code: regClass.maLopHocPhan,
                                name: regClass.tenMonHoc,
                                source: regClass.source
                            },
                            {
                                id: item.class.id,
                                code: item.class.maLopHocPhan,
                                name: item.class.tenMonHoc,
                                source: item.class.source
                            }
                        );
                        
                        if (swapResult) {
                            swapPendingClasses.delete(item.class.id.toString());
                            await updateSelectedList();
                            clearInterval(registrationIntervals.get(maHocPhan));
                            registrationIntervals.delete(maHocPhan);
                            if (registrationIntervals.size === 0) await stopProcess();
                            return;
                        }
                    } else {
                        // Handle regular registration
                        log(`[${tenMonHoc}] ⏳ Gửi yêu cầu đăng ký lớp ${item.class.maLopHocPhan}...`);
                        const result = await backendRequest('register', { classId: item.class.id, source: item.class.source });

                        if (result && (result.success || result.message === 'Bạn đã đăng ký môn này rồi.')) {
                            log(`🎉 [${tenMonHoc}] THÀNH CÔNG! Dừng đăng ký cho môn này.`);
                            clearInterval(registrationIntervals.get(maHocPhan));
                            registrationIntervals.delete(maHocPhan);
                            selectedClasses.delete(item.class.id.toString());
                            await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                            if (registrationIntervals.size === 0) await stopProcess();
                            return;
                        } else if (result) {
                            log(`❌ [${tenMonHoc}] Thất bại: ${result.message}`, true);
                        }
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
            // Only update if options count changed to avoid resetting selection
            if (subjectFilter.options.length !== subjects.length + 1) {
                 const currentVal = subjectFilter.value;
                 subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>' + subjects.map(s => `<option value="${s}">${s}</option>`).join('');
                 subjectFilter.value = currentVal;
            }
        }
        // Show all classes including "Đã khóa lớp"
        const filteredData = allScheduleData.filter(cls =>
            (!selectedSubject || cls.tenMonHoc === selectedSubject) &&
            (`${cls.tenMonHoc} ${cls.maLopHocPhan} ${cls.maHocPhan}`.toLowerCase().includes(query))
        );
        
        if (filteredData.length === 0) {
            scheduleContainer.innerHTML = allScheduleData.length === 0 
                ? '<div class="flex flex-col items-center justify-center h-48 text-slate-400"><svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg><p>Vui lòng đăng nhập và nhấn "Lấy Lịch Học".</p></div>' 
                : '<div class="flex flex-col items-center justify-center h-48 text-slate-400"><svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg><p>Không tìm thấy lớp học phần nào.</p></div>';
            return;
        }
        
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-slate-600';
        table.innerHTML = `
            <thead class="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr>
                    <th scope="col" class="px-6 py-4 font-semibold">Tên môn học & Lịch học</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Mã LHP</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Loại HP</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Số TC</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Trạng thái</th>
                    <th scope="col" class="px-6 py-4 font-semibold text-right">Đã đăng ký</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100"></tbody>`;
            
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
            let rowClass = 'transition-all duration-200 group';
            if (isLocked) {
                rowClass += ' bg-slate-50 cursor-not-allowed opacity-60 grayscale';
            } else if (hasConflict) {
                rowClass += ' bg-red-50/50 hover:bg-red-50 cursor-not-allowed';
            } else if (isSelected) {
                rowClass += ' bg-blue-50 hover:bg-blue-100 cursor-pointer border-l-4 border-blue-500';
            } else {
                rowClass += ' bg-white hover:bg-slate-50 cursor-pointer hover:shadow-sm';
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
                ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Điều kiện</span>`
                : (isBatBuoc === undefined
                    ? '<span class="text-slate-400">N/A</span>'
                    : (isBatBuoc
                        ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Bắt buộc</span>`
                        : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Tự chọn</span>`));
            
            // Add warnings below subject name
            let warnings = '';
            if (hasConflict) {
                const conflictSummary = conflictCheck.conflicts.map(c => c.registeredClass).join(', ');
                warnings += `
                    <div class="mt-2 flex items-start gap-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-100">
                        <svg class="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                    </svg>
                </div>
                <div class="text-sm text-red-700">
                    <span class="font-bold">Trùng lịch:</span> ${conflictSummary}
                </div>
            </div>
                `;
            }
            
            // Status badge
            let statusBadgeClass = 'bg-slate-100 text-slate-600';
            if (cls.tenTrangThai === 'Đã mở chính thức') statusBadgeClass = 'bg-emerald-100 text-emerald-700';
            else if (cls.tenTrangThai === 'Đã khóa lớp') statusBadgeClass = 'bg-rose-100 text-rose-700';
            else if (cls.tenTrangThai === 'Đang lên kế hoạch') statusBadgeClass = 'bg-amber-100 text-amber-700';
            else if (cls.tenTrangThai === 'Đang chờ đăng ký') statusBadgeClass = 'bg-blue-100 text-blue-700';

            const statusHtml = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass}">${cls.tenTrangThai || 'N/A'}</span>`;

            // Progress bar for registration percentage
            const percent = Math.min(cls.phanTramDangKy, 100);
            const percentColor = percent >= 100 ? 'bg-rose-500' : (percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500');
            
            row.innerHTML = `
                <th scope="row" class="px-6 py-4">
                    <div class="font-bold text-slate-800 text-base group-hover:text-blue-600 transition-colors">${cls.tenMonHoc}</div>
                    ${warnings}
                    <div class="mt-2 space-y-1 text-xs text-slate-500 border-l-2 border-slate-200 pl-3">
                        ${formatScheduleDetail(cls.scheduleDetails)}
                    </div>
                </th>
                <td class="px-6 py-4 font-mono text-xs font-medium text-slate-500">${cls.maLopHocPhan}</td>
                <td class="px-6 py-4 whitespace-nowrap">${typeHtml}</td>
                <td class="px-6 py-4 font-medium text-slate-700">${cls.soTinChi === 0 ? '' : (cls.soTinChi ?? '-')}</td>
                <td class="px-6 py-4 whitespace-nowrap">${statusHtml}</td>
                <td class="px-6 py-4 text-right">
                    <div class="flex flex-col items-end gap-1">
                        <span class="font-bold ${percent >= 100 ? 'text-rose-600' : 'text-emerald-600'}">${cls.phanTramDangKy}%</span>
                        <div class="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div class="h-full ${percentColor}" style="width: ${percent}%"></div>
                        </div>
                    </div>
                </td>`;
            tbody.appendChild(row);
        });
        scheduleContainer.innerHTML = '';
        scheduleContainer.appendChild(table);
    };

    const renderRegisteredTable = async (data) => {
        if (!data || data.length === 0) {
            registeredContainer.innerHTML = `<div class="flex flex-col items-center justify-center h-32 text-slate-400 text-sm"><p>Bạn chưa đăng ký học phần nào.</p></div>`;
            return;
        }
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-slate-600';
        table.innerHTML = `
            <thead class="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr>
                    <th scope="col" class="px-6 py-4 font-semibold">Tên môn học & Lịch học</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Mã LHP</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Số TC</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Trạng thái</th>
                    <th scope="col" class="px-6 py-4 font-semibold text-right">Hành động</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100"></tbody>`;
            
        const tbody = table.querySelector('tbody');
        data.forEach(reg => {
            const row = document.createElement('tr');
            row.className = 'bg-white hover:bg-slate-50 transition-colors';
            
            const sourceBadge = reg.source === 'dkhpdk' 
                ? `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">Điều kiện</span>` 
                : '';
                
            // Status badge
            let statusBadgeClass = 'bg-slate-100 text-slate-600';
            if (reg.tenTrangThaiLopHocPhan === 'Đã mở chính thức') statusBadgeClass = 'bg-emerald-100 text-emerald-700';
            else if (reg.tenTrangThaiLopHocPhan === 'Đã khóa lớp') statusBadgeClass = 'bg-rose-100 text-rose-700';
            else if (reg.tenTrangThaiLopHocPhan === 'Đang lên kế hoạch') statusBadgeClass = 'bg-amber-100 text-amber-700';
            else if (reg.tenTrangThaiLopHocPhan === 'Đang chờ đăng ký') statusBadgeClass = 'bg-blue-100 text-blue-700';

            const statusHtml = `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass}">${reg.tenTrangThaiLopHocPhan || 'N/A'}</span>`;

            row.innerHTML = `
                <th scope="row" class="px-6 py-4">
                    <div class="font-bold text-slate-800 text-base flex items-center">${reg.tenMonHoc} ${sourceBadge}</div>
                    <div class="mt-2 space-y-1 text-xs text-slate-500 border-l-2 border-slate-200 pl-3">
                        ${formatScheduleDetail(reg.scheduleDetails)}
                    </div>
                </th>
                <td class="px-6 py-4 font-mono text-xs font-medium text-slate-500">${reg.maLopHocPhan}</td>
                <td class="px-6 py-4 font-medium text-slate-700">${reg.soTinChi === 0 ? '' : (reg.soTinChi ?? '-')}</td>
                <td class="px-6 py-4 whitespace-nowrap">${statusHtml}</td>
                <td class="px-6 py-4 text-right">
                    <div class="flex justify-end gap-2">
                    ${
                        reg.isAllowCancel === false
                            ? '<span class="text-xs text-slate-400 italic">Không thể hủy</span>'
                            : `
                                <button data-reg-id="${reg.id ?? ''}" 
                                        data-reg-code="${reg.maLopHocPhan ?? ''}" 
                                        data-reg-name="${reg.tenMonHoc ?? ''}" 
                                        data-reg-source="${reg.source ?? ''}"
                                        data-reg-subject-code="${reg.maHocPhan ?? ''}"
                                        data-reg-status="${reg.tenTrangThaiLopHocPhan || ''}"
                                        class="text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors swap-from-registered-btn flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                                    Đổi lớp
                                </button>
                                <button data-reg-id="${reg.id ?? ''}" data-ten-mon="${reg.tenMonHoc ?? ''}" data-source="${reg.source ?? ''}" class="text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors cancel-btn flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    Hủy
                                </button>
                            `
                    }
                    </div>
                </td>`;
            tbody.appendChild(row);
        });
        registeredContainer.innerHTML = '';
        registeredContainer.appendChild(table);
    };

    // Show swap class modal from registered classes table
    const showSwapClassModal = async (registeredClassData) => {
        const { id: regId, code: regCode, name: regName, source: regSource, subjectCode, status: regStatus } = registeredClassData;
        
        // Find registered class details
        const registeredClass = registeredClassesData.find(c => c.id.toString() === regId);
        if (!registeredClass) {
            log('❌ Không tìm thấy thông tin lớp đã đăng ký', true);
            return;
        }
        
        // Filter available classes for the same subject
        const availableClasses = allScheduleData.filter(cls => 
            cls.maHocPhan === subjectCode && 
            cls.id.toString() !== regId &&
            cls.tenTrangThai !== 'Đã khóa lớp' &&
            cls.tenTrangThai !== 'Đang lên kế hoạch'
        );
        
        if (availableClasses.length === 0) {
            log(`❌ Không có lớp nào khác để đổi cho môn ${regName}`, true);
            return;
        }
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'swap-class-modal';
        modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in';
        
        modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                <div class="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 class="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <span class="text-blue-500">🔄</span> Đổi lớp: ${regName}
                        </h2>
                        <p class="text-sm text-slate-500 mt-1">Lớp hiện tại: <span class="font-mono font-bold text-slate-700">${regCode}</span></p>
                    </div>
                    <button class="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition close-modal-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                
                <div class="p-0 overflow-y-auto custom-scrollbar bg-white flex-1">
                    <table class="w-full text-sm text-left text-slate-600">
                        <thead class="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th scope="col" class="px-6 py-4 font-semibold">Lớp có thể đổi</th>
                                <th scope="col" class="px-6 py-4 font-semibold">Mã LHP</th>
                                <th scope="col" class="px-6 py-4 font-semibold">Trạng thái</th>
                                <th scope="col" class="px-6 py-4 font-semibold text-right">Hành động</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${availableClasses.map(cls => {
                                const isFull = cls.siSoThuc >= cls.siSoToiDa;
                                const percent = Math.round((cls.siSoThuc / cls.siSoToiDa) * 100);
                                const conflict = checkScheduleConflictBetweenTwo(registeredClass.scheduleDetails, cls.scheduleDetails); // This function needs to be defined or moved
                                
                                let statusClass = 'bg-emerald-100 text-emerald-700';
                                if (isFull) statusClass = 'bg-amber-100 text-amber-700';
                                
                                return `
                                <tr class="bg-white hover:bg-slate-50 transition-colors">
                                    <th scope="row" class="px-6 py-4">
                                        <div class="font-bold text-slate-800 text-base">${cls.tenMonHoc}</div>
                                        <div class="mt-2 space-y-1 text-xs text-slate-500 border-l-2 border-slate-200 pl-3">
                                            ${formatScheduleDetail(cls.scheduleDetails)}
                                        </div>
                                        ${conflict ? '<div class="mt-2 text-xs text-rose-500 font-bold flex items-center gap-1"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg> Trùng lịch với lớp hiện tại</div>' : ''}
                                    </th>
                                    <td class="px-6 py-4 font-mono text-xs font-medium text-slate-500">${cls.maLopHocPhan}</td>
                                    <td class="px-6 py-4">
                                        <div class="flex flex-col gap-1">
                                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium w-fit ${statusClass}">
                                                ${isFull ? 'Đã đầy' : 'Còn chỗ'}
                                            </span>
                                            <div class="w-24 bg-slate-200 rounded-full h-1.5 mt-1">
                                                <div class="bg-blue-500 h-1.5 rounded-full" style="width: ${Math.min(percent, 100)}%"></div>
                                            </div>
                                            <span class="text-[10px] text-slate-400">${cls.siSoThuc}/${cls.siSoToiDa} (${percent}%)</span>
                                        </div>
                                    </td>
                                    <td class="px-6 py-4 text-right">
                                        <button 
                                            data-target-id="${cls.id}"
                                            data-target-code="${cls.maLopHocPhan}"
                                            data-target-name="${cls.tenMonHoc}"
                                            data-target-source="${cls.source}"
                                            data-has-conflict="${conflict}"
                                            class="swap-btn bg-white border border-blue-200 hover:bg-blue-50 text-blue-600 hover:text-blue-700 font-bold py-2 px-4 rounded-xl transition-all duration-200 shadow-sm hover:shadow text-xs flex items-center gap-2 ml-auto">
                                            <span>Chọn đổi</span>
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                        </button>
                                    </td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                
                <div class="p-4 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-500">
                    Hệ thống sẽ tự động hủy lớp cũ và đăng ký lớp mới. Nếu lớp mới đầy, hệ thống sẽ chờ cho đến khi có chỗ trống.
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close modal event
        modal.querySelector('.close-modal-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        // Handle swap button click
        modal.querySelectorAll('.swap-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const targetId = btn.dataset.targetId;
                const targetCode = btn.dataset.targetCode;
                const targetName = btn.dataset.targetName;
                const targetSource = btn.dataset.targetSource;
                const hasConflict = btn.dataset.hasConflict === 'true';
                
                // Find target class full info
                const targetClass = allScheduleData.find(c => c.id.toString() === targetId);
                if (!targetClass) {
                    log('❌ Không tìm thấy thông tin lớp đích', true);
                    return;
                }
                
                // Find registered class full info
                const registeredClassFull = registeredClassesData.find(c => c.id.toString() === regId);
                if (!registeredClassFull) {
                    log('❌ Không tìm thấy thông tin lớp đã đăng ký', true);
                    return;
                }
                
                const confirmMsg = hasConflict 
                    ? `⚠️ CẢNH BÁO: Lớp này trùng lịch với lớp hiện tại!<br><br>Bạn vẫn muốn thêm vào danh sách đổi lớp?<br><br><b>Hủy:</b> ${regName} (${regCode})<br><b>Đăng ký:</b> ${targetName} (${targetCode})<br><br>${targetClass.phanTramDangKy >= 100 ? '⏳ Lớp đích đang đầy, hệ thống sẽ tự động chờ và đổi khi có chỗ trống.' : '✅ Lớp đích còn chỗ, sẽ đổi ngay khi bắt đầu chèn/đăng ký.'}`
                    : `Xác nhận thêm vào danh sách đổi lớp?<br><br><b>Hủy:</b> ${regName} (${regCode})<br><b>Đăng ký:</b> ${targetName} (${targetCode})<br><br>${targetClass.phanTramDangKy >= 100 ? '⏳ Lớp đích đang đầy, hệ thống sẽ tự động chờ và đổi khi có chỗ trống.' : '✅ Lớp đích còn chỗ, sẽ đổi ngay khi bắt đầu chèn/đăng ký.'}`;
                
                showConfirmModal(confirmMsg, () => {
                    // Add to swap pending list
                    swapPendingClasses.set(targetId, {
                        registered: registeredClassFull,
                        target: targetClass
                    });
                    
                    log(`✅ Đã thêm vào danh sách đổi lớp: ${regName} (${regCode}) → ${targetName} (${targetCode})`);
                    if (targetClass.phanTramDangKy >= 100) {
                        log(`⏳ Lớp đích đang đầy (${targetClass.phanTramDangKy}%), hệ thống sẽ tự động chờ cho đến khi có chỗ trống`);
                    }
                    
                    updateSelectedList();
                    modal.remove();
                });
            });
        });
    };
    
    // Check schedule conflict between two specific classes
    const checkScheduleConflictBetweenTwo = (schedule1, schedule2) => {
        if (!schedule1 || !Array.isArray(schedule1) || schedule1.length === 0) return false;
        if (!schedule2 || !Array.isArray(schedule2) || schedule2.length === 0) return false;
        
        for (const s1 of schedule1) {
            const periods1 = parsePeriods(s1.tietHoc);
            if (periods1.length === 0) continue;
            
            for (const s2 of schedule2) {
                const periods2 = parsePeriods(s2.tietHoc);
                if (periods2.length === 0) continue;
                
                // Check if same day of week
                if (s1.thu === s2.thu) {
                    // Check if date ranges overlap
                    if (dateRangesOverlap(s1.ngayBatDau, s1.ngayKetThuc, s2.ngayBatDau, s2.ngayKetThuc)) {
                        // Check if periods overlap
                        if (periodsOverlap(periods1, periods2)) {
                            return true;
                        }
                    }
                }
            }
        }
        
        return false;
    };

    const updateSelectedList = async () => {
        const selectedCountBadge = document.getElementById('selected-count');
        if (selectedCountBadge) selectedCountBadge.textContent = selectedClasses.size + swapPendingClasses.size;

        if (!vipStatus.hasVIP) {
            selectedList.innerHTML = `
                <div class="flex flex-col items-center justify-center h-32 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    <span>Nâng cấp VIP để chọn lớp</span>
                </div>`;
            registrationControls.classList.add('hidden');
            return;
        }
        
        const totalCount = selectedClasses.size + swapPendingClasses.size;
        
        if (totalCount === 0) {
            selectedList.innerHTML = `
                <div class="flex flex-col items-center justify-center h-32 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                    <span>Chưa chọn lớp nào</span>
                </div>`;
            registrationControls.classList.add('hidden');
            
            // Save to cache even when empty
            saveCachedData();
            return;
        }
        
        let html = '';
        
        // Render regular selected classes
        selectedClasses.forEach(cls => {
            const sourceBadge = cls.source === 'dkhpdk' ? `<span class="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">ĐK</span>` : '';
            html += `
                <div class="group relative bg-white border border-slate-200 p-3 rounded-xl hover:shadow-md hover:border-blue-300 transition-all duration-200">
                    <div class="flex justify-between items-start">
                        <div class="flex-1 min-w-0">
                            <p class="font-bold text-sm text-slate-800 truncate pr-2">${cls.tenMonHoc} ${sourceBadge}</p>
                            <div class="text-xs text-slate-500 mt-1 space-y-0.5">${formatSelectedClassDetail(cls, cls.scheduleDetails)}</div>
                        </div>
                        <button class="text-slate-400 hover:text-rose-500 transition-colors p-1 rounded-lg hover:bg-rose-50 remove-class-btn" data-id="${cls.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                        </button>
                    </div>
                    <div class="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-xl"></div>
                </div>`;
        });
        
        // Render swap pending classes
        swapPendingClasses.forEach((swap, targetId) => {
            const targetClass = swap.target;
            const regClass = swap.registered;
            
            html += `
                <div class="group relative bg-white border border-slate-200 p-3 rounded-xl hover:shadow-md hover:border-indigo-300 transition-all duration-200">
                    <div class="flex justify-between items-start">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1 mb-1">
                                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">ĐỔI LỚP</span>
                            </div>
                            <p class="font-bold text-sm text-slate-800 truncate pr-2">${targetClass.tenMonHoc}</p>
                            <div class="text-xs text-slate-500 mt-1">
                                <div class="flex items-center gap-1 text-rose-500"><span class="font-bold">Hủy:</span> ${regClass.maLopHocPhan}</div>
                                <div class="flex items-center gap-1 text-emerald-600"><span class="font-bold">ĐK:</span> ${targetClass.maLopHocPhan}</div>
                            </div>
                        </div>
                        <button class="text-slate-400 hover:text-rose-500 transition-colors p-1 rounded-lg hover:bg-rose-50 remove-swap-btn" data-id="${targetId}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                        </button>
                    </div>
                    <div class="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-l-xl"></div>
                </div>`;
        });

        selectedList.innerHTML = html;
        registrationControls.classList.remove('hidden');
        
        // Add event listeners for remove buttons
        document.querySelectorAll('.remove-class-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                selectedClasses.delete(id);
                updateSelectedList();
                renderScheduleTable(); // Re-render to update row styling
            });
        });
        
        document.querySelectorAll('.remove-swap-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                swapPendingClasses.delete(id);
                updateSelectedList();
            });
        });
        
        // Save to cache
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
                const conflictList = conflicts.map((conflict, idx) => {
                    const details = conflict.uniqueConflicts.map(c => 
                        `${c.day}, Tiết ${c.conflictPeriod}`
                    ).join(' và ');
                    return `${idx + 1}. ${conflict.registeredClass} (${conflict.registeredCode}) - ${details}`;
                }).join('\n');
                
                log(`⚠️ KHÔNG THỂ CHỌN LỚP NÀY\n\n🔴 Trùng lịch học với ${conflicts.length} môn đã đăng ký:\n\n${conflictList}\n\n💡 Vui lòng chọn lớp khác hoặc hủy đăng ký lớp bị trùng.`, true);
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
        
        const removeSwapBtn = e.target.closest('.remove-swap-btn');
        if (removeSwapBtn) {
            if (!vipStatus.hasVIP) {
                log("⚠️ Bạn cần nâng cấp VIP để chỉnh sửa danh sách lớp.", true);
                return;
            }
            const targetClassId = removeSwapBtn.dataset.targetClassId;
            swapPendingClasses.delete(targetClassId);
            updateSelectedList();
            log("🗑️ Đã hủy yêu cầu đổi lớp");
        }
        
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const { regId, tenMon, source } = cancelBtn.dataset;
            cancelRegistration(regId, tenMon, source);
        }
        
        const swapFromRegisteredBtn = e.target.closest('.swap-from-registered-btn');
        if (swapFromRegisteredBtn) {
            const registeredData = {
                id: swapFromRegisteredBtn.dataset.regId,
                code: swapFromRegisteredBtn.dataset.regCode,
                name: swapFromRegisteredBtn.dataset.regName,
                source: swapFromRegisteredBtn.dataset.regSource,
                subjectCode: swapFromRegisteredBtn.dataset.regSubjectCode,
                status: swapFromRegisteredBtn.dataset.regStatus
            };
            
            showSwapClassModal(registeredData);
        }
        
        const swapBtn = e.target.closest('.swap-class-btn');
        if (swapBtn) {
            const registeredData = {
                id: swapBtn.dataset.registeredId,
                code: swapBtn.dataset.registeredCode,
                name: swapBtn.dataset.registeredName,
                source: swapBtn.dataset.registeredSource
            };
            const targetData = {
                id: swapBtn.dataset.targetId,
                code: swapBtn.dataset.targetCode,
                name: swapBtn.dataset.targetName,
                source: swapBtn.dataset.targetSource
            };
            
            // Find full class objects from data
            const registeredClass = registeredClassesData.find(c => c.id.toString() === registeredData.id);
            const targetClass = allScheduleData.find(c => c.id.toString() === targetData.id);
            
            if (!registeredClass || !targetClass) {
                log("❌ Không tìm thấy thông tin đầy đủ của lớp", true);
                return;
            }
            
            // Validate registered class can be cancelled
            const registeredStatus = registeredClass.tenTrangThaiLopHocPhan || '';
            
            if (registeredStatus === 'Đã khóa lớp') {
                log(`❌ Không thể đổi lớp ${registeredData.code} - Trạng thái: ${registeredStatus}`, true);
                return;
            }
            
            if (registeredStatus === 'Đã mở chính thức') {
                log(`❌ Không thể đổi lớp ${registeredData.code} - Trạng thái: ${registeredStatus}`, true);
                return;
            }
            
            if (registeredStatus === 'Đang lên kế hoạch') {
                log(`❌ Không thể đổi lớp ${registeredData.code} - Trạng thái: ${registeredStatus}`, true);
                return;
            }
            
            if (registeredClass.isAllowCancel === false && registeredStatus !== 'Đang chờ đăng ký') {
                log(`❌ Không thể đổi lớp ${registeredData.code} - Trạng thái: ${registeredStatus}`, true);
                return;
            }
            
            // Validate target class can be registered
            const targetStatus = targetClass.tenTrangThai || '';
            
            if (targetStatus === 'Đã khóa lớp') {
                log(`❌ Không thể đăng ký lớp ${targetData.code} - Trạng thái: ${targetStatus}`, true);
                return;
            }
            
            if (targetStatus === 'Đang lên kế hoạch') {
                log(`❌ Không thể đăng ký lớp ${targetData.code} - Trạng thái: ${targetStatus}`, true);
                return;
            }
            
            // All validations passed - add to swap pending list
            swapPendingClasses.set(targetData.id, {
                registered: registeredClass,
                target: targetClass
            });
            
            log(`✅ Đã thêm yêu cầu đổi lớp: ${registeredData.name} → ${targetData.name}`);
            log(`📋 Trạng thái: ${registeredStatus} → ${targetStatus}`);
            updateSelectedList();
            
            // Close tooltip
            if (tooltipElement) {
                tooltipElement.remove();
                tooltipElement = null;
            }
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
            const targetClassId = scheduleRow.dataset.classId;
            const targetClass = allScheduleData.find(c => c.id.toString() === targetClassId);
            
            const conflictMessages = conflicts.map(conflict => {
                // Format all unique conflicts for this class
                const conflictDetails = conflict.uniqueConflicts.map(c => 
                    `<div class="flex items-center gap-2 mt-1.5 text-xs text-red-100">
                        <span class="flex items-center gap-1">
                            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/>
                            </svg>
                            ${c.day}
                        </span>
                        <span class="flex items-center gap-1">
                            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
                            </svg>
                            Tiết ${c.conflictPeriod}
                        </span>
                    </div>`
                ).join('');
                
                // Find the registered class to get its ID and percentage
                const registeredClass = registeredClassesData.find(r => r.maLopHocPhan === conflict.registeredCode);
                
                // Check if swap is allowed based on class status
                let canSwap = false;
                let swapDisabledReason = '';
                
                if (!registeredClass) {
                    swapDisabledReason = 'Không tìm thấy thông tin lớp';
                } else {
                    const registeredStatus = registeredClass.tenTrangThaiLopHocPhan || '';
                    const targetStatus = targetClass?.tenTrangThai || '';
                    
                    // Check registered class can be cancelled
                    if (registeredStatus === 'Đã khóa lớp') {
                        swapDisabledReason = `Trạng thái: ${registeredStatus}`;
                    } else if (registeredStatus === 'Đã mở chính thức') {
                        swapDisabledReason = `Trạng thái: ${registeredStatus}`;
                    } else if (registeredStatus === 'Đang lên kế hoạch') {
                        swapDisabledReason = `Trạng thái: ${registeredStatus}`;
                    } else if (registeredClass.isAllowCancel === false && registeredStatus !== 'Đang chờ đăng ký') {
                        swapDisabledReason = `Trạng thái: ${registeredStatus}`;
                    }
                    // Check target class can be registered
                    else if (targetStatus === 'Đã khóa lớp') {
                        swapDisabledReason = `Lớp đích - Trạng thái: ${targetStatus}`;
                    } else if (targetStatus === 'Đang lên kế hoạch') {
                        swapDisabledReason = `Lớp đích - Trạng thái: ${targetStatus}`;
                    } else {
                        canSwap = true;
                    }
                }
                
                const swapButton = canSwap ? 
                    `<button class="swap-class-btn mt-2 w-full bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-semibold py-1.5 px-3 rounded transition duration-200 flex items-center justify-center gap-1"
                            data-registered-id="${registeredClass.id}"
                            data-registered-code="${conflict.registeredCode}"
                            data-registered-name="${conflict.registeredClass}"
                            data-registered-source="${registeredClass.source}"
                            data-target-id="${targetClassId}"
                            data-target-code="${targetClass?.maLopHocPhan || ''}"
                            data-target-name="${targetClass?.tenMonHoc || ''}"
                            data-target-source="${targetClass?.source || ''}">
                        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z"/>
                        </svg>
                        Đổi lớp
                    </button>` 
                    : `<p class="mt-2 text-xs text-yellow-300">⚠️ Không thể đổi: ${swapDisabledReason}</p>`;
                
                return `<div class="py-2 border-b border-red-500 last:border-0">
                    <div class="flex items-start gap-2">
                        <span class="text-red-200 text-lg flex-shrink-0">📚</span>
                        <div class="flex-1">
                            <p class="font-semibold text-white">${conflict.registeredClass}</p>
                            <p class="text-xs text-red-100 mt-1">Mã LHP: ${conflict.registeredCode}</p>
                            ${conflictDetails}
                            ${swapButton}
                        </div>
                    </div>
                </div>`;
            }).join('');
            
            tooltipElement = document.createElement('div');
            tooltipElement.className = 'fixed bg-gradient-to-br from-red-600 to-red-700 text-white px-4 py-3 rounded-xl shadow-2xl z-50 max-w-md border-2 border-red-500';
            tooltipElement.innerHTML = `
                <div class="flex items-center gap-2 mb-3 pb-2 border-b border-red-500">
                    <svg class="w-6 h-6 text-yellow-300" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                    </svg>
                    <span class="font-bold text-lg">TRÙNG LỊCH HỌC</span>
                </div>
                ${conflictMessages}
                <div class="mt-3 pt-2 border-t border-red-500 text-xs text-red-100">
                    💡 Tip: Chọn lớp học khác hoặc hủy đăng ký lớp bị trùng
                </div>
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
