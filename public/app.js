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
    let userPanel, greetingMsg, prerequisiteToggle, fetchBtn, logoutBtn, progressBarContainer, progressBarElement, progressBarText, skipLockedToggle;

    // State
    let authToken = null;
    let dotId = null;
    let allScheduleData = [];
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;

    // Helper function to remove diacritics and normalize
    function removeDiacritics(str) {
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    }

    // === SINGLE BACKEND COMMUNICATION FUNCTION ===
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
    
    // --- UI UPDATE FUNCTIONS ---
    const updateUIAfterLogin = (profile) => {
        loginForm.style.display = 'none';
        
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
				<div id="skip-locked-toggle-container" class="flex items-center justify-center my-3">
    <label for="skip-locked-toggle" class="flex items-center cursor-pointer">
        <div class="relative">
            <input type="checkbox" id="skip-locked-toggle" class="sr-only">
            <div class="block bg-gray-600 w-14 h-8 rounded-full"></div>
            <div class="dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition"></div>
        </div>
        <div class="ml-3 text-gray-700 font-medium">Bỏ qua lớp đã khoá</div>
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
            greetingMsg = document.getElementById('greeting-msg');
            prerequisiteToggle = document.getElementById('prerequisite-toggle');
			skipLockedToggle = document.getElementById('skip-locked-toggle');
            skipLockedToggle.addEventListener('change', () => {
                console.log('Toggle changed to:', skipLockedToggle.checked);
                renderScheduleTable();
            });

            fetchBtn = document.getElementById('fetch-schedule-btn');
            logoutBtn = document.getElementById('logout-btn');
            progressBarContainer = document.getElementById('progress-bar-container');
            progressBarElement = document.getElementById('progress-bar-element');
            progressBarText = document.getElementById('progress-bar-text');

            // Add event listeners
            fetchBtn.originalHTML = fetchBtn.innerHTML;
            logoutBtn.originalHTML = logoutBtn.innerHTML;
            fetchBtn.addEventListener('click', fetchFullSchedule);
            logoutBtn.addEventListener('click', handleLogout);
        }
        
        greetingMsg.textContent = `Xin chào, ${profile.hoDem} ${profile.ten}!`;
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
            log("✅ Đăng nhập thành công.");
            const initialData = await backendRequest('getInitialData');
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                updateUIAfterLogin(initialData.profile);
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
        resetUI();
        log("Đã đăng xuất.");
    };

    const fetchFullSchedule = async () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        toggleLoading(fetchBtn, true);
        isProcessStopped = false;
        log("♻️ Bắt đầu lấy toàn bộ lịch học từ server...");
        
        const fetchPrerequisites = prerequisiteToggle?.checked || false;
        const scheduleRes = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites });

        if (scheduleRes && scheduleRes.success) {
            allScheduleData = scheduleRes.schedule;
            subjectTypeMap = new Map(Object.entries(scheduleRes.subjectTypes));
            console.log('Fetched allScheduleData:', allScheduleData); // Debug: Kiểm tra dữ liệu lịch học
            log(`✅ Đã tải thành công ${allScheduleData.length} lớp học phần.`);
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
        startInsertionBtn.classList.toggle('hidden', isProcessing);
        startRegistrationBtn.classList.toggle('hidden', isProcessing);
        stopBtn.classList.toggle('hidden', !isProcessing);
    };
    
    // --- RENDER FUNCTIONS ---
    const renderScheduleTable = async () => {
        const query = searchInput.value.toLowerCase();
        let selectedSubject = subjectFilter.value;

        // Debug unique statuses
        const uniqueStatuses = [...new Set(allScheduleData.map(cls => cls.tenTrangThai || 'N/A'))];
        const uniqueNormalizedStatuses = [...new Set(allScheduleData.map(cls => removeDiacritics(cls.tenTrangThai || 'N/A')))];
        console.log('Unique tenTrangThai (original):', uniqueStatuses);
        console.log('Unique tenTrangThai (normalized):', uniqueNormalizedStatuses);

        // Count locked classes
        const lockedClasses = allScheduleData.filter(cls => removeDiacritics(cls.tenTrangThai || '').includes('da khoa lop')).length;
        console.log('Number of locked classes:', lockedClasses);

        const preFilteredData = allScheduleData.filter(cls => 
            (`${removeDiacritics(cls.tenMonHoc)} ${cls.maLopHocPhan} ${cls.maHocPhan}`.toLowerCase().includes(query)) &&
            (!(skipLockedToggle?.checked) || !removeDiacritics(cls.tenTrangThai || '').includes('da khoa lop'))
        );

        console.log('preFilteredData length:', preFilteredData.length); // Debug: Kiểm tra số lượng dữ liệu sau lọc

        const subjects = [...new Set(preFilteredData.map(cls => cls.tenMonHoc))].sort();
        subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>' + subjects.map(s => `<option value="${s}" ${s === selectedSubject ? 'selected' : ''}>${s}</option>`).join('');

        // Reset selectedSubject if it's no longer available
        if (selectedSubject && !subjects.includes(selectedSubject)) {
            selectedSubject = '';
            subjectFilter.value = '';
        }

        const filteredData = preFilteredData.filter(cls => 
            (!selectedSubject || cls.tenMonHoc === selectedSubject)
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
            </div>`
        }).join('');
        registrationControls.classList.remove('hidden');
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