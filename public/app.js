// Combined app.js
document.addEventListener('DOMContentLoaded', () => {
    // CSS Toggle Switch
    const style = document.createElement('style');
    style.innerHTML = `input:checked~.dot{transform:translateX(100%);background-color:#48bb78}input:checked~.block{background-color:#a7f3d0}`;
    document.head.appendChild(style);

    // DOM Elements (existing)
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

    // === NEW DOM ELEMENTS (VIP / payment) ===
    // These might not exist in the old HTML; guard them.
    const loginContainer = document.getElementById('login-container') || null;
    const appContainer = document.getElementById('app-container') || null;
    const logoutBtnFallback = document.getElementById('logout-btn') || null; // may be created dynamically in original code
    const studentName = document.getElementById('student-name') || null;
    const studentCode = document.getElementById('student-code') || null;
    const fetchDataBtn = document.getElementById('fetch-data-btn') || null;

    const userRoleEl = document.getElementById('user-role') || null;
    const buyVipBtn = document.getElementById('buy-vip-btn') || null;
    const vipModal = document.getElementById('vip-modal') || null;
    const closeModalBtn = document.getElementById('close-modal-btn') || null;
    const registrationSection = document.getElementById('registration-section') || registrationControls || null;
    const paymentModal = document.getElementById('payment-modal') || null;
    const closePaymentModalBtn = document.getElementById('close-payment-modal-btn') || null;
    const qrCodeImg = document.getElementById('qr-code-img') || null;
    const paymentStatusText = document.getElementById('payment-status-text') || null;

    // State (existing + new)
    let authToken = null;
    let dotId = null;
    let allScheduleData = [];
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;

    // VIP related
    let currentUser = null;
    let checkPaymentInterval = null;

    // === SINGLE BACKEND COMMUNICATION FUNCTION (existing) ===
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

    // === NEW: helper to call specific endpoints (create-payment) ===
    const createPayment = async (payload) => {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
            const res = await fetch('/api/create-payment', {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                return { success: false, message: `HTTP ${res.status} ${txt}` };
            }
            return await res.json();
        } catch (err) {
            return { success: false, message: err.message };
        }
    };

    // --- UTILITY FUNCTIONS (existing) ---
    const log = (message, isError = false) => {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('p');
        logEntry.innerHTML = `[${timestamp}] ${message}`;
        logEntry.className = isError ? 'text-red-400' : 'text-green-300';
        if (logOutput) {
            logOutput.appendChild(logEntry);
            logOutput.scrollTop = logOutput.scrollHeight;
        } else {
            console[isError ? 'error' : 'log'](message);
        }
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

    [loginBtn, startInsertionBtn, startRegistrationBtn, stopBtn, refreshRegisteredBtn].forEach(btn => {
        if (btn) btn.originalHTML = btn.innerHTML;
    });

    const formatScheduleDetail = (details) => {
        if (!details || details.error || !Array.isArray(details) || details.length === 0) {
            return 'Không có thông tin lịch học';
        }
        return details.map(d => `<div class="font-medium">Thứ ${d.thu} | Tiết ${d.tietHoc} | ${new Date(d.ngayBatDau).toLocaleDateString('vi-VN')} - ${new Date(d.ngayKetThuc).toLocaleDateString('vi-VN')}</div>`).join('<hr class="my-1 border-gray-200">');
    };

    const formatSelectedClassDetail = (cls, details) => {
        if (!details || details.error) return `<span class="text-red-500">Không tải được lịch</span>`;
        if (!Array.isArray(details) || details.length === 0) return '<span>Chưa có thông tin lịch học</span>';
        return details.map(detail => `<span>${cls.maLopHocPhan} | Thứ ${detail.thu} | Tiết ${detail.tietHoc}</span>`).join('<br>');
    };

    // --- UI UPDATE FUNCTIONS (existing) ---
    const updateUIAfterLogin = (profile) => {
        if (loginForm) loginForm.style.display = 'none';

        // Create user panel if not exists
        if (!document.getElementById('user-panel-content')) {
            const panelContainer = document.createElement('div');
            panelContainer.id = 'user-panel-content';
            panelContainer.className = 'space-y-4';
            panelContainer.innerHTML = `
                <div id="greeting-msg" class="mt-4 text-lg font-semibold text-blue-700"></div>
                <div id="prerequisite-toggle-container" class="flex items-center justify-center my-3">
                    <label for="prerequisite-toggle" class="flex items-center cursor-pointer">
                        <div class="relative">
                            <input type="checkbox" id="prerequisite-toggle" class="sr-only">
                            <div class="block bg-gray-600 w-14 h-8 rounded-full"></div>
                            <div class="dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition"></div>
                        </div>
                        <div class="ml-3 text-gray-700 font-medium">Lấy dữ liệu môn học điều kiện</div>
                    </label>
                </div>
                 <div id="progress-bar-container" class="my-4 hidden">
                    <div class="w-full bg-gray-200 rounded-full h-2.5"><div id="progress-bar-element" class="bg-blue-600 h-2.5 rounded-full" style="width: 0%"></div></div>
                    <p id="progress-bar-text" class="text-center text-sm text-gray-600 mt-1"></p>
                </div>
                <button id="fetch-schedule-btn" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-300 flex items-center justify-center space-x-2"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM6 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" /></svg><span>Lấy dữ liệu</span></button>
                <button id="logout-btn" class="w-full bg-gray-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 transition duration-300">Đăng xuất</button>
            `;
            loginForm.parentNode.insertBefore(panelContainer, loginForm.nextSibling);

            // Re-assign element variables
            const greetingMsgNode = document.getElementById('greeting-msg');
            const prerequisiteToggleNode = document.getElementById('prerequisite-toggle');
            const fetchBtnNode = document.getElementById('fetch-schedule-btn');
            const logoutBtnNode = document.getElementById('logout-btn');
            const progressBarContainerNode = document.getElementById('progress-bar-container');
            const progressBarElementNode = document.getElementById('progress-bar-element');
            const progressBarTextNode = document.getElementById('progress-bar-text');

            // Add event listeners
            fetchBtnNode.originalHTML = fetchBtnNode.innerHTML;
            logoutBtnNode.originalHTML = logoutBtnNode.innerHTML;
            fetchBtnNode.addEventListener('click', fetchFullSchedule);
            logoutBtnNode.addEventListener('click', handleLogout);
        }

        // Show greeting
        const greeting = `${profile.hoDem || ''} ${profile.ten || ''}`.trim();
        const greetingEl = document.getElementById('greeting-msg');
        if (greetingEl) greetingEl.textContent = `Xin chào, ${greeting || profile.hoTen || profile.ten}!`;
        const panelEl = document.getElementById('user-panel-content');
        if (panelEl) panelEl.style.display = 'block';
    };

    const resetUI = () => {
        if (loginForm) loginForm.style.display = 'block';
        const panel = document.getElementById('user-panel-content');
        if (panel) panel.style.display = 'none';

        if (scheduleContainer) scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập để xem dữ liệu.</p>';
        if (registeredContainer) registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có dữ liệu.</p>';
        if (logOutput) logOutput.innerHTML = '';
        if (subjectFilter) subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>';
        if (searchInput) searchInput.value = '';
        allScheduleData = [];
        selectedClasses.clear();
        updateSelectedList();
    };

    const updateProgressBar = (current, total, message = '') => {
        const progressBarContainer = document.getElementById('progress-bar-container');
        const progressBarElement = document.getElementById('progress-bar-element');
        const progressBarText = document.getElementById('progress-bar-text');
        if (!progressBarContainer) return;
        if (current === -1) {
            progressBarContainer.classList.add('hidden');
            return;
        }
        progressBarContainer.classList.remove('hidden');
        const percentage = total > 0 ? (current / total) * 100 : 0;
        if (progressBarElement) progressBarElement.style.width = `${percentage}%`;
        if (progressBarText) progressBarText.textContent = message;
    };

    // --- CORE LOGIC FUNCTIONS (existing) ---
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
            // Persist token so payment flow / reloads can use it
            try { localStorage.setItem('authToken', authToken); } catch (e) {}

            log("✅ Đăng nhập thành công.");
            const initialData = await backendRequest('getInitialData');
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                // Save and set currentUser (profile)
                currentUser = initialData.profile || {};
                try { localStorage.setItem('user', JSON.stringify(currentUser)); } catch (e) {}
                updateUIAfterLogin(currentUser);
                // Also update VIP UI if available
                updateUserUI(currentUser);
                await fetchRegisteredClasses();
            } else {
                 log(`❌ Lỗi lấy dữ liệu ban đầu: ${initialData?.message || 'Không rõ'}`, true);
                 authToken = null;
            }
        } else {
            log(`❌ Đăng nhập thất bại: ${tokenRes?.message || 'Lỗi không xác định'}`, true);
        }
        toggleLoading(loginBtn, false);
    };

    const handleLogout = async () => {
        await stopProcess();
        authToken = null;
        dotId = null;
        currentUser = null;
        try {
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
        } catch (e) {}
        resetUI();
        log("Đã đăng xuất.");
        // If there's an app container / login container, toggle them
        if (loginContainer && appContainer) {
            loginContainer.classList.remove('hidden');
            appContainer.classList.add('hidden');
        } else {
            window.location.reload();
        }
    };

    const fetchFullSchedule = async () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        toggleLoading(document.getElementById('fetch-schedule-btn'), true);
        isProcessStopped = false;
        log("♻️ Bắt đầu lấy toàn bộ lịch học từ server...");

        const prerequisiteToggle = document.getElementById('prerequisite-toggle');
        const fetchPrerequisites = prerequisiteToggle?.checked || false;
        updateProgressBar(0, 100, `Đang tải...`);
        const scheduleRes = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites });

        if (scheduleRes && scheduleRes.success) {
            allScheduleData = scheduleRes.schedule;
            subjectTypeMap = new Map(Object.entries(scheduleRes.subjectTypes || {}));
            log(`✅ Đã tải thành công ${allScheduleData.length} lớp học phần.`);
            await renderScheduleTable();
        } else {
            log("❌ Lỗi khi tải lịch học từ server.", true);
        }
        updateProgressBar(-1);
        toggleLoading(document.getElementById('fetch-schedule-btn'), false);
    };

    const fetchRegisteredClasses = async () => {
        if (!authToken) return;
        toggleLoading(refreshRegisteredBtn, true);
        const prerequisiteToggle = document.getElementById('prerequisite-toggle');
        const fetchPrerequisites = prerequisiteToggle?.checked || false;

        const registeredRes = await backendRequest('getRegisteredClasses', { dotId, fetchPrerequisites });

        if (registeredRes && registeredRes.success) {
             await renderRegisteredTable(registeredRes.body);
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
        if (startInsertionBtn) startInsertionBtn.classList.toggle('hidden', isProcessing);
        if (startRegistrationBtn) startRegistrationBtn.classList.toggle('hidden', isProcessing);
        if (stopBtn) stopBtn.classList.toggle('hidden', !isProcessing);
    };

    // --- RENDER FUNCTIONS (existing) ---
    const renderScheduleTable = async () => {
        const query = searchInput ? searchInput.value.toLowerCase() : '';
        const selectedSubject = subjectFilter ? subjectFilter.value : '';
        if (allScheduleData.length > 0 && subjectFilter) {
            const subjects = [...new Set(allScheduleData.map(cls => cls.tenMonHoc))].sort();
            subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>' + subjects.map(s => `<option value="${s}" ${s === selectedSubject ? 'selected' : ''}>${s}</option>`).join('');
        }

        const filteredData = allScheduleData.filter(cls =>
            (!selectedSubject || cls.tenMonHoc === selectedSubject) &&
            (`${cls.tenMonHoc} ${cls.maLopHocPhan} ${cls.maHocPhan}`.toLowerCase().includes(query)) &&
            (cls.tenTrangThai !== "Đã khoá lớp")
        );

        if (filteredData.length === 0) {
            if (scheduleContainer) {
                scheduleContainer.innerHTML = allScheduleData.length === 0 ? '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập và nhấn "Lấy Lịch Học".</p>' : '<p class="text-gray-500 text-center py-8">Không tìm thấy lớp học phần nào.</p>';
            }
            return;
        }

        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10"><tr>
                <th scope="col" class="px-6 py-3">Tên môn học & Lịch học</th><th scope="col" class="px-6 py-3">Mã LHP</th>
                <th scope="col" class="px-6 py-3">Loại HP</th><th scope="col" class="px-6 py-3">Số TC</th>
                <th scope="col" class="px-6 py-3">Trạng thái</th><th scope="col" class="px-6 py-3">Đã ĐK</th>
            </tr></thead><tbody></tbody>`;

        const tbody = table.querySelector('tbody');

        filteredData.forEach(cls => {
            const row = document.createElement('tr');
            const isSelected = selectedClasses.has(cls.id.toString());
            row.className = `bg-white border-b hover:bg-sky-100 cursor-pointer ${isSelected ? 'bg-yellow-200' : ''}`;
            row.dataset.classId = cls.id;
            const isBatBuoc = subjectTypeMap.get(cls.maHocPhan);
            const typeHtml = cls.source === 'dkhpdk' ? '' : isBatBuoc === undefined ? 'N/A' : isBatBuoc
                ? `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-green-200 text-green-800">Bắt buộc</span>`
                : `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-red-200 text-red-800">Tự chọn</span>`;
            const sourceBadge = cls.source === 'dkhpdk' ? `<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-purple-200 text-purple-800">DKHPĐK</span>` : '';
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900">${cls.tenMonHoc} ${sourceBadge}<div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(cls.scheduleDetails)}</div></th>
                <td class="px-6 py-4" data-label="Mã LHP">${cls.maLopHocPhan}</td>
                <td class="px-6 py-4" data-label="Loại HP">${typeHtml}</td>
                <td class="px-6 py-4" data-label="Số TC">${cls.soTinChi ?? 'N/A'}</td>
                <td class="px-6 py-4" data-label="Trạng thái">${cls.tenTrangThai || 'N/A'}</td>
                <td class="px-6 py-4 font-semibold ${cls.phanTramDangKy >= 100 ? 'text-red-500' : 'text-green-500'}" data-label="Đã ĐK">${cls.phanTramDangKy}%</td>`;
            tbody.appendChild(row);
        });

        if (scheduleContainer) {
            scheduleContainer.innerHTML = '';
            scheduleContainer.appendChild(table);
        }
    };

    const renderRegisteredTable = async (data) => {
        if (!data || data.length === 0) {
            if (registeredContainer) registeredContainer.innerHTML = `<p class="text-gray-500 text-center py-8">Bạn chưa đăng ký học phần nào.</p>`;
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
            const sourceBadge = reg.source === 'dkhpdk' ? `<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-purple-200 text-purple-800">DKHPĐK</span>` : '';
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900">${reg.tenMonHoc} ${sourceBadge}<div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(reg.scheduleDetails)}</div></th>
                <td class="px-6 py-4" data-label="Mã LHP">${reg.maLopHocPhan}</td>
                <td class="px-6 py-4" data-label="Số TC">${reg.soTinChi ?? 'N/A'}</td>
                <td class="px-6 py-4" data-label="Trạng thái">${reg.tenTrangThaiLopHocPhan || 'N/A'}</td>
                <td class="px-6 py-4" data-label="Hành động"><button data-reg-id="${reg.id}" data-ten-mon="${reg.tenMonHoc}" data-source="${reg.source}" class="font-medium text-red-600 hover:underline cancel-btn">Hủy</button></td>`;
            tbody.appendChild(row);
        });
        if (registeredContainer) {
            registeredContainer.innerHTML = '';
            registeredContainer.appendChild(table);
        }
    };

    const updateSelectedList = async () => {
        if (!selectedList) return;
        if (selectedClasses.size === 0) {
            selectedList.innerHTML = `<p class="text-gray-500">Chưa có lớp nào được chọn.</p>`;
            if (registrationControls) registrationControls.classList.add('hidden');
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
            </div>`
        }).join('');
        if (registrationControls) registrationControls.classList.remove('hidden');
    };

    // === NEW: Update UI for role (VIP / free) ===
    function updateUserUI(user) {
        if (!user) return;
        // If we have studentName/studentCode elements, fill them
        if (studentName) studentName.textContent = user.hoTen || `${user.hoDem || ''} ${user.ten || ''}`.trim();
        if (studentCode) studentCode.textContent = user.userName || user.username || '';

        // user.role expected to be 'vip' or 'free' (fallback to 'free')
        const role = (user.role || user.roleName || user.type || 'free').toString().toLowerCase();
        if (userRoleEl) {
            userRoleEl.textContent = role.toUpperCase();
            if (role === 'vip') {
                userRoleEl.className = 'px-2 py-1 rounded text-white bg-green-500';
                if (buyVipBtn) buyVipBtn.classList.add('hidden');
                if (fetchDataBtn) fetchDataBtn.classList.remove('hidden');
                if (registrationSection) registrationSection.classList.remove('disabled-section');
            } else {
                userRoleEl.className = 'px-2 py-1 rounded text-white bg-gray-500';
                if (buyVipBtn) buyVipBtn.classList.remove('hidden');
                if (fetchDataBtn) fetchDataBtn && fetchDataBtn.classList.add('hidden');
                if (registrationSection) registrationSection.classList.add('disabled-section');
            }
        }
    }

    // === NEW: Payment modal / VIP flow ===
    if (buyVipBtn) {
        buyVipBtn.addEventListener('click', () => {
            if (!vipModal) return;
            vipModal.classList.add('active');
            // scale animation target (if modal matches structure)
            const inner = vipModal.querySelector('div > div');
            if (inner) inner.classList.add('scale-100');
        });
    }
    if (closeModalBtn && vipModal) {
        closeModalBtn.addEventListener('click', () => {
            vipModal.classList.remove('active');
            const inner = vipModal.querySelector('div > div');
            if (inner) inner.classList.remove('scale-100');
        });
    }

    // Handle clicks on package buttons (class .vip-package-btn)
    document.querySelectorAll('.vip-package-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const days = button.dataset.days;
            const price = button.dataset.price;

            if (vipModal) {
                vipModal.classList.remove('active'); // close package chooser
            }

            if (!currentUser || !currentUser.userName) {
                alert('Vui lòng đăng nhập trước khi mua VIP.');
                return;
            }

            const payload = {
                username: currentUser.userName,
                price: parseInt(price, 10),
                days: parseInt(days, 10)
            };

            // Create payment
            const result = await createPayment(payload);

            if (result && result.success) {
                // Fill payment modal UI
                if (qrCodeImg && result.qrUrl) qrCodeImg.src = result.qrUrl;
                if (document.getElementById('payment-bank')) document.getElementById('payment-bank').textContent = result.paymentInfo?.bankName || '';
                if (document.getElementById('payment-account')) document.getElementById('payment-account').textContent = result.paymentInfo?.accountNumber || '';
                if (document.getElementById('payment-name')) document.getElementById('payment-name').textContent = result.paymentInfo?.accountName || '';
                if (document.getElementById('payment-amount')) {
                    const amt = result.paymentInfo?.amount ?? 0;
                    document.getElementById('payment-amount').textContent = (typeof amt === 'number') ? amt.toLocaleString('vi-VN') : amt;
                }
                if (document.getElementById('payment-content')) document.getElementById('payment-content').textContent = result.paymentInfo?.content || '';

                if (paymentModal) paymentModal.classList.add('active');
                if (paymentStatusText) paymentStatusText.textContent = 'Đang chờ thanh toán...';

                // Start checking payment, using orderId returned by server
                startCheckingPayment(result.orderId);
            } else {
                alert('Tạo đơn hàng thất bại: ' + (result.message || 'Không rõ'));
            }
        });
    });

    if (closePaymentModalBtn && paymentModal) {
        closePaymentModalBtn.addEventListener('click', () => {
            if (paymentModal) paymentModal.classList.remove('active');
            stopCheckingPayment();
        });
    }

    // Start checking payment status (poll getInitialData and check role)
    function startCheckingPayment(orderId) {
        stopCheckingPayment();
        checkPaymentInterval = setInterval(async () => {
            try {
                if (!authToken) {
                    // If no authToken but session exists in localStorage, try restore
                    const storedToken = localStorage.getItem('authToken');
                    if (storedToken) {
                        authToken = storedToken;
                    }
                }
                const res = await backendRequest('getInitialData', {});
                if (res && res.success && res.profile) {
                    // Update currentUser and UI
                    currentUser = res.profile;
                    try { localStorage.setItem('user', JSON.stringify(currentUser)); } catch (e) {}
                    updateUserUI(currentUser);

                    // If server changed role to vip, we stop and redirect to success page
                    const role = (currentUser.role || '').toString().toLowerCase();
                    if (role === 'vip') {
                        if (paymentStatusText) paymentStatusText.textContent = 'Thanh toán thành công! Đang xử lý...';
                        stopCheckingPayment();
                        // Optionally refresh registered/profile data
                        await fetchRegisteredClasses();
                        // redirect to success page if available
                        window.location.href = '/payment-success.html';
                    } else {
                        if (paymentStatusText) paymentStatusText.textContent = 'Chưa thanh toán. Vui lòng hoàn tất giao dịch.';
                    }
                }
            } catch (error) {
                // ignore network errors for polling
                console.log("Checking payment... not yet paid.", error);
            }
        }, 3000); // poll every 3s
    }

    function stopCheckingPayment() {
        if (checkPaymentInterval) {
            clearInterval(checkPaymentInterval);
            checkPaymentInterval = null;
        }
    }

    // --- EVENT LISTENERS (existing) ---
    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    if (refreshRegisteredBtn) refreshRegisteredBtn.addEventListener('click', fetchRegisteredClasses);
    if (startInsertionBtn) startInsertionBtn.addEventListener('click', startInsertion);
    if (startRegistrationBtn) startRegistrationBtn.addEventListener('click', startRegistration);
    if (stopBtn) stopBtn.addEventListener('click', stopProcess);
    if (searchInput) searchInput.addEventListener('input', () => renderScheduleTable());
    if (subjectFilter) subjectFilter.addEventListener('change', () => renderScheduleTable());
    if (passwordInput) passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    document.addEventListener('click', (e) => {
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow) {
            const classId = scheduleRow.dataset.classId;
            const cls = allScheduleData.find(c => c.id.toString() === classId);
            if (!cls) return;
            if (selectedClasses.has(classId)) selectedClasses.delete(classId);
            else selectedClasses.set(classId, cls);
            scheduleRow.classList.toggle('bg-yellow-200');
            updateSelectedList();
        }
        const removeBtn = e.target.closest('.remove-selected-btn');
        if (removeBtn) {
            const classId = removeBtn.dataset.classId;
            selectedClasses.delete(classId);
            const rowToUpdate = document.querySelector(`#schedule-container tr[data-class-id='${classId}']`);
            if (rowToUpdate) rowToUpdate.classList.remove('bg-yellow-200');
            updateSelectedList();
        }
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const regId = cancelBtn.dataset.regId || cancelBtn.getAttribute('data-reg-id');
            const tenMon = cancelBtn.dataset.tenMon || cancelBtn.getAttribute('data-ten-mon');
            const source = cancelBtn.dataset.source || cancelBtn.getAttribute('data-source');
            cancelRegistration(regId, tenMon, source);
        }
    });

    // === SESSION RESTORE on page load ===
    (function restoreSessionFromLocalStorage() {
        try {
            const storedToken = localStorage.getItem('authToken');
            const storedUser = localStorage.getItem('user');
            if (storedToken) {
                authToken = storedToken;
            }
            if (storedUser) {
                currentUser = JSON.parse(storedUser);
                // Update UI if logged in
                if (currentUser) {
                    updateUserUI(currentUser);
                    // if original UI expects updateUIAfterLogin flow, try fetch initial data
                    backendRequest('getInitialData').then(initialData => {
                        if (initialData && initialData.success) {
                            dotId = initialData.dot?.id || dotId;
                            updateUIAfterLogin(initialData.profile || currentUser);
                            currentUser = initialData.profile || currentUser;
                            try { localStorage.setItem('user', JSON.stringify(currentUser)); } catch (e) {}
                            updateUserUI(currentUser);
                            fetchRegisteredClasses().catch(()=>{});
                        }
                    }).catch(()=>{});
                }
            }
        } catch (e) {
            console.warn('Không thể khôi phục session từ localStorage', e);
        }
    })();

    // === INITIAL NOTES ===
    // This combined file keeps original behavior and adds VIP payment UI hooks:
    // - Ensure your HTML contains elements with the IDs used for payment UI:
    //   buy-vip-btn, vip-modal, close-modal-btn, .vip-package-btn (buttons), payment-modal,
    //   close-payment-modal-btn, qr-code-img, payment-bank, payment-account, payment-name,
    //   payment-amount, payment-content, payment-status-text, user-role, student-name, student-code.
    // - create-payment endpoint should return:
    //   { success: true, qrUrl: '...', paymentInfo: { bankName, accountNumber, accountName, amount, content }, orderId: '...' }
    // - The code polls getInitialData to detect when profile.role becomes 'vip' (server-side must update profile)
});
