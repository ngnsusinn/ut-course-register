document.addEventListener('DOMContentLoaded', () => {
    // CSS Toggle Switch
    const style = document.createElement('style');
    style.innerHTML = `
        input:checked~.dot{transform:translateX(100%);background-color:#48bb78}
        input:checked~.block{background-color:#a7f3d0}
        .vip-badge{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:0.25rem 0.75rem;border-radius:9999px;font-size:0.75rem;font-weight:600}
        .payment-modal{display:none;position:fixed;z-index:50;left:0;top:0;width:100%;height:100%;overflow:auto;background-color:rgba(0,0,0,0.4)}
        .payment-modal-content{background-color:#fefefe;margin:5% auto;padding:20px;border:1px solid #888;width:90%;max-width:800px;border-radius:1rem;box-shadow:0 4px 6px rgba(0,0,0,0.1)}
        .close-modal{color:#aaa;float:right;font-size:28px;font-weight:bold;cursor:pointer}
        .close-modal:hover,.close-modal:focus{color:#000}
        .toggle-switch{position:relative;display:inline-block;width:60px;height:34px}
        .toggle-switch input{opacity:0;width:0;height:0}
        .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#ccc;-webkit-transition:.4s;transition:.4s;border-radius:34px}
        .slider:before{position:absolute;content:"";height:26px;width:26px;left:4px;bottom:4px;background-color:white;-webkit-transition:.4s;transition:.4s;border-radius:50%}
        input:checked+.slider{background-color:#2196F3}
        input:focus+.slider{box-shadow:0 0 1px #2196F3}
        input:checked+.slider:before{-webkit-transform:translateX(26px);-ms-transform:translateX(26px);transform:translateX(26px)}
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
    let userPanel, greetingMsg, prerequisiteToggle, fetchBtn, logoutBtn, progressBarContainer, progressBarElement, progressBarText, vipStatusElement, upgradeVipBtn;

    // State
    let authToken = null;
    let dotId = null;
    let userId = null;
    let vipStatus = { hasVIP: false };
    let allScheduleData = [];
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;
    let currentOrder = null;
    let paymentCheckInterval = null;

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
        const timestamp = new Date().toLocaleTimeString();
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

    // --- UI UPDATES ---
    const updateUserPanel = () => {
        if (!userPanel) {
            userPanel = document.createElement('div');
            userPanel.className = 'mt-4 space-y-4';
            loginForm.insertAdjacentElement('afterend', userPanel);
        }
        userPanel.innerHTML = `
            <div class="flex justify-between items-center">
                <p id="greeting-msg" class="font-semibold"></p>
                <span id="vip-status" class="vip-badge"></span>
            </div>
            <div class="flex items-center space-x-4">
                <label class="flex items-center space-x-2">
                    <span>Lấy lớp học phần điều kiện</span>
                    <div class="toggle-switch">
                        <input type="checkbox" id="prerequisite-toggle" ${!vipStatus.hasVIP ? 'disabled' : ''}>
                        <span class="slider"></span>
                    </div>
                </label>
                <button id="fetch-btn" class="bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-300 flex items-center justify-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                    </svg>
                    <span>Lấy Lịch Học</span>
                </button>
            </div>
            <button id="logout-btn" class="w-full bg-red-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-red-700 transition duration-300">Đăng Xuất</button>
            ${!vipStatus.hasVIP ? '<button id="upgrade-vip-btn" class="w-full bg-purple-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-purple-700 transition duration-300">Nâng Cấp VIP</button>' : ''}
        `;
        greetingMsg = document.getElementById('greeting-msg');
        prerequisiteToggle = document.getElementById('prerequisite-toggle');
        fetchBtn = document.getElementById('fetch-btn');
        logoutBtn = document.getElementById('logout-btn');
        vipStatusElement = document.getElementById('vip-status');
        upgradeVipBtn = document.getElementById('upgrade-vip-btn');

        greetingMsg.textContent = `Xin chào, ${userId || 'Người dùng'}`;
        vipStatusElement.textContent = vipStatus.hasVIP ? `VIP đến ${new Date(vipStatus.expiryDate).toLocaleDateString('vi-VN')}` : 'Không có VIP';
        if (fetchBtn) fetchBtn.addEventListener('click', fetchSchedule);
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
        if (upgradeVipBtn) upgradeVipBtn.addEventListener('click', showVIPModal);
    };

    const renderScheduleTable = () => {
        const query = searchInput.value.toLowerCase();
        const selectedSubject = subjectFilter.value;
        if (allScheduleData.length > 0) {
            const subjects = [...new Set(allScheduleData.map(cls => cls.tenMonHoc))].sort();
            subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>' + subjects.map(s => `<option value="${s}" ${s === selectedSubject ? 'selected' : ''}>${s}</option>`).join('');
        }
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
                <th scope="col" class="px-6 py-3">Trạng thái</th><th scope="col" class="px-6 py-3">Đã ĐK</th>
            </tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        filteredData.forEach(cls => {
            const row = document.createElement('tr');
            const isSelected = selectedClasses.has(cls.id.toString());
            row.className = `bg-white border-b hover:bg-sky-100 cursor-pointer ${isSelected ? 'bg-yellow-200' : ''}`;
            row.dataset.classId = cls.id;
            const isBatBuoc = subjectTypeMap.get(cls.maHocPhan);
            const typeHtml = cls.source === 'dkhpdk'
                ? `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-purple-200 text-purple-800">Điều kiện</span>`
                : (isBatBuoc === undefined
                    ? 'N/A'
                    : (isBatBuoc
                        ? `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-green-200 text-green-800">Bắt buộc</span>`
                        : `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-red-200 text-red-800">Tự chọn</span>`));
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900">${cls.tenMonHoc}<div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(cls.scheduleDetails)}</div></th>
                <td class="px-6 py-4" data-label="Mã LHP">${cls.maLopHocPhan}</td>
                <td class="px-6 py-4" data-label="Loại HP">${typeHtml}</td>
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
                <td class="px-6 py-4" data-label="Hành động">${reg.isAllowCancel === false ? '' : `<button data-reg-id="${reg.id ?? ''}" data-ten-mon="${reg.tenMonHoc ?? ''}" data-source="${reg.source ?? ''}" class="font-medium text-red-600 hover:underline cancel-btn">Hủy</button>`}</td>`;
            tbody.appendChild(row);
        });
        registeredContainer.innerHTML = '';
        registeredContainer.appendChild(table);
    };

    const updateSelectedList = async () => {
        if (selectedClasses.size === 0) {
            selectedList.innerHTML = `<p class="text-gray-500">Chưa có lớp nào được chọn.</p>`;
            registrationControls.classList.add('hidden');
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
        // Only show registration controls if user has VIP and classes are selected
        registrationControls.classList.toggle('hidden', !vipStatus.hasVIP || selectedClasses.size === 0);
    };

    // --- CORE FUNCTIONS ---
    const handleLogin = async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !password) {
            log('Vui lòng nhập tên đăng nhập và mật khẩu', true);
            return;
        }
        toggleLoading(loginBtn, true);
        const res = await backendRequest('login', { username, password });
        toggleLoading(loginBtn, false);
        if (!res || !res.success) {
            log('Đăng nhập thất bại: ' + (res?.message || 'Lỗi không xác định'), true);
            return;
        }
        authToken = res.body?.token;
        userId = res.body?.maSinhVien || res.body?.username;
        const initialData = await backendRequest('getInitialData');
        if (!initialData || !initialData.success) {
            log('Không thể tải dữ liệu ban đầu', true);
            return;
        }
        dotId = initialData.dot?.id;
        vipStatus = initialData.vip || { hasVIP: false };
        loginForm.classList.add('hidden');
        updateUserPanel();
        log('Đăng nhập thành công');
    };

    const handleLogout = () => {
        authToken = null;
        userId = null;
        dotId = null;
        vipStatus = { hasVIP: false };
        allScheduleData = [];
        selectedClasses.clear();
        subjectTypeMap.clear();
        registrationIntervals.clear();
        isProcessStopped = false;
        loginForm.classList.remove('hidden');
        userPanel.remove();
        scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập và nhấn "Lấy Lịch Học".</p>';
        registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có dữ liệu. Nhấn nút "Làm mới" sau khi có token.</p>';
        updateSelectedList();
        log('Đã đăng xuất');
    };

    const fetchSchedule = async () => {
        if (!authToken || !dotId || !userId) {
            log('Vui lòng đăng nhập trước khi lấy lịch học', true);
            return;
        }
        toggleLoading(fetchBtn, true);
        const res = await backendRequest('getFullSchedule', {
            dotId,
            fetchPrerequisites: prerequisiteToggle?.checked && vipStatus.hasVIP,
            userId
        });
        toggleLoading(fetchBtn, false);
        if (!res || !res.success) {
            log('Không thể tải lịch học: ' + (res?.message || 'Lỗi không xác định'), true);
            return;
        }
        allScheduleData = res.schedule || [];
        subjectTypeMap = new Map(Object.entries(res.subjectTypes || {}));
        renderScheduleTable();
        log('Đã tải lịch học thành công');
    };

    const fetchRegisteredClasses = async () => {
        if (!authToken || !dotId || !userId) {
            log('Vui lòng đăng nhập trước khi làm mới danh sách đã đăng ký', true);
            return;
        }
        toggleLoading(refreshRegisteredBtn, true);
        const res = await backendRequest('getRegisteredClasses', {
            dotId,
            fetchPrerequisites: prerequisiteToggle?.checked && vipStatus.hasVIP,
            userId
        });
        toggleLoading(refreshRegisteredBtn, false);
        if (!res || !res.success) {
            log('Không thể tải danh sách lớp đã đăng ký: ' + (res?.message || 'Lỗi không xác định'), true);
            return;
        }
        await renderRegisteredTable(res.body || []);
        log('Đã làm mới danh sách lớp đã đăng ký');
    };

    const startInsertion = async () => {
        if (!authToken || !dotId || !userId || selectedClasses.size === 0) {
            log('Vui lòng đăng nhập và chọn ít nhất một lớp để chèn', true);
            return;
        }
        if (!vipStatus.hasVIP) {
            log('Yêu cầu VIP để sử dụng chức năng chèn lớp', true);
            return;
        }
        toggleLoading(startInsertionBtn, true);
        stopBtn.classList.remove('hidden');
        isProcessStopped = false;
        for (const cls of selectedClasses.values()) {
            if (isProcessStopped) break;
            const interval = setInterval(async () => {
                if (isProcessStopped) {
                    clearInterval(interval);
                    registrationIntervals.delete(cls.id);
                    return;
                }
                const res = await backendRequest('checkClassStatus', {
                    dotId,
                    maHocPhan: cls.maHocPhan,
                    source: cls.source
                });
                if (res && res.success && Array.isArray(res.body)) {
                    const updatedClass = res.body.find(c => c.id === cls.id);
                    if (updatedClass && updatedClass.phanTramDangKy < 100) {
                        log(`Lớp ${cls.tenMonHoc} còn chỗ, đang chèn...`);
                        const regRes = await backendRequest('register', { classId: cls.id, source: cls.source });
                        if (regRes && regRes.success) {
                            log(`Đã chèn lớp ${cls.tenMonHoc} thành công`);
                            clearInterval(interval);
                            registrationIntervals.delete(cls.id);
                            await fetchRegisteredClasses();
                        }
                    }
                }
            }, parseInt(delayInput.value) || 1000);
            registrationIntervals.set(cls.id, interval);
        }
        toggleLoading(startInsertionBtn, false);
        log('Bắt đầu quá trình chèn lớp');
    };

    const startRegistration = async () => {
        if (!authToken || !dotId || !userId || selectedClasses.size === 0) {
            log('Vui lòng đăng nhập và chọn ít nhất một lớp để đăng ký', true);
            return;
        }
        if (!vipStatus.hasVIP) {
            log('Yêu cầu VIP để sử dụng chức năng đăng ký', true);
            return;
        }
        toggleLoading(startRegistrationBtn, true);
        stopBtn.classList.remove('hidden');
        isProcessStopped = false;
        for (const cls of selectedClasses.values()) {
            if (isProcessStopped) break;
            const res = await backendRequest('register', { classId: cls.id, source: cls.source });
            if (res && res.success) {
                log(`Đã đăng ký lớp ${cls.tenMonHoc} thành công`);
                selectedClasses.delete(cls.id.toString());
            } else {
                log(`Không thể đăng ký lớp ${cls.tenMonHoc}: ${res?.message || 'Lỗi không xác định'}`, true);
            }
        }
        toggleLoading(startRegistrationBtn, false);
        stopBtn.classList.add('hidden');
        updateSelectedList();
        await fetchRegisteredClasses();
        log('Hoàn tất quá trình đăng ký');
    };

    const stopProcess = () => {
        isProcessStopped = true;
        registrationIntervals.forEach(interval => clearInterval(interval));
        registrationIntervals.clear();
        toggleLoading(startInsertionBtn, false);
        toggleLoading(startRegistrationBtn, false);
        stopBtn.classList.add('hidden');
        log('Đã dừng tất cả quá trình');
    };

    const cancelRegistration = async (regId, tenMon, source) => {
        if (!authToken || !regId) {
            log('Không thể hủy đăng ký: Thiếu thông tin', true);
            return;
        }
        const res = await backendRequest('cancel', { registrationId: regId, source });
        if (res && res.success) {
            log(`Đã hủy đăng ký lớp ${tenMon}`);
            await fetchRegisteredClasses();
        } else {
            log(`Không thể hủy đăng ký lớp ${tenMon}: ${res?.message || 'Lỗi không xác định'}`, true);
        }
    };

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
        modal.innerHTML = `
            <div class="payment-modal-content">
                <span class="close-modal" onclick="document.getElementById('vip-modal').remove()">&times;</span>
                <h2 class="text-2xl font-bold mb-4 text-center">🌟 Nâng cấp VIP</h2>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    ${Object.entries(plans).map(([key, plan]) => `
                        <div class="border-2 rounded-lg p-4 text-center hover:border-purple-500 cursor-pointer plan-card" data-plan="${key}">
                            <h3 class="font-bold text-lg mb-2">${plan.name}</h3>
                            <p class="text-3xl font-bold text-purple-600 mb-2">${(plan.price).toLocaleString('vi-VN')}đ</p>
                            <p class="text-gray-600 mb-4">${plan.duration} ngày</p>
                            <button class="w-full bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 buy-plan-btn" data-plan="${key}">
                                Chọn gói này
                            </button>
                        </div>
                    `).join('')}
                </div>
                <div id="payment-section" style="display:none">
                    <h3 class="text-xl font-bold mb-4 border-t pt-4">Thông tin thanh toán</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="border rounded-lg p-4 text-center">
                            <p class="font-bold mb-2">Cách 1: Quét mã QR</p>
                            <img id="qr-code" class="mx-auto mb-4" style="max-width:200px" alt="QR Code">
                            <p class="text-sm text-gray-600">Quét mã QR bằng ứng dụng ngân hàng</p>
                        </div>
                        <div class="border rounded-lg p-4">
                            <p class="font-bold mb-2">Cách 2: Chuyển khoản ngân hàng</p>
                            <p><strong>Ngân hàng:</strong> ${sepayConfig.bankName}</p>
                            <p><strong>Số tài khoản:</strong> ${sepayConfig.accountNumber}</p>
                            <p><strong>Chủ tài khoản:</strong> ${sepayConfig.accountName}</p>
                            <p><strong>Nội dung:</strong> <span id="payment-content"></span></p>
                            <p class="text-sm text-gray-600 mt-2">Sao chép nội dung chuyển khoản chính xác</p>
                        </div>
                    </div>
                    <p class="text-center text-sm text-gray-600 mt-4">Hệ thống sẽ tự động kích hoạt VIP sau khi xác nhận thanh toán (thường trong 1-5 phút).</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.style.display = 'block';

        document.querySelectorAll('.buy-plan-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const plan = btn.dataset.plan;
                const res = await backendRequest('createVIPOrder', { userId, plan });
                if (!res || !res.success) {
                    log('Không thể tạo đơn hàng VIP', true);
                    return;
                }
                currentOrder = res.order;
                document.getElementById('payment-content').textContent = `DH${currentOrder.id}`;
                document.getElementById('qr-code').src = `https://img.vietqr.io/image/${sepayConfig.bankName}-${sepayConfig.accountNumber}-compact2.png?amount=${currentOrder.amount}&addInfo=DH${currentOrder.id}&accountName=${encodeURIComponent(sepayConfig.accountName)}`;
                document.getElementById('payment-section').style.display = 'block';
                document.querySelectorAll('.plan-card').forEach(card => card.style.display = 'none');
                startPaymentCheck();
            });
        });
    };

    const startPaymentCheck = () => {
        if (!currentOrder) return;
        paymentCheckInterval = setInterval(async () => {
            const res = await backendRequest('checkOrderStatus', { orderId: currentOrder.id });
            if (res && res.success && res.order.status === 'Paid') {
                clearInterval(paymentCheckInterval);
                vipStatus = await backendRequest('checkVIPStatus', { userId });
                updateUserPanel();
                document.getElementById('vip-modal')?.remove();
                log('Đã kích hoạt VIP thành công');
            }
        }, 5000);
    };

    // --- EVENT LISTENERS ---
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
            const { regId, tenMon, source } = cancelBtn.dataset;
            cancelRegistration(regId, tenMon, source);
        }
    });
});