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
    const scheduleContainer = document.getElementById('schedule-container');
    const registeredContainer = document.getElementById('registered-container');
    const selectedList = document.getElementById('selected-classes-list');
    const logOutput = document.getElementById('log-output');
    const loginForm = document.getElementById('login-form');
    const mainContent = document.getElementById('main-content');
    const scheduleSection = document.getElementById('schedule-section');
    const resultsSection = document.getElementById('results-section');
    const prerequisiteToggle = document.getElementById('prerequisite-toggle');
    const fetchScheduleBtn = document.getElementById('fetch-schedule-btn');
    const logoutBtn = document.getElementById('logout-btn');

    // VIP Elements
    const buyVipBtn = document.getElementById('buy-vip-btn');
    const vipBadge = document.getElementById('vip-badge');
    const vipModal = document.getElementById('vip-modal');
    const closeVipModalBtn = document.getElementById('close-vip-modal-btn');
    const vipPlansContainer = document.getElementById('vip-plans-container');
    const paymentQrContainer = document.getElementById('payment-qr-container');
    const qrCodeDisplay = document.getElementById('qr-code-display');

    // State Variables
    let authToken = null, dotId = null, isVip = false;
    let allScheduleData = [], selectedClasses = new Map();
    let isProcessRunning = false, stopFlag = false;

    // --- UTILITY FUNCTIONS ---
    const log = (message, isError = false) => {
        const timestamp = new Date().toLocaleTimeString();
        const color = isError ? 'text-red-400' : 'text-green-400';
        logOutput.innerHTML += `<div><span class="text-gray-500">[${timestamp}]</span> <span class="${color}">${message}</span></div>`;
        logOutput.scrollTop = logOutput.scrollHeight;
    };

    const toggleLoading = (button, isLoading) => {
        const textElement = button.querySelector('span');
        const loaderElement = button.querySelector('.loader');
        if (isLoading) {
            button.disabled = true;
            if (textElement) textElement.classList.add('hidden');
            if (loaderElement) loaderElement.classList.remove('hidden');
        } else {
            button.disabled = false;
            if (textElement) textElement.classList.remove('hidden');
            if (loaderElement) loaderElement.classList.add('hidden');
        }
    };

    const backendRequest = async (action, payload = {}) => {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            // Trình duyệt có sẵn hàm fetch, không cần 'require'
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action, payload }),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `Lỗi HTTP: ${response.status}` }));
                throw new Error(errorData.message);
            }
            return await response.json();
        } catch (error) {
            log(`Lỗi mạng hoặc server: ${error.message}`, true);
            return null;
        }
    };
    
    // --- UI UPDATE FUNCTIONS ---
    const updateUIAfterLogin = (profile, vipStatus) => {
        loginForm.style.display = 'none';
        mainContent.classList.remove('hidden');
        resultsSection.style.display = 'grid';
        isVip = vipStatus;
        document.getElementById('greeting-msg').textContent = `Xin chào, ${profile.hoDem} ${profile.ten}!`;
        if (isVip) {
            vipBadge.classList.remove('hidden');
            buyVipBtn.classList.add('hidden');
            log("⭐ Chào mừng thành viên VIP!");
        } else {
            vipBadge.classList.add('hidden');
            buyVipBtn.classList.remove('hidden');
        }
        document.getElementById('user-panel-content').style.display = 'block';
    };

    const resetUI = () => {
        loginForm.style.display = 'block';
        mainContent.classList.add('hidden');
        scheduleSection.style.display = 'none';
        resultsSection.style.display = 'none';
        logOutput.innerHTML = '';
        scheduleContainer.innerHTML = '';
        registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có dữ liệu.</p>';
        selectedList.innerHTML = '<p class="text-gray-500">Chưa có lớp học phần nào được chọn.</p>';
        isVip = false;
        buyVipBtn.classList.add('hidden');
        vipBadge.classList.add('hidden');
        authToken = null;
        dotId = null;
        allScheduleData = [];
        selectedClasses.clear();
    };
    
    const renderScheduleTable = () => {
        const searchTerm = searchInput.value.toLowerCase();
        const filteredData = allScheduleData.filter(cls => 
            cls.tenMonHoc.toLowerCase().includes(searchTerm) || 
            cls.maLopHocPhan.toLowerCase().includes(searchTerm)
        );
        scheduleContainer.innerHTML = filteredData.map(cls => `
            <tr data-class-id="${cls.id}" class="bg-white border-b hover:bg-gray-50 cursor-pointer ${selectedClasses.has(String(cls.id)) ? 'bg-yellow-100' : ''}">
                <td class="px-6 py-4"><input type="checkbox" class="pointer-events-none" ${selectedClasses.has(String(cls.id)) ? 'checked' : ''}></td>
                <td class="px-6 py-4 font-medium text-gray-900">${cls.maLopHocPhan}</td>
                <td class="px-6 py-4">${cls.tenMonHoc}</td>
                <td class="px-6 py-4">${cls.soLuongDaDangKy} / ${cls.siSo}</td>
                <td class="px-6 py-4 text-xs">${cls.lichHocChiTiet || 'Đang tải...'}</td>
            </tr>
        `).join('') || `<tr><td colspan="5" class="text-center py-4">Không tìm thấy lớp học phần.</td></tr>`;
    };

    const updateSelectedList = () => {
        if (selectedClasses.size === 0) {
            selectedList.innerHTML = '<p class="text-gray-500">Chưa có lớp học phần nào được chọn.</p>';
            return;
        }
        selectedList.innerHTML = [...selectedClasses.values()].map(cls => `
            <div class="flex justify-between items-center bg-gray-100 p-2 rounded">
                <span>${cls.tenMonHoc} (${cls.maLopHocPhan})</span>
                <button class="remove-selected-btn text-red-500 hover:text-red-700 font-bold" data-class-id="${cls.id}">&times;</button>
            </div>
        `).join('');
    };

    const renderRegisteredClasses = (classes) => {
        if (!classes || classes.length === 0) {
            registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Bạn chưa đăng ký học phần nào.</p>';
            return;
        }
        registeredContainer.innerHTML = `
            <table class="w-full text-sm text-left text-gray-500">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50"><tr>
                    <th class="px-4 py-2">Tên Môn Học</th><th class="px-4 py-2">Mã LHP</th><th class="px-4 py-2">Hành động</th>
                </tr></thead>
                <tbody>${classes.map(cls => `
                    <tr class="bg-white border-b">
                        <td class="px-4 py-2">${cls.tenMonHoc}</td>
                        <td class="px-4 py-2">${cls.maLopHocPhan}</td>
                        <td class="px-4 py-2">
                            <button class="cancel-btn text-red-500 hover:underline" data-reg-id="${cls.id}" data-ten-mon="${cls.tenMonHoc}" data-source="${cls.source}">Hủy</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    };

    // --- CORE LOGIC FUNCTIONS ---
    const handleLogin = async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !password) {
            log('Vui lòng nhập đầy đủ thông tin.', true);
            return;
        }
        toggleLoading(loginBtn, true);
        const tokenRes = await backendRequest('login', { username, password });
        toggleLoading(loginBtn, false);

        if (tokenRes && tokenRes.token) {
            authToken = tokenRes.token;
            log("✅ Đăng nhập thành công.");
            const initialData = await backendRequest('getInitialData');
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                log(`✅ Đã chọn đợt: ${initialData.dot.tenDot}`);
                updateUIAfterLogin(initialData.profile, initialData.isVip);
                await fetchRegisteredClasses();
            } else {
                log('❌ Không thể lấy dữ liệu người dùng hoặc đợt học.', true);
            }
        } else {
            log(`❌ Đăng nhập thất bại: ${tokenRes?.body?.Message || tokenRes?.message || 'Lỗi không xác định.'}`, true);
        }
    };
    
    const handleLogout = () => {
        resetUI();
        log('Đã đăng xuất.');
    };
    
    const fetchFullSchedule = async () => {
        log('Đang tải toàn bộ lịch học, vui lòng chờ...');
        toggleLoading(fetchScheduleBtn, true);
        const result = await backendRequest('getFullSchedule', { idDot: dotId, isCay: prerequisiteToggle.checked });
        toggleLoading(fetchScheduleBtn, false);

        if (result && result.success) {
            allScheduleData = result.data;
            log(`✅ Tải thành công ${allScheduleData.length} lớp học phần.`);
            renderScheduleTable();
            scheduleSection.style.display = 'block';
        } else {
            log(`❌ Lỗi khi tải lịch học: ${result?.message || 'Lỗi không xác định.'}`, true);
        }
    };

    const fetchRegisteredClasses = async () => {
        const res = await backendRequest('getRegisteredClasses', { idDot: dotId });
        if (res && res.success) {
            renderRegisteredClasses(res.body);
        } else {
            registeredContainer.innerHTML = '<p class="text-red-500 text-center py-8">Không thể tải danh sách đã đăng ký.</p>';
        }
    };

    const getDelay = () => {
        const baseDelay = parseInt(delayInput.value, 10) || 1000;
        if (isVip) {
            const vipDelay = Math.max(200, baseDelay / 2);
            log(`⭐ Ưu tiên VIP! Sử dụng delay: ${vipDelay}ms`);
            return vipDelay;
        }
        return baseDelay;
    };
    
    const startProcess = async (mode) => {
        if (selectedClasses.size === 0) {
            log('Vui lòng chọn ít nhất một lớp học phần.', true);
            return;
        }
        stopFlag = false;
        isProcessRunning = true;
        const actionVerb = mode === 'register' ? 'Đăng ký' : 'Chèn';
        log(`Bắt đầu quá trình ${actionVerb}...`);
        
        while (!stopFlag && selectedClasses.size > 0) {
            for (const classId of selectedClasses.keys()) {
                if (stopFlag) break;
                const cls = selectedClasses.get(classId);
                const source = prerequisiteToggle.checked ? 'dkhpdk' : 'dkhp';
                log(`Đang thử ${actionVerb} lớp ${cls.tenMonHoc} (${cls.maLopHocPhan})...`);
                const res = await backendRequest('register', { classId, source });

                if (res && res.success && res.body.IsSuccess) {
                    log(`✅ ${actionVerb} thành công: ${res.body.Message}`, false);
                    selectedClasses.delete(classId);
                    updateSelectedList();
                    renderScheduleTable(); // Cập nhật lại bảng để bỏ highlight
                    await fetchRegisteredClasses();
                } else {
                    log(`❌ ${actionVerb} thất bại: ${res?.body?.Message || res?.message || 'Lỗi không xác định.'}`, true);
                }
                await new Promise(resolve => setTimeout(resolve, getDelay()));
            }
            if (!stopFlag && selectedClasses.size > 0) {
                log("Hoàn tất một vòng lặp, tiếp tục lặp lại...");
                await new Promise(resolve => setTimeout(resolve, getDelay()));
            }
        }
        log('Quá trình đã dừng.');
        isProcessRunning = false;
    };
    
    const stopProcess = () => {
        if (isProcessRunning) {
            stopFlag = true;
        }
    };
    
    // --- VIP & PAYMENT FUNCTIONS ---
    const openVipModal = () => {
        vipModal.classList.remove('hidden');
        paymentQrContainer.classList.add('hidden');
        vipPlansContainer.style.display = 'block';
        qrCodeDisplay.innerHTML = '';
    };

    const closeVipModal = () => vipModal.classList.add('hidden');
    
    const handlePurchase = async (planDays) => {
        log(`Đang tạo đơn hàng cho gói ${planDays} ngày...`);
        vipPlansContainer.style.display = 'none';
        paymentQrContainer.classList.remove('hidden');
        qrCodeDisplay.innerHTML = `<div class="loader mx-auto"></div>`;

        const result = await backendRequest('createPayment', { planDays });
        
        if (result && result.success) {
            log('✅ Tạo mã QR thành công. Vui lòng quét mã để thanh toán.');
            qrCodeDisplay.innerHTML = `<img src="${result.qrCodeUrl}" alt="Mã QR thanh toán" class="mx-auto max-w-xs">`;
        } else {
            log(`❌ Lỗi tạo đơn hàng: ${result?.message || 'Không rõ'}`, true);
            qrCodeDisplay.innerHTML = `<p class="text-red-500">Tạo mã QR thất bại. Vui lòng thử lại.</p>`;
        }
    };
    
    // --- EVENT LISTENERS ---
    loginBtn.addEventListener('click', handleLogin);
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    logoutBtn.addEventListener('click', handleLogout);
    fetchScheduleBtn.addEventListener('click', fetchFullSchedule);
    refreshRegisteredBtn.addEventListener('click', fetchRegisteredClasses);
    startRegistrationBtn.addEventListener('click', () => startProcess('register'));
    stopBtn.addEventListener('click', stopProcess);
    searchInput.addEventListener('input', renderScheduleTable);

    document.addEventListener('click', (e) => {
        // Chọn/Bỏ chọn lớp trong bảng lịch học
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow && scheduleRow.dataset.classId) {
            const classId = scheduleRow.dataset.classId;
            const cls = allScheduleData.find(c => c.id.toString() === classId);
            if (!cls) return;
            if (selectedClasses.has(classId)) {
                selectedClasses.delete(classId);
            } else {
                selectedClasses.set(classId, cls);
            }
            scheduleRow.classList.toggle('bg-yellow-100');
            updateSelectedList();
        }

        // Xóa lớp khỏi danh sách đã chọn
        const removeBtn = e.target.closest('.remove-selected-btn');
        if (removeBtn) {
            const classId = removeBtn.dataset.classId;
            selectedClasses.delete(classId);
            const rowToUpdate = document.querySelector(`#schedule-container tr[data-class-id='${classId}']`);
            if (rowToUpdate) rowToUpdate.classList.remove('bg-yellow-100');
            updateSelectedList();
        }

        // Hủy đăng ký học phần
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const { regId, tenMon, source } = cancelBtn.dataset;
            if (confirm(`Bạn có chắc chắn muốn hủy học phần "${tenMon}" không?`)) {
                backendRequest('cancel', { registrationId: regId, source }).then(res => {
                    if (res && res.success && res.body.IsSuccess) {
                        log(`✅ Hủy thành công lớp ${tenMon}`, false);
                        fetchRegisteredClasses();
                    } else {
                        log(`❌ Hủy thất bại: ${res?.body?.Message || 'Lỗi'}`, true);
                    }
                });
            }
        }
    });

    // VIP Modal Event Listeners
    buyVipBtn.addEventListener('click', openVipModal);
    closeVipModalBtn.addEventListener('click', closeVipModal);
    
    document.querySelectorAll('.vip-plan-option').forEach(el => {
        el.addEventListener('click', () => {
            const days = parseInt(el.dataset.days, 10);
            handlePurchase(days);
        });
    });

    vipModal.addEventListener('click', (e) => {
        if (e.target === vipModal) closeVipModal();
    });
});