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
    
    // New/Modified DOM Elements
    const mainContent = document.getElementById('main-content');
    const loginForm = document.getElementById('login-form');
    const userInfo = document.getElementById('user-info');
    const userNameEl = document.getElementById('user-name');
    const userStatusEl = document.getElementById('user-status');
    const vipControls = document.getElementById('vip-controls');
    const registrationControls = document.getElementById('registration-controls');
    const upgradeVipBtn = document.getElementById('upgrade-vip-btn');
    const vipModal = document.getElementById('vip-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const vipOptions = document.getElementById('vip-options');
    const paymentSection = document.getElementById('payment-section');
    const qrCodeContainer = document.getElementById('qr-code-container');
    const paymentAmountEl = document.getElementById('payment-amount');
    const paymentUserEl = document.getElementById('payment-user');

    // State
    let token = null;
    let username = null;
    let isVip = false;
    let isRunning = false;
    let allScheduleData = [];
    let selectedClasses = new Map();

    // --- Core API Call Function ---
    async function apiCall(action, payload) {
        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload })
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `Lỗi không xác định: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            log(`Lỗi API: ${error.message}`, 'error');
            throw error;
        }
    }

    // --- UI Update Functions ---
    const log = (message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        const color = type === 'error' ? 'text-red-400' : type === 'success' ? 'text-green-400' : 'text-gray-300';
        logOutput.innerHTML += `<p><span class="text-yellow-400">[${timestamp}]</span> <span class="${color}">${message}</span></p>`;
        logOutput.scrollTop = logOutput.scrollHeight;
    };

    const toggleUIForVip = () => {
        if (isVip) {
            userStatusEl.textContent = 'VIP';
            userStatusEl.className = 'font-semibold text-green-500';
            vipControls.style.display = 'block';
            registrationControls.style.display = 'block';
            upgradeVipBtn.style.display = 'none';
        } else {
            userStatusEl.textContent = 'Free';
            userStatusEl.className = 'font-semibold text-red-500';
            vipControls.style.display = 'none';
            registrationControls.style.display = 'none'; // Người dùng free không được đăng ký
            upgradeVipBtn.style.display = 'block';
        }
    };
    
    // --- Event Handlers ---
    const handleLogin = async () => {
        const user = usernameInput.value.trim();
        const pass = passwordInput.value.trim();
        if (!user || !pass) return log('Vui lòng nhập tài khoản và mật khẩu', 'error');

        loginBtn.disabled = true;
        loginBtn.innerHTML = '<div class="loader"></div>';

        try {
            const data = await apiCall('login', { username: user, password: pass });
            token = data.token;
            isVip = data.is_vip;
            username = user;
            
            log(`Đăng nhập thành công! Chào ${data.fullName}.`, 'success');
            log(`Trạng thái tài khoản: ${isVip ? 'VIP' : 'Free'}.`);

            loginForm.classList.add('hidden');
            mainContent.classList.remove('hidden');
            userInfo.classList.remove('hidden');
            userNameEl.textContent = data.fullName;
            toggleUIForVip();
            await getRegisteredCourses(); // Tải ds đã đk sau khi đăng nhập

        } catch (error) {
            log(`Đăng nhập thất bại: ${error.message}`, 'error');
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Đăng nhập';
        }
    };
    
    // --- Other functions (getRegisteredCourses, renderRegisteredTable, etc.) remain the same ---
    // ... (Your existing functions go here)
    // --- Paste all your existing functions like getRegisteredCourses, renderRegisteredTable, fetchSchedule, etc. here ---
        const getRegisteredCourses = async () => {
        if (!token) return log('Vui lòng đăng nhập trước.', 'error');
        log('Đang tải danh sách lớp đã đăng ký...');
        try {
            const data = await apiCall('getRegistered', { token });
            renderRegisteredTable(data);
            log('Tải danh sách lớp đã đăng ký thành công.', 'success');
        } catch (error) {
            log(`Lỗi khi tải danh sách đã đăng ký: ${error.message}`, 'error');
        }
    };

    const renderRegisteredTable = (data) => {
        if (!data || data.length === 0) {
            registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Không có lớp nào được đăng ký.</p>';
            return;
        }
        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200';
        table.innerHTML = `
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mã Lớp</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tên Môn Học</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trạng thái</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hủy</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
            ${data.map(cls => `
                <tr>
                    <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${cls.maLopHocPhan}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${cls.tenMonHoc}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-green-500">${cls.trangThai}</td>
                    <td class="px-4 py-3 whitespace-nowrap">
                        <button class="cancel-btn text-red-600 hover:text-red-900" data-reg-id="${cls.id}" data-ten-mon="${cls.tenMonHoc}" data-source="${cls.source}">Hủy</button>
                    </td>
                </tr>
            `).join('')}
            </tbody>`;
        registeredContainer.innerHTML = '';
        registeredContainer.appendChild(table);
    };

    const fetchSchedule = async () => {
        const dotId = document.getElementById('dot-id-input').value;
        const source = document.getElementById('source-toggle').checked ? 'dkhp' : 'dkhpdk';
        if (!dotId) return log('Vui lòng nhập ID đợt', 'error');
        if (!isVip) return log('Chỉ tài khoản VIP mới có thể lấy dữ liệu.', 'error');
        log(`Bắt đầu lấy dữ liệu từ ${source} cho đợt ${dotId}...`);
        try {
            const data = await apiCall('getSchedule', { token, dotId, source });
            allScheduleData = data;
            renderScheduleTable();
            populateSubjectFilter();
            log(`Lấy thành công ${data.length} lớp học.`, 'success');
        } catch (error) {
            log(`Lỗi khi lấy dữ liệu: ${error.message}`, 'error');
        }
    };
    const renderScheduleTable = () => {
        const searchTerm = searchInput.value.toLowerCase();
        const selectedSubject = subjectFilter.value;
        const filteredData = allScheduleData.filter(cls =>
            (selectedSubject === "" || cls.maMonHoc === selectedSubject) &&
            (cls.tenMonHoc.toLowerCase().includes(searchTerm) ||
             cls.maLopHocPhan.toLowerCase().includes(searchTerm) ||
             cls.giaoVien.toLowerCase().includes(searchTerm))
        );

        if (filteredData.length === 0) {
            scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Không tìm thấy lớp học phù hợp.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'min-w-full divide-y divide-gray-200';
        table.innerHTML = `
            <thead class="bg-gray-50 sticky top-0">
                <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mã Lớp</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tên Môn</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sĩ số</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lịch học</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Giáo viên</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
            ${filteredData.map(cls => `
                <tr data-class-id="${cls.id}" class="cursor-pointer hover:bg-gray-100 ${selectedClasses.has(cls.id.toString()) ? 'bg-yellow-200' : ''}">
                    <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${cls.maLopHocPhan}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${cls.tenMonHoc}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${cls.siSoDaDangKy}/${cls.siSo}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${cls.lichHoc}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${cls.giaoVien || 'N/A'}</td>
                </tr>
            `).join('')}
            </tbody>`;
        scheduleContainer.innerHTML = '';
        scheduleContainer.appendChild(table);
    };

    const populateSubjectFilter = () => {
        const subjects = [...new Set(allScheduleData.map(cls => JSON.stringify({ ma: cls.maMonHoc, ten: cls.tenMonHoc })))].map(s => JSON.parse(s));
        subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>';
        subjects.sort((a,b) => a.ten.localeCompare(b.ten)).forEach(subject => {
            const option = document.createElement('option');
            option.value = subject.ma;
            option.textContent = subject.ten;
            subjectFilter.appendChild(option);
        });
    };
    
    const updateSelectedList = () => {
        if (selectedClasses.size === 0) {
            selectedList.innerHTML = '<p class="text-gray-500">Chưa chọn lớp nào.</p>';
            return;
        }
        selectedList.innerHTML = Array.from(selectedClasses.values()).map(cls => `
            <div class="flex justify-between items-center bg-gray-100 p-2 rounded">
                <span class="text-sm">${cls.tenMonHoc} (${cls.maLopHocPhan})</span>
                <button class="remove-selected-btn text-red-500 hover:text-red-700" data-class-id="${cls.id}">Xóa</button>
            </div>
        `).join('');
    };
    
    const startProcess = async (mode) => {
        if (!isVip) return log('Chỉ tài khoản VIP mới có thể thực hiện thao tác này.', 'error');
        if (isRunning) return log('Tiến trình đang chạy, vui lòng dừng trước.', 'error');
        if (selectedClasses.size === 0) return log('Vui lòng chọn ít nhất một lớp.', 'error');

        isRunning = true;
        const delay = parseInt(delayInput.value, 10);
        const classes = Array.from(selectedClasses.values());
        const source = document.getElementById('source-toggle').checked ? 'dkhp' : 'dkhpdk';
        log(`Bắt đầu quá trình ${mode} với ${classes.length} lớp, delay ${delay}ms...`);
        
        while (isRunning) {
            for (const cls of classes) {
                if (!isRunning) break;
                log(`Đang xử lý lớp ${cls.tenMonHoc} (${cls.maLopHocPhan})`);
                try {
                    const payload = { token, classId: cls.id, source };
                    const result = await apiCall(mode, payload);
                    log(`Kết quả cho lớp ${cls.maLopHocPhan}: ${result.message}`, result.isSuccess ? 'success' : 'error');
                    if (result.isSuccess) {
                        selectedClasses.delete(cls.id.toString());
                        updateSelectedList();
                    }
                } catch (e) {
                    log(`Lỗi nghiêm trọng với lớp ${cls.maLopHocPhan}: ${e.message}`, 'error');
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            if (selectedClasses.size === 0) {
                log('Tất cả các lớp đã xử lý thành công. Dừng tiến trình.', 'success');
                isRunning = false;
            }
        }
    };
    
    const stopProcess = () => {
        if (!isRunning) return;
        isRunning = false;
        log('Đã gửi yêu cầu dừng, tiến trình sẽ kết thúc sau khi hoàn tất thao tác hiện tại.');
    };

    // --- VIP Modal Logic ---
    const handleVipPurchase = async (e) => {
        const button = e.currentTarget;
        const days = button.dataset.days;
        const price = button.dataset.price;

        log(`Yêu cầu tạo thanh toán cho ${days} ngày VIP...`);
        vipOptions.style.display = 'none';
        paymentSection.style.display = 'block';
        paymentAmountEl.textContent = `${parseInt(price).toLocaleString()}đ`;
        paymentUserEl.textContent = username;
        qrCodeContainer.innerHTML = '<div class="loader"></div>';

        try {
            const data = await apiCall('create-payment', { username, days, price });
            const qrUrl = `https://qr.sepay.vn/img?acc=${data.accountNumber}&bank=${data.bank}&amount=${data.amount}&des=${data.description}`;
            qrCodeContainer.innerHTML = `<img src="${qrUrl}" alt="Mã QR thanh toán" class="mx-auto">`;
            log('Tạo mã QR thành công. Vui lòng quét mã để thanh toán.', 'success');
        } catch (error) {
            log(`Lỗi khi tạo mã QR: ${error.message}`, 'error');
            paymentSection.innerHTML = `<p class="text-red-500">Không thể tạo mã thanh toán. Vui lòng thử lại.</p>`;
        }
    };

    const openVipModal = () => {
        vipModal.classList.remove('hidden');
        vipOptions.style.display = 'block';
        paymentSection.style.display = 'none';
        qrCodeContainer.innerHTML = '';
    };

    const closeVipModal = () => {
        vipModal.classList.add('hidden');
    };

    // --- Initial Event Listeners ---
    loginBtn.addEventListener('click', handleLogin);
    refreshRegisteredBtn.addEventListener('click', getRegisteredCourses);
    if(document.getElementById('fetch-schedule-btn')) {
      document.getElementById('fetch-schedule-btn').addEventListener('click', fetchSchedule);
    }
    startInsertionBtn.addEventListener('click', () => startProcess('insert'));
    startRegistrationBtn.addEventListener('click', () => startProcess('register'));
    stopBtn.addEventListener('click', stopProcess);
    searchInput.addEventListener('input', () => renderScheduleTable());
    subjectFilter.addEventListener('change', () => renderScheduleTable());
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    // VIP Modal Listeners
    upgradeVipBtn.addEventListener('click', openVipModal);
    closeModalBtn.addEventListener('click', closeVipModal);
    document.querySelectorAll('.vip-package-btn').forEach(btn => {
        btn.addEventListener('click', handleVipPurchase);
    });

    document.addEventListener('click', (e) => {
        // Class selection logic
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow && isVip) { // Only VIP can select
            const classId = scheduleRow.dataset.classId;
            const cls = allScheduleData.find(c => c.id.toString() === classId);
            if (!cls) return;
            if (selectedClasses.has(classId)) selectedClasses.delete(classId);
            else selectedClasses.set(classId, cls);
            scheduleRow.classList.toggle('bg-yellow-200');
            updateSelectedList();
        }
        // Remove from selected list
        const removeBtn = e.target.closest('.remove-selected-btn');
        if (removeBtn) {
            const classId = removeBtn.dataset.classId;
            selectedClasses.delete(classId);
            const rowToUpdate = document.querySelector(`#schedule-container tr[data-class-id='${classId}']`);
            if (rowToUpdate) rowToUpdate.classList.remove('bg-yellow-200');
            updateSelectedList();
        }
        // Cancel registration
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const { regId, tenMon, source } = cancelBtn.dataset;
            if (confirm(`Bạn có chắc chắn muốn hủy đăng ký môn "${tenMon}" không?`)) {
                apiCall('unregister', { token, regId, source })
                    .then(result => {
                        log(result.message, result.isSuccess ? 'success' : 'error');
                        if (result.isSuccess) getRegisteredCourses();
                    })
                    .catch(e => log(`Lỗi khi hủy đăng ký: ${e.message}`, 'error'));
            }
        }
    });
});