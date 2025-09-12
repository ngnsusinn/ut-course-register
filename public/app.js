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
    const logoutBtn = document.getElementById('logout-btn');
    const fetchBtn = document.getElementById('fetch-schedule-btn');
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
    const userPanel = document.getElementById('user-panel');
    const greetingMsg = document.getElementById('greeting-msg');

    // State
    let authToken = null;
    let dotId = null;
    let allScheduleData = [];
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;

    // === SINGLE BACKEND COMMUNICATION FUNCTION ===
    const backendRequest = async (action, payload = {}) => {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const response = await fetch('/api/handler', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ action, payload })
            });

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

    [loginBtn, fetchBtn, startInsertionBtn, startRegistrationBtn, stopBtn, refreshRegisteredBtn, logoutBtn].forEach(btn => {
        if (btn) btn.originalHTML = btn.innerHTML;
    });
    
    const formatScheduleDetail = (details) => {
        if (!details || details.error || !Array.isArray(details) || details.length === 0) {
            return 'Không có thông tin lịch học';
        }
        return details.map(d => `Thứ ${d.thu} | Tiết ${d.tietHoc} | ${new Date(d.ngayBatDau).toLocaleDateString('vi-VN')} - ${new Date(d.ngayKetThuc).toLocaleDateString('vi-VN')}`).join('<br>');
    };
    
    // --- UI UPDATE FUNCTIONS ---
    const updateUIAfterLogin = (profile) => {
        loginForm.classList.add('hidden');
        userPanel.classList.remove('hidden');
        greetingMsg.textContent = `Xin chào, ${profile.hoDem} ${profile.ten}!`;
    };
    
    const resetUI = () => {
        loginForm.classList.remove('hidden');
        userPanel.classList.add('hidden');
        scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập để xem dữ liệu.</p>';
        registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có dữ liệu.</p>';
        logOutput.innerHTML = '';
        subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>';
        searchInput.value = '';
        allScheduleData = [];
        selectedClasses.clear();
        updateSelectedList();
    };

    // --- CORE LOGIC FUNCTIONS ---
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
            log("✅ Đăng nhập thành công, đang lấy dữ liệu ban đầu...");
            
            const initialData = await backendRequest('getInitialData');
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                updateUIAfterLogin(initialData.profile);
                await fetchRegisteredClasses();
            } else {
                 log(`❌ Lỗi lấy dữ liệu ban đầu: ${initialData?.message || 'Không rõ'}`, true);
                 authToken = null; // Reset token if failed
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
        resetUI();
        log("Đã đăng xuất.");
    };

    const fetchFullSchedule = async () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        toggleLoading(fetchBtn, true);
        isProcessStopped = false;
        log("♻️ Bắt đầu lấy toàn bộ lịch học từ server...");
        
        const fetchPrerequisites = document.getElementById('prerequisite-toggle')?.checked || false;
        const scheduleRes = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites });

        if (scheduleRes && scheduleRes.success) {
            allScheduleData = scheduleRes.schedule;
            subjectTypeMap = new Map(Object.entries(scheduleRes.subjectTypes));
            log(`✅ Đã tải thành công ${allScheduleData.length} lớp học phần.`);
            await renderScheduleTable();
        } else {
            log("❌ Lỗi khi tải lịch học từ server.", true);
        }
        toggleLoading(fetchBtn, false);
    };

    const fetchRegisteredClasses = async () => {
        if (!authToken) return;
        toggleLoading(refreshRegisteredBtn, true);
        const fetchPrerequisites = document.getElementById('prerequisite-toggle')?.checked || false;
        
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
                            await Promise.all([fetchRegisteredClasses(), updateSelectedList()]);
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
                        await Promise.all([fetchRegisteredClasses(), updateSelectedList()]);
                        if (registrationIntervals.size === 0) await stopProcess();
                        return;
                    } else if (result) {
                        log(`❌ [${tenMonHoc}] Thất bại: ${result.message}`, true);
                        if (result.message === "Không thể đăng ký do trùng lịch") {
                           // Có thể thêm logic xử lý trùng lịch ở đây nếu cần
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
        startInsertionBtn.classList.toggle('hidden', isProcessing);
        startRegistrationBtn.classList.toggle('hidden', isProcessing);
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

        const filteredData = allScheduleData.filter(cls => 
            (!selectedSubject || cls.tenMonHoc === selectedSubject) &&
            (`${cls.tenMonHoc} ${cls.maLopHocPhan}`.toLowerCase().includes(query))
        );

        if (filteredData.length === 0) {
            scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Không tìm thấy lớp học phần nào.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10">
                <tr>
                    <th scope="col" class="px-6 py-3">Tên môn & Lịch học</th>
                    <th scope="col" class="px-6 py-3">Mã LHP</th>
                    <th scope="col" class="px-6 py-3">Loại HP</th>
                    <th scope="col" class="px-6 py-3">Trạng thái</th>
                    <th scope="col" class="px-6 py-3">Đã ĐK</th>
                </tr>
            </thead>
            <tbody>
            ${filteredData.map(cls => {
                const isSelected = selectedClasses.has(cls.id.toString());
                const isBatBuoc = subjectTypeMap.get(cls.maHocPhan);
                const typeHtml = cls.source === 'dkhpdk' ? '' : isBatBuoc 
                    ? `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-green-200 text-green-800">Bắt buộc</span>`
                    : `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-red-200 text-red-800">Tự chọn</span>`;
                const sourceBadge = cls.source === 'dkhpdk' ? `<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-purple-200 text-purple-800">ĐK</span>` : '';

                return `
                <tr class="bg-white border-b hover:bg-sky-100 cursor-pointer ${isSelected ? 'bg-yellow-200' : ''}" data-class-id="${cls.id}">
                    <th scope="row" class="px-6 py-4 font-medium text-gray-900">
                        ${cls.tenMonHoc} ${sourceBadge}
                        <div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(cls.scheduleDetails)}</div>
                    </th>
                    <td class="px-6 py-4" data-label="Mã LHP">${cls.maLopHocPhan}</td>
                    <td class="px-6 py-4" data-label="Loại HP">${typeHtml}</td>
                    <td class="px-6 py-4" data-label="Trạng thái">${cls.tenTrangThai || 'N/A'}</td>
                    <td class="px-6 py-4 font-semibold ${cls.phanTramDangKy >= 100 ? 'text-red-500' : 'text-green-500'}" data-label="Đã ĐK">${cls.phanTramDangKy}%</td>
                </tr>`;
            }).join('')}
            </tbody>
        `;
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
            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10">
                <tr>
                    <th scope="col" class="px-6 py-3">Tên môn & Lịch học</th>
                    <th scope="col" class="px-6 py-3">Mã LHP</th>
                    <th scope="col" class="px-6 py-3">Trạng thái</th>
                    <th scope="col" class="px-6 py-3">Hành động</th>
                </tr>
            </thead>
            <tbody>
            ${data.map(reg => `
                <tr class="bg-white border-b hover:bg-gray-50">
                    <th scope="row" class="px-6 py-4 font-medium text-gray-900">
                        ${reg.tenMonHoc}
                        <div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(reg.scheduleDetails)}</div>
                    </th>
                    <td class="px-6 py-4" data-label="Mã LHP">${reg.maLopHocPhan}</td>
                    <td class="px-6 py-4" data-label="Trạng thái">${reg.tenTrangThaiLopHocPhan || 'N/A'}</td>
                    <td class="px-6 py-4" data-label="Hành động">
                        <button data-reg-id="${reg.id}" data-ten-mon="${reg.tenMonHoc}" data-source="${reg.source}" class="font-medium text-red-600 hover:underline cancel-btn">Hủy</button>
                    </td>
                </tr>
            `).join('')}
            </tbody>
        `;
        registeredContainer.innerHTML = '';
        registeredContainer.appendChild(table);
    };

    const updateSelectedList = async () => {
        if (selectedClasses.size === 0) {
            selectedList.innerHTML = `<p class="text-gray-500">Chưa có lớp nào được chọn.</p>`;
            registrationControls.classList.add('hidden');
            return;
        }
        selectedList.innerHTML = [...selectedClasses.values()].map(cls => `
            <div class="flex justify-between items-center bg-blue-50 p-2 rounded-md hover:bg-blue-100">
                <p class="font-semibold text-sm text-blue-800">${cls.tenMonHoc} (${cls.maLopHocPhan})</p>
                <button data-class-id="${cls.id}" class="remove-selected-btn text-red-500 hover:text-red-700 ml-2">&times;</button>
            </div>
        `).join('');
        registrationControls.classList.remove('hidden');
    };

    // --- EVENT LISTENERS ---
    loginBtn.addEventListener('click', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    fetchBtn.addEventListener('click', fetchFullSchedule);
    refreshRegisteredBtn.addEventListener('click', fetchRegisteredClasses);
    startInsertionBtn.addEventListener('click', startInsertion);
    startRegistrationBtn.addEventListener('click', startRegistration);
    stopBtn.addEventListener('click', stopProcess);
    
    searchInput.addEventListener('input', () => renderScheduleTable());
    subjectFilter.addEventListener('change', () => renderScheduleTable());
    
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    document.addEventListener('click', (e) => {
        // Handle schedule row selection
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow) {
            const classId = scheduleRow.dataset.classId;
            const cls = allScheduleData.find(c => c.id.toString() === classId);
            if (!cls) return;

            if (selectedClasses.has(classId)) {
                selectedClasses.delete(classId);
            } else {
                selectedClasses.set(classId, cls);
            }
            scheduleRow.classList.toggle('bg-yellow-200');
            updateSelectedList();
        }

        // Handle remove from selected list
        const removeBtn = e.target.closest('.remove-selected-btn');
        if (removeBtn) {
            const classId = removeBtn.dataset.classId;
            selectedClasses.delete(classId);
            const scheduleRowToUpdate = document.querySelector(`#schedule-container tr[data-class-id='${classId}']`);
            if (scheduleRowToUpdate) scheduleRowToUpdate.classList.remove('bg-yellow-200');
            updateSelectedList();
        }
        
        // Handle cancel registration
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const { regId, tenMon, source } = cancelBtn.dataset;
            cancelRegistration(regId, tenMon, source);
        }
    });
});