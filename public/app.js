document.addEventListener('DOMContentLoaded', () => {
    // CSS Toggle Switch
    const style = document.createElement('style');
    style.innerHTML = `input:checked~.dot{transform:translateX(100%);background-color:#48bb78}input:checked~.block{background-color:#a7f3d0}`;
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
    let userPanel, greetingMsg, prerequisiteToggle, fetchBtn, logoutBtn, progressBarContainer, progressBarElement, progressBarText, roleDisplay, upgradeVipBtn;

    // State
    let authToken = null;
    let dotId = null;
    let allScheduleData = [];
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;
    let userRole = 'none';
    let username = '';

    // Backend communication
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

    // Utility functions
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

    // UI updates
    const updateUIAfterLogin = (profile, role) => {
        loginForm.style.display = 'none';
        userRole = role;
        username = profile.username;

        if (!document.getElementById('user-panel-content')) {
            const panelContainer = document.createElement('div');
            panelContainer.id = 'user-panel-content';
            panelContainer.className = 'space-y-4';
            panelContainer.innerHTML = `
                <div id="greeting-msg" class="mt-4 text-lg font-semibold text-blue-700"></div>
                <div id="role-display" class="text-sm text-gray-600"></div>
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
                <button id="fetch-schedule-btn" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-300 flex items-center justify-center space-x-2 ${role !== 'vip' ? 'hidden' : ''}"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM6 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" /></svg><span>Lấy dữ liệu</span></button>
                <button id="upgrade-vip-btn" class="w-full bg-yellow-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-yellow-600 transition duration-300 flex items-center justify-center space-x-2 ${role === 'vip' ? 'hidden' : ''}"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" /></svg><span>Nâng cấp VIP</span></button>
                <button id="logout-btn" class="w-full bg-gray-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 transition duration-300">Đăng xuất</button>
            `;
            loginForm.parentNode.insertBefore(panelContainer, loginForm.nextSibling);

            greetingMsg = document.getElementById('greeting-msg');
            roleDisplay = document.getElementById('role-display');
            prerequisiteToggle = document.getElementById('prerequisite-toggle');
            fetchBtn = document.getElementById('fetch-schedule-btn');
            upgradeVipBtn = document.getElementById('upgrade-vip-btn');
            logoutBtn = document.getElementById('logout-btn');
            progressBarContainer = document.getElementById('progress-bar-container');
            progressBarElement = document.getElementById('progress-bar-element');
            progressBarText = document.getElementById('progress-bar-text');

            fetchBtn.originalHTML = fetchBtn.innerHTML;
            upgradeVipBtn.originalHTML = upgradeVipBtn.innerHTML;
            logoutBtn.originalHTML = logoutBtn.innerHTML;
            fetchBtn.addEventListener('click', fetchFullSchedule);
            upgradeVipBtn.addEventListener('click', initiatePayment);
            logoutBtn.addEventListener('click', handleLogout);
        }

        greetingMsg.textContent = `Xin chào, ${profile.hoDem} ${profile.ten}!`;
        roleDisplay.textContent = `Trạng thái: ${role === 'vip' ? 'VIP' : 'Thường'}`;
        document.getElementById('user-panel-content').style.display = 'block';
    };

    const resetUI = () => {
        loginForm.style.display = 'block';
        const panel = document.getElementById('user-panel-content');
        if (panel) panel.style.display = 'none';

        scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập để xem dữ liệu.</p>';
        registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có dữ liệu.</p>';
        logOutput.innerHTML = '';
        subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>';
        searchInput.value = '';
        allScheduleData = [];
        selectedClasses.clear();
        updateSelectedList();
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

    // Core logic
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
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('username', username);
            log("✅ Đăng nhập thành công.");
            const initialData = await backendRequest('getInitialData', { username });
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                updateUIAfterLogin(initialData.profile, initialData.role);
                await fetchRegisteredClasses();
            } else {
                log(`❌ Lỗi lấy dữ liệu ban đầu: ${initialData?.message || 'Không rõ'}`, true);
                authToken = null;
                localStorage.removeItem('authToken');
                localStorage.removeItem('username');
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
        userRole = 'none';
        username = '';
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        resetUI();
        log("Đã đăng xuất.");
    };

    const initiatePayment = async () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        if (!username) return log("Không tìm thấy thông tin người dùng. Vui lòng đăng nhập lại.", true);
        toggleLoading(upgradeVipBtn, true);
        const amount = 50000; // Example amount (50,000 VND)
        const paymentRes = await backendRequest('createPayment', { amount, username });

        if (paymentRes && paymentRes.success) {
            log("✅ Đã tạo đơn hàng thanh toán.");
            const orderId = paymentRes.orderId;
            window.open(`/payment.html?id=${orderId}`, '_blank');
            // Start polling payment status
            const checkPaymentInterval = setInterval(async () => {
                const statusRes = await backendRequest('checkSepayPayment', { orderId, username });
                if (statusRes && statusRes.success && statusRes.payment_status === 'Paid') {
                    clearInterval(checkPaymentInterval);
                    log("🎉 Thanh toán thành công! Tài khoản đã được nâng cấp lên VIP.");
                    userRole = 'vip';
                    roleDisplay.textContent = `Trạng thái: VIP`;
                    upgradeVipBtn.classList.add('hidden');
                    fetchBtn.classList.remove('hidden');
                    await fetchRegisteredClasses();
                }
            }, 5000); // Increased to 5 seconds
        } else {
            log(`❌ Lỗi tạo đơn hàng: ${paymentRes?.message || 'Lỗi không xác định'}`, true);
        }
        toggleLoading(upgradeVipBtn, false);
    };

    const fetchFullSchedule = async () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        if (userRole !== 'vip') return log("Yêu cầu tài khoản VIP để lấy lịch học.", true);
        toggleLoading(fetchBtn, true);
        isProcessStopped = false;
        log("♻️ Bắt đầu lấy toàn bộ lịch học từ server...");

        const fetchPrerequisites = prerequisiteToggle?.checked || false;
        const scheduleRes = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites, username });

        if (scheduleRes && scheduleRes.success) {
            allScheduleData = scheduleRes.schedule;
            subjectTypeMap = new Map(Object.entries(scheduleRes.subjectTypes));
            log(`✅ Đã tải thành công ${allScheduleData.length} lớp học phần.`);
            await renderScheduleTable();
        } else {
            log(`❌ Lỗi khi tải lịch học: ${scheduleRes?.message || 'Lỗi'}`, true);
        }
        updateProgressBar(-1);
        toggleLoading(fetchBtn, false);
    };

    const fetchRegisteredClasses = async () => {
        if (!authToken) return;
        toggleLoading(refreshRegisteredBtn, true);
        const fetchPrerequisites = prerequisiteToggle?.checked || false;

        const registeredRes = await backendRequest('getRegisteredClasses', { dotId, fetchPrerequisites });

        if (registeredRes && registeredRes.success) {
            await renderRegisteredTable(registeredRes.body);
            log(`✅ Đã tải danh sách lớp đã đăng ký.`);
        } else {
            log(`❌ Lỗi khi tải lớp đã đăng ký: ${registeredRes?.message || 'Lỗi'}`, true);
        }
        toggleLoading(refreshRegisteredBtn, false);
    };

    const updateSelectedList = () => {
        selectedList.innerHTML = '';
        selectedClasses.forEach((cls, classId) => {
            const li = document.createElement('li');
            li.className = 'py-2 flex justify-between items-center';
            li.innerHTML = `
                <span>${cls.maHocPhan} - ${cls.tenHocPhan}</span>
                <button class="text-red-500 hover:text-red-700 remove-class" data-class-id="${classId}">Xóa</button>
            `;
            selectedList.appendChild(li);
        });

        document.querySelectorAll('.remove-class').forEach(button => {
            button.addEventListener('click', () => {
                selectedClasses.delete(button.dataset.classId);
                updateSelectedList();
            });
        });
    };

    const renderScheduleTable = async () => {
        scheduleContainer.innerHTML = '';
        if (!allScheduleData.length) {
            scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Không có dữ liệu lịch học.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-700';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                    <th class="px-6 py-3">Mã HP</th>
                    <th class="px-6 py-3">Tên HP</th>
                    <th class="px-6 py-3">Mã LHP</th>
                    <th class="px-6 py-3">Lịch học</th>
                    <th class="px-6 py-3">Hành động</th>
                </tr>
            </thead>
            <tbody>
                ${allScheduleData.map(cls => `
                    <tr class="bg-white border-b">
                        <td class="px-6 py-4">${cls.maHocPhan}</td>
                        <td class="px-6 py-4">${cls.tenHocPhan}</td>
                        <td class="px-6 py-4">${cls.maLopHocPhan}</td>
                        <td class="px-6 py-4">${formatScheduleDetail(cls.scheduleDetails)}</td>
                        <td class="px-6 py-4">
                            <button class="add-class text-blue-600 hover:text-blue-800" data-class-id="${cls.id}">Thêm</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        scheduleContainer.appendChild(table);

        document.querySelectorAll('.add-class').forEach(button => {
            button.addEventListener('click', () => {
                const classId = button.dataset.classId;
                const cls = allScheduleData.find(c => c.id === classId);
                selectedClasses.set(classId, cls);
                updateSelectedList();
            });
        });
    };

    const renderRegisteredTable = async (registeredClasses) => {
        registeredContainer.innerHTML = '';
        if (!registeredClasses.length) {
            registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có lớp học nào được đăng ký.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-700';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                    <th class="px-6 py-3">Mã HP</th>
                    <th class="px-6 py-3">Tên HP</th>
                    <th class="px-6 py-3">Mã LHP</th>
                    <th class="px-6 py-3">Lịch học</th>
                    <th class="px-6 py-3">Hành động</th>
                </tr>
            </thead>
            <tbody>
                ${registeredClasses.map(cls => `
                    <tr class="bg-white border-b">
                        <td class="px-6 py-4">${cls.maHocPhan}</td>
                        <td class="px-6 py-4">${cls.tenHocPhan}</td>
                        <td class="px-6 py-4">${cls.maLopHocPhan}</td>
                        <td class="px-6 py-4">${formatSelectedClassDetail(cls, cls.scheduleDetails)}</td>
                        <td class="px-6 py-4">
                            <button class="cancel-class text-red-600 hover:text-red-800" data-reg-id="${cls.id}" data-source="${cls.source}">Hủy</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        registeredContainer.appendChild(table);

        document.querySelectorAll('.cancel-class').forEach(button => {
            button.addEventListener('click', async () => {
                const regId = button.dataset.regId;
                const source = button.dataset.source;
                const cancelRes = await backendRequest('cancel', { registrationId: regId, source });
                if (cancelRes && cancelRes.success) {
                    log(`✅ Đã hủy đăng ký lớp ${regId}.`);
                    await fetchRegisteredClasses();
                } else {
                    log(`❌ Lỗi khi hủy đăng ký: ${cancelRes?.message || 'Lỗi'}`, true);
                }
            });
        });
    };

    const stopProcess = async () => {
        isProcessStopped = true;
        registrationIntervals.forEach(interval => clearInterval(interval));
        registrationIntervals.clear();
        log("⏹️ Đã dừng tất cả quy trình đăng ký.");
    };

    loginBtn.addEventListener('click', handleLogin);
    startInsertionBtn.addEventListener('click', async () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        if (!selectedClasses.size) return log("Chưa chọn lớp học nào.", true);
        if (userRole !== 'vip') return log("Yêu cầu tài khoản VIP để đăng ký.", true);

        log("🚀 Bắt đầu quy trình đăng ký...");
        isProcessStopped = false;
        selectedClasses.forEach(async (cls, classId) => {
            if (isProcessStopped) return;
            const intervalId = setInterval(async () => {
                if (isProcessStopped) {
                    clearInterval(intervalId);
                    registrationIntervals.delete(classId);
                    return;
                }
                const statusRes = await backendRequest('checkClassStatus', { dotId, maHocPhan: cls.maHocPhan, source: cls.source, username });
                if (statusRes && statusRes.success && statusRes.body.length) {
                    const classData = statusRes.body.find(c => c.id === classId);
                    if (classData && classData.soLuongConLai > 0) {
                        const regRes = await backendRequest('register', { classId, source: cls.source, username });
                        if (regRes && regRes.success) {
                            log(`✅ Đăng ký thành công lớp ${cls.maHocPhan} (${cls.maLopHocPhan}).`);
                            clearInterval(intervalId);
                            registrationIntervals.delete(classId);
                            await fetchRegisteredClasses();
                        } else {
                            log(`⚠️ Thử đăng ký lớp ${cls.maHocPhan}: ${regRes?.message || 'Lỗi'}`, true);
                        }
                    } else {
                        log(`⚠️ Lớp ${cls.maHocPhan} (${cls.maLopHocPhan}) không còn slot.`);
                    }
                } else {
                    log(`⚠️ Lỗi kiểm tra trạng thái lớp ${cls.maHocPhan}: ${statusRes?.message || 'Lỗi'}`, true);
                }
            }, parseInt(delayInput.value) || 1000);
            registrationIntervals.set(classId, intervalId);
        });
    });

    startRegistrationBtn.addEventListener('click', () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        if (!selectedClasses.size) return log("Chưa chọn lớp học nào.", true);
        if (userRole !== 'vip') return log("Yêu cầu tài khoản VIP để đăng ký.", true);
        log("🚀 Bắt đầu đăng ký tất cả lớp đã chọn...");
        selectedClasses.forEach(async (cls, classId) => {
            const regRes = await backendRequest('register', { classId, source: cls.source, username });
            if (regRes && regRes.success) {
                log(`✅ Đăng ký thành công lớp ${cls.maHocPhan} (${cls.maLopHocPhan}).`);
                await fetchRegisteredClasses();
            } else {
                log(`❌ Lỗi đăng ký lớp ${cls.maHocPhan}: ${regRes?.message || 'Lỗi'}`, true);
            }
        });
    });

    stopBtn.addEventListener('click', stopProcess);
    refreshRegisteredBtn.addEventListener('click', fetchRegisteredClasses);
    searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase();
        const filteredData = allScheduleData.filter(cls =>
            cls.maHocPhan.toLowerCase().includes(searchTerm) ||
            cls.tenHocPhan.toLowerCase().includes(searchTerm) ||
            cls.maLopHocPhan.toLowerCase().includes(searchTerm)
        );
        allScheduleData = filteredData;
        renderScheduleTable();
    });

    subjectFilter.addEventListener('change', () => {
        const filterValue = subjectFilter.value;
        allScheduleData = allScheduleData.filter(cls => !filterValue || cls.maHocPhan === filterValue);
        renderScheduleTable();
    });

    // Initialize
    if (localStorage.getItem('authToken')) {
        authToken = localStorage.getItem('authToken');
        username = localStorage.getItem('username') || '';
        backendRequest('getInitialData', { username }).then(initialData => {
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                updateUIAfterLogin(initialData.profile, initialData.role);
                fetchRegisteredClasses();
            } else {
                log("❌ Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.", true);
                localStorage.removeItem('authToken');
                localStorage.removeItem('username');
                resetUI();
            }
        });
    }
});