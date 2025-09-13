document.addEventListener('DOMContentLoaded', () => {
    // CSS Toggle Switch
    const style = document.createElement('style');
    style.innerHTML = `
        input:checked ~ .dot { transform: translateX(100%); background-color: #48bb78; }
        input:checked ~ .block { background-color: #a7f3d0; }
        #close-vip-modal-btn { font-size: 2rem; line-height: 1; }
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
    const dkhpdkToggle = document.getElementById('dkhpdk-toggle');
    
    // User Info & VIP Elements
    const userInfoSection = document.getElementById('user-info-section');
    const userNameDisplay = document.getElementById('user-name-display');
    const vipStatusDisplay = document.getElementById('vip-status-display');
    const buyVipBtn = document.getElementById('buy-vip-btn');
    const logoutBtn = document.getElementById('logout-btn');

    // VIP Modal Elements
    const vipModal = document.getElementById('vip-modal');
    const closeVipModalBtn = document.getElementById('close-vip-modal-btn');
    const vipStep1 = document.getElementById('vip-step-1');
    const vipStep2 = document.getElementById('vip-step-2');
    const qrCodeContainer = document.getElementById('qr-code-container');
    const paymentAmount = document.getElementById('payment-amount');
    const paymentContent = document.getElementById('payment-content');
    const paymentStatus = document.getElementById('payment-status');
    const backToPlansBtn = document.getElementById('back-to-plans-btn');


    // State
    let token = localStorage.getItem('authToken');
    let username = localStorage.getItem('username');
    let allScheduleData = [];
    let selectedClasses = new Map();
    let isProcessing = false;
    let stopFlag = false;
    let paymentCheckInterval = null;

    // --- Core Functions ---
    const log = (message, type = 'info') => {
        const now = new Date().toLocaleTimeString();
        const color = type === 'error' ? 'text-red-400' : type === 'success' ? 'text-green-400' : 'text-gray-300';
        logOutput.innerHTML += `<p><span class="text-cyan-400">[${now}]</span> <span class="${color}">${message}</span></p>`;
        logOutput.scrollTop = logOutput.scrollHeight;
    };

    const apiRequest = async (action, payload = {}, requiresAuth = true) => {
        const headers = { 'Content-Type': 'application/json' };
        if (requiresAuth) {
            if (!token) {
                log('Lỗi: Token không hợp lệ. Vui lòng đăng nhập lại.', 'error');
                handleLogout();
                return null;
            }
            headers['Authorization'] = `Bearer ${token}`;
        }
        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action, payload })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Lỗi không xác định từ server.' }));
                throw new Error(errorData.message || `Lỗi HTTP: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            log(`Lỗi API [${action}]: ${error.message}`, 'error');
            if (error.message.includes("Token đã hết hạn")) handleLogout();
            return null;
        }
    };
    
    // --- UI Update Functions ---
    const updateButtonState = (processing) => {
        isProcessing = processing;
        startInsertionBtn.disabled = processing;
        startRegistrationBtn.disabled = processing;
        stopBtn.classList.toggle('hidden', !processing);

        [startInsertionBtn, startRegistrationBtn].forEach(btn => {
             if (processing) {
                btn.classList.add('bg-gray-400', 'cursor-not-allowed');
                btn.classList.remove('bg-green-600', 'hover:bg-green-700', 'bg-blue-600', 'hover:bg-blue-700');
            } else {
                btn.classList.remove('bg-gray-400', 'cursor-not-allowed');
                // Re-enable based on which one is relevant
                if(btn.id === 'start-insertion-btn') btn.classList.add('bg-blue-600', 'hover:bg-blue-700');
                if(btn.id === 'start-registration-btn') btn.classList.add('bg-green-600', 'hover:bg-green-700');
            }
        });
    };
    
    const renderTable = (container, data, type) => {
        if (!data || data.length === 0) {
            container.innerHTML = `<p class="text-gray-500 text-center py-8">Không có dữ liệu.</p>`;
            return;
        }

        const headers = type === 'schedule' 
            ? ['Mã LHP', 'Tên môn', 'TC', 'Lớp', 'Sĩ số', 'Đã ĐK', 'Lịch học', 'Giảng viên'] 
            : ['Mã LHP', 'Tên môn', 'TC', 'Trạng thái', 'Hủy'];

        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left';
        table.innerHTML = `
            <thead class="bg-gray-200">
                <tr>${headers.map(h => `<th class="p-3">${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${data.map(item => type === 'schedule' ? createScheduleRow(item) : createRegisteredRow(item)).join('')}
            </tbody>
        `;
        container.innerHTML = '';
        container.appendChild(table);
    };
    
    const createScheduleRow = (cls) => {
        const isSelected = selectedClasses.has(cls.id.toString());
        return `
            <tr data-class-id="${cls.id}" class="border-b hover:bg-gray-100 cursor-pointer ${isSelected ? 'bg-yellow-200' : ''}">
                <td class="p-3">${cls.maLopHocPhan}</td>
                <td class="p-3 font-semibold">${cls.tenMonHoc}</td>
                <td class="p-3">${cls.soTinChi}</td>
                <td class="p-3">${cls.tenLop}</td>
                <td class="p-3">${cls.siSo}</td>
                <td class="p-3">${cls.soLuongDaDangKy} / ${cls.soLuongToiDa}</td>
                <td class="p-3">${cls.tkb}</td>
                <td class="p-3">${cls.giangVien}</td>
            </tr>`;
    };

    const createRegisteredRow = (reg) => {
        const source = dkhpdkToggle.checked ? 'dkhpdk' : 'dkhp';
        return `
            <tr class="border-b">
                <td class="p-3">${reg.maLopHocPhan}</td>
                <td class="p-3 font-semibold">${reg.tenMonHoc}</td>
                <td class="p-3">${reg.soTinChi}</td>
                <td class="p-3">${reg.trangThai}</td>
                <td class="p-3">
                    <button class="cancel-btn bg-red-500 text-white px-2 py-1 rounded" data-reg-id="${reg.id}" data-ten-mon="${reg.tenMonHoc}" data-source="${source}">Hủy</button>
                </td>
            </tr>`;
    };
    
    const renderScheduleTable = () => {
        const searchTerm = searchInput.value.toLowerCase();
        const selectedSubject = subjectFilter.value;
        const filteredData = allScheduleData.filter(cls => {
            const matchesSearch = Object.values(cls).some(val => 
                String(val).toLowerCase().includes(searchTerm)
            );
            const matchesSubject = !selectedSubject || cls.maMonHoc === selectedSubject;
            return matchesSearch && matchesSubject;
        });
        renderTable(scheduleContainer, filteredData, 'schedule');
    };

    const updateSelectedList = () => {
        if (selectedClasses.size === 0) {
            selectedList.innerHTML = '<p class="text-gray-500 text-center">Chưa chọn lớp nào.</p>';
            return;
        }
        selectedList.innerHTML = Array.from(selectedClasses.values()).map(cls => `
            <div class="flex justify-between items-center bg-gray-100 p-2 rounded">
                <span>${cls.tenMonHoc} (${cls.maLopHocPhan})</span>
                <button class="remove-selected-btn text-red-500" data-class-id="${cls.id}">&times;</button>
            </div>
        `).join('');
    };

    // --- Authentication and User Status ---
    const handleLogin = async () => {
        const u = usernameInput.value.trim();
        const p = passwordInput.value.trim();
        if (!u || !p) {
            log('Vui lòng nhập tên đăng nhập và mật khẩu.', 'error');
            return;
        }
        loginBtn.textContent = 'Đang đăng nhập...';
        loginBtn.disabled = true;

        const result = await apiRequest('login', { username: u, password: p }, false);

        loginBtn.textContent = 'Đăng nhập';
        loginBtn.disabled = false;

        if (result && result.success) {
            log('Đăng nhập thành công!', 'success');
            token = result.token;
            username = u;
            localStorage.setItem('authToken', token);
            localStorage.setItem('username', username);
            initializeApp();
        } else {
            log(result?.message || 'Đăng nhập thất bại.', 'error');
        }
    };
    
    const handleLogout = () => {
        token = null;
        username = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        
        loginForm.classList.remove('hidden');
        registrationControls.classList.add('hidden');
        userInfoSection.classList.add('hidden');
        
        // Reset UI
        allScheduleData = [];
        selectedClasses.clear();
        scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập để xem lịch.</p>';
        registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập để xem lịch.</p>';
        updateSelectedList();
        log('Đã đăng xuất.');
    };
    
    const fetchUserStatus = async () => {
        const result = await apiRequest('get-user-status', { username });
        if(result && result.success) {
            userNameDisplay.textContent = username;
            if(result.tier === 'vip') {
                const expiryDate = new Date(result.vipExpiry._seconds * 1000).toLocaleString('vi-VN');
                vipStatusDisplay.innerHTML = `Trạng thái: <span class="font-bold text-amber-500">VIP</span> (Hết hạn: ${expiryDate})`;
            } else {
                vipStatusDisplay.innerHTML = `Trạng thái: <span class="font-bold text-gray-500">Free</span>`;
            }
        } else {
            vipStatusDisplay.textContent = 'Không thể tải trạng thái.';
        }
    };


    // --- Core App Logic ---
    const initializeApp = async () => {
        if (!token || !username) return;

        loginForm.classList.add('hidden');
        registrationControls.classList.remove('hidden');
        userInfoSection.classList.remove('hidden');
        
        await fetchUserStatus();
        await fetchRegisteredCourses();
        await fetchSchedule();
    };

    const fetchSchedule = async () => {
        log('Đang tải danh sách lớp học phần...');
        scheduleContainer.innerHTML = '<div class="flex justify-center items-center py-8"><div class="loader"></div></div>';
        const source = dkhpdkToggle.checked ? 'dkhpdk' : 'dkhp';
        const result = await apiRequest('get-schedule', { source });
        if (result && result.success) {
            allScheduleData = result.data;
            renderScheduleTable();
            const subjects = [...new Set(allScheduleData.map(c => c.maMonHoc))].map(maMH => {
                const cls = allScheduleData.find(c => c.maMonHoc === maMH);
                return { ma: maMH, ten: cls.tenMonHoc };
            });
            subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>' + subjects.map(s => `<option value="${s.ma}">${s.ten}</option>`).join('');
            log('Tải danh sách lớp thành công.', 'success');
        } else {
            scheduleContainer.innerHTML = `<p class="text-red-500 text-center py-8">${result?.message || 'Lỗi khi tải lịch.'}</p>`;
        }
    };
    
    const fetchRegisteredCourses = async () => {
        log('Đang tải danh sách lớp đã đăng ký...');
        registeredContainer.innerHTML = '<div class="flex justify-center items-center py-8"><div class="loader"></div></div>';
        const source = dkhpdkToggle.checked ? 'dkhpdk' : 'dkhp';
        const result = await apiRequest('get-registered', { source });
        if (result && result.success) {
            renderTable(registeredContainer, result.data, 'registered');
            log('Tải danh sách lớp đã đăng ký thành công.', 'success');
        } else {
             registeredContainer.innerHTML = `<p class="text-red-500 text-center py-8">${result?.message || 'Lỗi khi tải danh sách.'}</p>`;
        }
    };

    const cancelRegistration = async (regId, tenMon, source) => {
        const result = await apiRequest('cancel', { registrationId: regId, source });
        if (result && result.success) {
            log(`Hủy thành công môn: ${tenMon}`, 'success');
            fetchRegisteredCourses(); // Refresh list
        } else {
            log(`Lỗi khi hủy môn ${tenMon}: ${result?.message}`, 'error');
        }
    };

    const startProcess = async (mode) => {
        if (isProcessing) return;
        if (selectedClasses.size === 0) {
            log('Vui lòng chọn ít nhất một lớp học phần.', 'error');
            return;
        }

        updateButtonState(true);
        stopFlag = false;
        const delay = parseInt(delayInput.value, 10) || 1000;
        const action = mode === 'register' ? 'register' : 'insert';
        const actionName = mode === 'register' ? 'Đăng ký' : 'Chèn';
        const source = dkhpdkToggle.checked ? 'dkhpdk' : 'dkhp';

        log(`Bắt đầu quá trình ${actionName} với độ trễ ${delay}ms...`);

        while (!stopFlag && selectedClasses.size > 0) {
            for (const [classId, cls] of selectedClasses.entries()) {
                if (stopFlag) break;
                
                log(`Đang thử ${actionName} lớp ${cls.maLopHocPhan} - ${cls.tenMonHoc}...`);
                const result = await apiRequest(action, { classId, source });

                if (result && result.success) {
                    log(`${actionName} thành công lớp ${cls.maLopHocPhan}!`, 'success');
                    selectedClasses.delete(classId);
                    updateSelectedList();
                     const row = document.querySelector(`#schedule-container tr[data-class-id='${classId}']`);
                    if(row) row.classList.remove('bg-yellow-200');
                } else {
                     log(`Lỗi ${actionName} lớp ${cls.maLopHocPhan}: ${result?.message || 'Lỗi không xác định'}`, 'error');
                }
                
                if (selectedClasses.size === 0 || stopFlag) break;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
             if (selectedClasses.size === 0 || stopFlag) break;
        }

        if(stopFlag) log('Đã dừng quá trình.');
        else log('Hoàn tất quá trình.');
        
        updateButtonState(false);
        fetchRegisteredCourses();
    };

    const stopProcess = () => {
        stopFlag = true;
    };
    
    // --- VIP Payment Functions ---
    const openVipModal = () => {
      vipModal.classList.remove('hidden');
      vipStep1.classList.remove('hidden');
      vipStep2.classList.add('hidden');
      if (paymentCheckInterval) clearInterval(paymentCheckInterval);
    };

    const closeVipModal = () => {
      vipModal.classList.add('hidden');
      if (paymentCheckInterval) clearInterval(paymentCheckInterval);
    };

    const generateVietQRUrl = (amount, content) => {
        // THAY THẾ CÁC THÔNG TIN SAU BẰNG THÔNG TIN TÀI KHOẢN NGÂN HÀNG CỦA BẠN
        const bankId = '970422'; // MB Bank
        const accountNumber = '0948964567'; // Your Account Number
        const accountName = 'NGUYEN VAN A'; // Your Account Name
        // --------------------------------------------------------------------

        const qrUrl = `https://api.vietqr.io/image/${bankId}-${accountNumber}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(accountName)}`;
        return qrUrl;
    };
    
    const initiatePayment = async (days, amount) => {
        vipStep1.classList.add('hidden');
        vipStep2.classList.remove('hidden');
        qrCodeContainer.innerHTML = '<div class="loader"></div>';
        paymentStatus.innerHTML = `<div class="flex justify-center items-center"><div class="loader mr-2"></div><span>Đang tạo giao dịch...</span></div>`;

        const result = await apiRequest('create-payment', { username, days, amount });

        if (result && result.success) {
            const { transactionId, paymentContent: content, amount: finalAmount } = result;
            const qrUrl = generateVietQRUrl(finalAmount, content);
            
            qrCodeContainer.innerHTML = `<img src="${qrUrl}" alt="Mã QR thanh toán" class="w-64 h-64">`;
            paymentAmount.textContent = `${finalAmount.toLocaleString('vi-VN')} VNĐ`;
            paymentContent.textContent = content;

            pollPaymentStatus(transactionId);
        } else {
            paymentStatus.innerHTML = `<span class="text-red-500">Lỗi: ${result?.message || 'Không thể tạo giao dịch.'}</span>`;
        }
    };
    
    const pollPaymentStatus = (transactionId) => {
        paymentStatus.innerHTML = `<div class="flex justify-center items-center"><div class="loader mr-2"></div><span>Đang chờ thanh toán...</span></div>`;
        
        if (paymentCheckInterval) clearInterval(paymentCheckInterval);

        paymentCheckInterval = setInterval(async () => {
            const result = await apiRequest('check-payment-status', { transactionId });
            if (result && result.success && result.status === 'completed') {
                clearInterval(paymentCheckInterval);
                paymentStatus.innerHTML = `<span class="text-green-500 font-bold">Thanh toán thành công!</span>`;
                log('Nâng cấp VIP thành công!', 'success');
                await fetchUserStatus(); // Cập nhật lại trạng thái VIP trên UI
                setTimeout(closeVipModal, 2000); // Tự động đóng modal sau 2s
            }
        }, 3000); // Kiểm tra mỗi 3 giây
    };

    // --- Event Listeners ---
    loginBtn.addEventListener('click', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    refreshRegisteredBtn.addEventListener('click', fetchRegisteredCourses);
    startInsertionBtn.addEventListener('click', () => startProcess('insert'));
    startRegistrationBtn.addEventListener('click', () => startProcess('register'));
    stopBtn.addEventListener('click', stopProcess);
    searchInput.addEventListener('input', renderScheduleTable);
    subjectFilter.addEventListener('change', renderScheduleTable);
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    dkhpdkToggle.addEventListener('change', () => {
        if(token) {
            fetchRegisteredCourses();
            fetchSchedule();
        }
    });

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
    
    // VIP Modal Listeners
    buyVipBtn.addEventListener('click', openVipModal);
    closeVipModalBtn.addEventListener('click', closeVipModal);
    backToPlansBtn.addEventListener('click', () => {
      vipStep1.classList.remove('hidden');
      vipStep2.classList.add('hidden');
      if (paymentCheckInterval) clearInterval(paymentCheckInterval);
    });
    
    document.querySelectorAll('.vip-plan-btn').forEach(button => {
        button.addEventListener('click', () => {
            const days = parseInt(button.dataset.days);
            const amount = parseInt(button.dataset.amount);
            initiatePayment(days, amount);
        });
    });


    // Initial Check
    if (token && username) {
        initializeApp();
    }
});
