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
    
    // Dynamic Elements
    const getScheduleBtn = document.getElementById('get-schedule-btn');
    const prerequisiteToggle = document.getElementById('prerequisite-toggle');
    const userInfoDiv = document.getElementById('user-info');
    const userNameSpan = document.getElementById('user-name');
    const userCodeSpan = document.getElementById('user-code');
    const dotNameSpan = document.getElementById('dot-name');
    
    // State
    let authToken = null;
    let dotId = null;
    let allScheduleData = [];
    let allSubjects = {};
    let selectedClasses = new Map();
    let isProcessRunning = false;
    let registeredClassIds = new Set();
    
    // Constants
    const API_ENDPOINT = './api/handler';

    // --- UTILITY FUNCTIONS ---
    function log(message, isError = false) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('p');
        logEntry.innerHTML = `[${timestamp}] ${message}`;
        if (isError) {
            logEntry.className = 'text-red-400';
        } else {
            logEntry.className = 'text-green-300';
        }
        logOutput.appendChild(logEntry);
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    function toggleLoading(button, isLoading) {
        if (isLoading) {
            button.disabled = true;
            button.originalHTML = button.innerHTML;
            button.innerHTML = `<div class="loader mx-auto"></div>`;
        } else {
            button.disabled = false;
            button.innerHTML = button.originalHTML;
        }
    }

    async function backendRequest(action, payload = {}) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ action, payload })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Lỗi không xác định từ server.' }));
                throw new Error(errorData.message || `Lỗi HTTP: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            log(`Lỗi mạng hoặc server: ${error.message}`, true);
            return { success: false, message: error.message };
        }
    }

    // --- CORE LOGIC FUNCTIONS ---
    const handleLogin = async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !password) {
            log("Vui lòng nhập đầy đủ thông tin đăng nhập.", true);
            return;
        }
        toggleLoading(loginBtn, true);
        log("Đang đăng nhập...");
        const response = await backendRequest('login', { username, password });
        if (response && response.success) {
            authToken = response.body.token;
            log("✅ Đăng nhập thành công! Đang lấy thông tin...");
            await getInitialData();
        } else {
            log(`❌ Đăng nhập thất bại: ${response.message}`, true);
        }
        toggleLoading(loginBtn, false);
    };

    const getInitialData = async () => {
        const response = await backendRequest('getInitialData');
        if (response && response.success) {
            const { profile, dot } = response;
            dotId = dot.id;
            userNameSpan.textContent = profile.hoDem + ' ' + profile.ten;
            userCodeSpan.textContent = profile.maSv;
            dotNameSpan.textContent = `${dot.tenDot} (${dot.namHoc.ten})`
            userInfoDiv.classList.remove('hidden');
            loginForm.classList.add('hidden');
            registrationControls.classList.remove('hidden');
            log("✅ Lấy thông tin người dùng và đợt đăng ký thành công.");
            await getRegisteredClasses(false);
        } else {
            log("❌ Không thể lấy thông tin người dùng.", true);
        }
    };

    const handleGetSchedule = async () => {
        if (!authToken || !dotId) {
            log("Token không hợp lệ hoặc chưa có đợt đăng ký.", true);
            return;
        }
        toggleLoading(getScheduleBtn, true);
        log("Đang tải thời khóa biểu toàn trường...");
        const fetchPrerequisites = prerequisiteToggle.checked;
        const response = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites });
        
        if (response && response.success) {
            allScheduleData = response.schedule;
            allSubjects = {};
            
            allScheduleData.forEach(cls => {
                if (!allSubjects[cls.maHocPhan]) {
                    allSubjects[cls.maHocPhan] = {
                        tenMon: cls.tenMon,
                        isBatBuoc: response.subjectTypes[cls.maHocPhan]
                    };
                }
            });

            populateSubjectFilter();
            renderScheduleTable();
            log(`✅ Tải thành công ${allScheduleData.length} lớp học phần.`);
        } else {
            log(`❌ Lỗi khi tải TKB: ${response.message}`, true);
            scheduleContainer.innerHTML = `<p class="text-red-500 text-center py-8">Lỗi khi tải dữ liệu. Vui lòng thử lại.</p>`;
        }
        toggleLoading(getScheduleBtn, false);
    };
    
    const getRegisteredClasses = async (showLog = true) => {
        if (!authToken || !dotId) {
            if (showLog) log("Chưa đăng nhập hoặc không tìm thấy đợt đăng ký.", true);
            return;
        }
        toggleLoading(refreshRegisteredBtn, true);
        if (showLog) log("Đang cập nhật danh sách lớp đã đăng ký...");
        const fetchPrerequisites = prerequisiteToggle.checked; // Lấy cả lớp tiên quyết nếu được check
        const response = await backendRequest('getRegisteredClasses', { dotId, fetchPrerequisites });
        
        if (response && response.success) {
            renderRegisteredTable(response.body);
            registeredClassIds = new Set(response.body.map(cls => cls.idLopHocPhan.toString()));
             if (showLog) log(`✅ Cập nhật thành công ${response.body.length} lớp đã đăng ký.`);
        } else {
             if (showLog) log(`❌ Lỗi khi lấy danh sách lớp đã đăng ký: ${response.message}`, true);
        }
        toggleLoading(refreshRegisteredBtn, false);
    };

    // --- RENDERING FUNCTIONS ---
    function populateSubjectFilter() {
        subjectFilter.innerHTML = '<option value="all">Tất cả môn</option>';
        const sortedSubjects = Object.entries(allSubjects).sort(([, a], [, b]) => a.tenMon.localeCompare(b.tenMon));
        
        sortedSubjects.forEach(([maHocPhan, { tenMon, isBatBuoc }]) => {
            const option = document.createElement('option');
            option.value = maHocPhan;
            option.textContent = `${isBatBuoc ? '[BB] ' : ''}${tenMon} (${maHocPhan})`;
            subjectFilter.appendChild(option);
        });
    }

    function renderScheduleTable() {
        const searchTerm = searchInput.value.toLowerCase();
        const selectedSubject = subjectFilter.value;

        const filteredData = allScheduleData.filter(cls => {
            const subjectMatch = selectedSubject === 'all' || cls.maHocPhan === selectedSubject;
            const searchMatch = searchTerm === '' ||
                cls.tenMon.toLowerCase().includes(searchTerm) ||
                cls.maHocPhan.toLowerCase().includes(searchTerm) ||
                cls.maLopHocPhan.toLowerCase().includes(searchTerm) ||
                (cls.ghiChu && cls.ghiChu.toLowerCase().includes(searchTerm));
            return subjectMatch && searchMatch;
        });

        if (filteredData.length === 0) {
            scheduleContainer.innerHTML = `<p class="text-gray-500 text-center py-8">Không tìm thấy lớp học phần nào.</p>`;
            return;
        }

        const tableHTML = `
            <table class="min-w-full bg-white divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mã Lớp</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tên Môn</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trạng thái</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lịch học</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ghi chú</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    ${filteredData.map(cls => {
                        const isSelected = selectedClasses.has(cls.id.toString());
                        const schedule = cls.scheduleDetails && !cls.scheduleDetails.error ?
                            cls.scheduleDetails.map(s => `<li>${s.thu} (T${s.tietBatDau}-${s.tietKetThuc}) tại ${s.tenPhong}</li>`).join('') :
                            '<li class="text-red-500">Lỗi tải lịch</li>';
                        return `
                            <tr data-class-id="${cls.id}" class="cursor-pointer hover:bg-gray-100 ${isSelected ? 'bg-yellow-200' : ''}">
                                <td class="px-4 py-3 whitespace-nowrap"><div class="text-sm font-semibold text-gray-900">${cls.maLopHocPhan}</div><div class="text-xs text-gray-500">${cls.maHocPhan}</div></td>
                                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${cls.tenMon}</td>
                                <td class="px-4 py-3 whitespace-nowrap"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${cls.soLuongCon > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${cls.soLuongCon}/${cls.soLuongMax}</span></td>
                                <td class="px-4 py-3 text-sm text-gray-600"><ul class="list-disc list-inside">${schedule}</ul></td>
                                <td class="px-4 py-3 whitespace-normal text-xs text-gray-500">${cls.ghiChu || ''} ${cls.source === 'dkhpdk' ? '<span class="font-bold text-blue-600">[TQ]</span>' : ''}</td>
                            </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
        scheduleContainer.innerHTML = tableHTML;
    }
    
    function renderRegisteredTable(data) {
        if (!data || data.length === 0) {
            registeredContainer.innerHTML = `<p class="text-gray-500 text-center py-8">Bạn chưa đăng ký lớp học phần nào.</p>`;
            return;
        }

        const tableHTML = `
            <table class="min-w-full bg-white divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mã Lớp</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tên Môn</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lịch học</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Hủy</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    ${data.map(reg => {
                        const schedule = reg.scheduleDetails && !reg.scheduleDetails.error ?
                           reg.scheduleDetails.map(s => `<li>${s.thu} (T${s.tietBatDau}-${s.tietKetThuc}) tại ${s.tenPhong}</li>`).join('') :
                           '<li class="text-red-500">Lỗi tải lịch</li>';
                        return `
                            <tr>
                                <td class="px-4 py-3 whitespace-nowrap"><div class="text-sm font-semibold text-gray-900">${reg.maLopHocPhan}</div><div class="text-xs text-gray-500">${reg.maHocPhan}</div></td>
                                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${reg.tenMon}</td>
                                <td class="px-4 py-3 text-sm text-gray-600"><ul class="list-disc list-inside">${schedule}</ul></td>
                                <td class="px-4 py-3 whitespace-nowrap text-sm font-medium">
                                    <button class="cancel-btn text-red-600 hover:text-red-900" data-reg-id="${reg.id}" data-ten-mon="${reg.tenMon}" data-source="${reg.source}">Hủy</button>
                                </td>
                            </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
        registeredContainer.innerHTML = tableHTML;
    }

    function updateSelectedList() {
        if (selectedClasses.size === 0) {
            selectedList.innerHTML = `<p class="text-gray-500">Chưa chọn lớp nào.</p>`;
            return;
        }
        selectedList.innerHTML = Array.from(selectedClasses.values()).map(cls => `
            <div class="flex justify-between items-center bg-white p-1 rounded">
                <span>${cls.maLopHocPhan} - ${cls.tenMon}</span>
                <button class="remove-selected-btn text-red-500 hover:text-red-700 font-bold" data-class-id="${cls.id}">&times;</button>
            </div>
        `).join('');
    }

    // --- REGISTRATION PROCESS ---
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function* insertionGenerator() {
        while (isProcessRunning) {
            for (const cls of selectedClasses.values()) {
                if (!isProcessRunning) return;
                yield cls;
            }
        }
    }

    async function* registrationGenerator() {
        while (isProcessRunning) {
            for (const cls of selectedClasses.values()) {
                if (!isProcessRunning) return;
                log(`>> Thử đăng ký lớp ${cls.maLopHocPhan} - ${cls.tenMon}...`);
                const res = await backendRequest('register', { classId: cls.id, source: cls.source });
                if (res && res.success) {
                    log(`✅✅✅ ĐĂNG KÝ THÀNH CÔNG: ${cls.tenMon}. Đang cập nhật danh sách...`);
                    await getRegisteredClasses(false);
                } else {
                    log(`-- Thất bại: ${res.message}`, true);
                }
                if (!isProcessRunning) return; // Check again after await
                await delay(parseInt(delayInput.value, 10));
            }
        }
    }

    const startProcess = async (mode) => {
        if (selectedClasses.size === 0) {
            log("Vui lòng chọn ít nhất một lớp để đăng ký.", true);
            return;
        }
        isProcessRunning = true;
        log(`Bắt đầu quá trình đăng ký (chế độ: ${mode})...`);
        const generator = mode === 'xenke' ? insertionGenerator() : registrationGenerator();
        
        for await (const cls of generator) {
            if (!isProcessRunning) break;
             if (mode === 'xenke') {
                log(`>> Thử đăng ký lớp ${cls.maLopHocPhan} - ${cls.tenMon}...`);
                const res = await backendRequest('register', { classId: cls.id, source: cls.source });
                 if (res && res.success) {
                    log(`✅✅✅ ĐĂNG KÝ THÀNH CÔNG: ${cls.tenMon}. Đang cập nhật danh sách...`);
                    await getRegisteredClasses(false);
                } else {
                    log(`-- Thất bại: ${res.message}`, true);
                }
            }
             if (!isProcessRunning) break; // Check again after await
             await delay(parseInt(delayInput.value, 10));
        }
         if(isProcessRunning) { // If loop finished naturally
            log("Hoàn tất chu trình đăng ký.");
        }
    };
    
    const stopProcess = () => {
        if (isProcessRunning) {
            isProcessRunning = false;
            log("Đã dừng quá trình đăng ký.");
        }
    };

    const handleCancelRegistration = async (e) => {
        const button = e.target.closest('.cancel-btn');
        if (!button) return;
        
        const { regId, tenMon, source } = button.dataset;
        if (confirm(`Bạn có chắc chắn muốn hủy đăng ký môn "${tenMon}" không?`)) {
            log(`Đang hủy đăng ký môn ${tenMon}...`);
            const response = await backendRequest('cancel', { registrationId: regId, source: source });
            if (response && response.success) {
                log(`✅ Hủy thành công môn ${tenMon}.`);
                await getRegisteredClasses();
            } else {
                log(`❌ Lỗi khi hủy đăng ký: ${response.message}`, true);
            }
        }
    };

    // --- EVENT LISTENERS ---
    loginBtn.addEventListener('click', handleLogin);
    getScheduleBtn.addEventListener('click', handleGetSchedule);
    refreshRegisteredBtn.addEventListener('click', () => getRegisteredClasses(true));
    registeredContainer.addEventListener('click', handleCancelRegistration);
    startInsertionBtn.addEventListener('click', () => startProcess('xenke'));
    startRegistrationBtn.addEventListener('click', () => startProcess('lientuc'));
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
    });

    // === VNPAY PAYMENT LOGIC ===
    const amountInput = document.getElementById('amount-input');
    const vnpayPaymentBtn = document.getElementById('vnpay-payment-btn');

    const handleVnpayPayment = async () => {
        const amount = parseInt(amountInput.value, 10);
        if (isNaN(amount) || amount < 1000) {
            log("Vui lòng nhập số tiền hợp lệ (tối thiểu 1,000 VND).", true);
            return;
        }

        log(`🚀 Đang tạo yêu cầu thanh toán VNPAY cho ${amount.toLocaleString('vi-VN')} VND...`);
        toggleLoading(vnpayPaymentBtn, true);

        const paymentRes = await backendRequest('create_payment_url', {
            amount: amount,
            orderInfo: `Ung ho phat trien tool ${amount.toLocaleString('vi-VN')} VND`
        });

        if (paymentRes && paymentRes.success && paymentRes.paymentUrl) {
            log("✅ Tạo yêu cầu thành công! Đang chuyển hướng đến VNPAY...");
            window.location.href = paymentRes.paymentUrl; // Chuyển hướng người dùng
        } else {
            log(`❌ Lỗi khi tạo yêu cầu thanh toán: ${paymentRes?.message || 'Không rõ'}`, true);
            toggleLoading(vnpayPaymentBtn, false);
        }
    };

    if (vnpayPaymentBtn) {
      vnpayPaymentBtn.originalHTML = vnpayPaymentBtn.innerHTML;
      vnpayPaymentBtn.addEventListener('click', handleVnpayPayment);
    }
});