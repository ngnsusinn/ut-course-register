document.addEventListener('DOMContentLoaded', () => {
    // === DEBUG MODE ===
    let DEBUG_MODE = false; // Bật/tắt debug mode bằng nút góc phải

    // CSS phụ trợ
    const style = document.createElement('style');
    style.innerHTML = `
        input:checked~.dot{transform:translateX(100%);background-color:#48bb78}
        input:checked~.block{background-color:#a7f3d0}
        .toggle-label{transition:all 0.3s ease}
        .toggle-on .toggle-label{color:#10b981!important;font-weight:600!important}
        .toggle-off .toggle-label{color:#6b7280!important;font-weight:400!important}
        .debug-toggle{position:fixed;top:10px;right:10px;z-index:1000;background:rgba(0,0,0,0.8);color:white;padding:5px 10px;border-radius:5px;font-size:12px;cursor:pointer}
        .retry-schedule-btn{transition:all 0.2s ease;font-size:11px;padding:2px 6px;margin-top:4px;border:none;border-radius:4px;cursor:pointer}
        .retry-schedule-btn:hover{transform:scale(1.05)}
        .retry-schedule-btn:disabled{opacity:0.5;cursor:not-allowed}
    `;
    document.head.appendChild(style);

    // DOM
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

    // Dynamic holders
    let greetingMsg, prerequisiteToggle, fetchBtn, logoutBtn, progressBarContainer, progressBarElement, progressBarText;

    // State
    let authToken = null;
    let dotId = null;
    let allScheduleData = [];
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;

    // Debug toggle button
    const debugToggle = document.createElement('div');
    debugToggle.className = 'debug-toggle';
    debugToggle.textContent = `DEBUG: ${DEBUG_MODE ? 'ON' : 'OFF'}`;
    debugToggle.onclick = () => {
        DEBUG_MODE = !DEBUG_MODE;
        debugToggle.textContent = `DEBUG: ${DEBUG_MODE ? 'ON' : 'OFF'}`;
        log(`🔧 Debug mode: ${DEBUG_MODE ? 'ON' : 'OFF'}`);
    };
    document.body.appendChild(debugToggle);

    // Debug logger
    const debugLog = (message, data = null) => {
        if (DEBUG_MODE) {
            log(`🔧 DEBUG: ${message}${data ? ` | Data: ${JSON.stringify(data)}` : ''}`, false);
        }
    };

    // Backend request helper
    const backendRequest = async (action, payload = {}, retries = 2) => {
        debugLog(`Backend request: ${action}`, payload);
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
                const response = await fetch('/api/handler', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ action, payload }),
                    timeout: 30000
                });
                if (!response.ok) {
                    if (response.status === 429 && attempt < retries) {
                        log(`Rate limited, retrying in ${attempt * 2} seconds...`);
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    const err = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
                    log(`Lỗi '${action}': ${err.message}`, true);
                    return null;
                }
                const json = await response.json();
                debugLog(`Backend response for ${action}:`, { success: json.success, dataSize: json.schedule?.length || json.body?.length || 'N/A' });
                return json;
            } catch (e) {
                debugLog(`Network error attempt ${attempt}: ${e.message}`);
                if (attempt === retries) {
                    log(`Lỗi mạng khi gọi backend: ${e.message}`, true);
                    return null;
                }
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    };

    // UI log
    const log = (message, isError = false) => {
        const timestamp = new Date().toLocaleTimeString();
        const p = document.createElement('p');
        p.innerHTML = `[${timestamp}] ${message}`;
        p.className = isError ? 'text-red-400' : 'text-green-300';
        logOutput.appendChild(p);
        logOutput.scrollTop = logOutput.scrollHeight;
        while (logOutput.children.length > 150) logOutput.removeChild(logOutput.firstChild);
    };

    // Button loading
    const toggleLoading = (btn, isLoading) => {
        if (!btn) return;
        if (isLoading) {
            btn.disabled = true;
            btn.innerHTML = `<div class="loader"></div>`;
        } else {
            btn.disabled = false;
            btn.innerHTML = btn.originalHTML || btn.textContent;
        }
    };
    [loginBtn, startInsertionBtn, startRegistrationBtn, stopBtn, refreshRegisteredBtn].forEach(b => b && (b.originalHTML = b.innerHTML));

    // Format schedule
    const formatScheduleDetail = (details, className = '') => {
        if (!details) {
            debugLog(`No details for ${className}`);
            return `<span class="text-red-500">Không thể tải lịch học</span>`;
        }
        if (details.error) {
            debugLog(`Schedule error ${className}: ${details.message}`);
            if (details.status === 403) return `<span class="text-red-500">Bị chặn truy cập (403)</span>`;
            return `<span class="text-red-500">Lỗi: ${details.message}</span>`;
        }
        if (!Array.isArray(details)) {
            debugLog(`Invalid schedule type ${className}`);
            return `<span class="text-orange-500">Dữ liệu lịch học không hợp lệ</span>`;
        }
        if (details.length === 0) {
            debugLog(`Empty schedule ${className}`);
            return `<span class="text-yellow-600">Chưa có lịch học được công bố</span>`;
        }
        try {
            return details.map(d => {
                if (!d.thu || !d.tietHoc) return `<div class="font-medium text-orange-500">Thông tin lịch không đầy đủ</div>`;
                const startDate = d.ngayBatDau ? new Date(d.ngayBatDau).toLocaleDateString('vi-VN') : 'N/A';
                const endDate = d.ngayKetThuc ? new Date(d.ngayKetThuc).toLocaleDateString('vi-VN') : 'N/A';
                const room = d.phongHoc || d.phong || '';
                const teacher = d.tenGiangVien ? ` | GV: ${d.tenGiangVien}` : '';
                return `<div class="font-medium">Thứ ${d.thu} | Tiết ${d.tietHoc} | ${startDate} - ${endDate}${room ? ` | ${room}` : ''}${teacher}</div>`;
            }).join('<hr class="my-1 border-gray-200">');
        } catch (err) {
            debugLog(`Format error ${className}: ${err.message}`);
            return `<span class="text-red-500">Lỗi hiển thị lịch học</span>`;
        }
    };

    const formatSelectedClassDetail = (cls, details) => {
        if (!details || details.error) return `<span class="text-red-500">Không tải được lịch</span>`;
        if (!Array.isArray(details) || details.length === 0) return '<span>Chưa có thông tin lịch học</span>';
        return details.map(d => `<span>${cls.maLopHocPhan} | Thứ ${d.thu} | Tiết ${d.tietHoc}</span>`).join('<br>');
    };

    // Retry one class
    const retryClassSchedule = async (classId, className, btn) => {
        if (!authToken) return;
        log(`🔄 Đang thử lại lấy lịch học cho lớp ${className}...`);
        if (btn) {
            btn.innerHTML = '⏳ Loading...';
            btn.disabled = true;
            btn.style.opacity = '0.5';
        }
        try {
            const result = await backendRequest('getClassSchedule', { classId }, 3);
            if (result && result.success) {
                const details = result.scheduleDetails || [];
                const idx = allScheduleData.findIndex(c => c.id.toString() === classId);
                if (idx !== -1) {
                    allScheduleData[idx].scheduleDetails = details;
                    await renderScheduleTable();
                    if (details.length > 0) {
                        log(`✅ Đã tải lại lịch học cho ${className}`);
                        if (btn) {
                            btn.innerHTML = '✅ Thành công';
                            btn.style.backgroundColor = '#10b981';
                            setTimeout(() => btn.style.display = 'none', 1500);
                        }
                    } else {
                        log(`⚠️ Lớp ${className} không có lịch học (có thể chưa phân công)`);
                        if (btn) {
                            btn.innerHTML = '⚠️ Không có lịch';
                            btn.style.backgroundColor = '#f59e0b';
                        }
                    }
                }
            } else {
                const msg = result?.message || result?.error?.message || 'Unknown error';
                if (msg.includes('403')) {
                    log(`❌ ${className}: Bị chặn truy cập (403)`, true);
                    if (btn) { btn.innerHTML = '🚫 Bị chặn'; btn.style.backgroundColor = '#ef4444'; }
                } else {
                    log(`❌ Không thể tải lịch cho ${className}: ${msg}`, true);
                    if (btn) { btn.innerHTML = '❌ Thất bại'; btn.style.backgroundColor = '#ef4444'; }
                }
            }
        } catch (e) {
            log(`❌ Lỗi khi thử lại: ${e.message}`, true);
            if (btn) { btn.innerHTML = '❌ Lỗi'; btn.style.backgroundColor = '#ef4444'; }
        }
        if (btn && btn.innerHTML !== '✅ Thành công') {
            setTimeout(() => {
                btn.innerHTML = '🔄 Thử lại';
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.backgroundColor = '#3b82f6';
            }, 2500);
        }
    };

    // UI after login
    const updateUIAfterLogin = (profile) => {
        loginForm.style.display = 'none';
        if (!document.getElementById('user-panel-content')) {
            const panel = document.createElement('div');
            panel.id = 'user-panel-content';
            panel.className = 'space-y-4';
            panel.innerHTML = `
                <div id="greeting-msg" class="mt-4 text-lg font-semibold text-blue-700"></div>
                <div id="prerequisite-toggle-container" class="flex items-center justify-center my-3">
                    <label for="prerequisite-toggle" class="flex items-center cursor-pointer toggle-off" id="toggle-label">
                        <div class="relative">
                            <input type="checkbox" id="prerequisite-toggle" class="sr-only">
                            <div class="block bg-gray-600 w-14 h-8 rounded-full"></div>
                            <div class="dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition"></div>
                        </div>
                        <div class="ml-3 text-gray-700 font-medium toggle-label">Lấy dữ liệu môn học điều kiện</div>
                    </label>
                </div>
                <div id="progress-bar-container" class="my-4 hidden">
                    <div class="w-full bg-gray-200 rounded-full h-2.5">
                        <div id="progress-bar-element" class="bg-blue-600 h-2.5 rounded-full" style="width: 0%"></div>
                    </div>
                    <p id="progress-bar-text" class="text-center text-sm text-gray-600 mt-1"></p>
                </div>
                <button id="fetch-schedule-btn" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-300 flex items-center justify-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM6 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>
                    <span>Lấy dữ liệu</span>
                </button>
                <button id="logout-btn" class="w-full bg-gray-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 transition duration-300">Đăng xuất</button>
            `;
            loginForm.parentNode.insertBefore(panel, loginForm.nextSibling);

            greetingMsg = document.getElementById('greeting-msg');
            prerequisiteToggle = document.getElementById('prerequisite-toggle');
            fetchBtn = document.getElementById('fetch-schedule-btn');
            logoutBtn = document.getElementById('logout-btn');
            progressBarContainer = document.getElementById('progress-bar-container');
            progressBarElement = document.getElementById('progress-bar-element');
            progressBarText = document.getElementById('progress-bar-text');

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
        if (current === -1) { progressBarContainer.classList.add('hidden'); return; }
        progressBarContainer.classList.remove('hidden');
        const pct = total > 0 ? (current / total) * 100 : 0;
        progressBarElement.style.width = `${pct}%`;
        progressBarText.textContent = message || '';
    };

    // Core actions
    const handleLogin = async () => {
        toggleLoading(loginBtn, true);
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        if (!username || !password) { log("Vui lòng nhập tên đăng nhập và mật khẩu.", true); toggleLoading(loginBtn, false); return; }
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
        if (fetchBtn.disabled) return;

        toggleLoading(fetchBtn, true);
        isProcessStopped = false;

        const fetchPrerequisites = prerequisiteToggle?.checked || false;
        log(`♻️ Bắt đầu lấy lịch học${fetchPrerequisites ? ' (bao gồm môn điều kiện)' : ''}...`);
        debugLog('Fetching schedule with params', { dotId, fetchPrerequisites });

        const scheduleRes = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites, _forceRefresh: true });

        if (scheduleRes && scheduleRes.success) {
            allScheduleData = scheduleRes.schedule || [];
            subjectTypeMap = new Map(Object.entries(scheduleRes.subjectTypes || {}));

            const dkhp = allScheduleData.filter(c => c.source === 'dkhp').length;
            const dkhpdk = allScheduleData.filter(c => c.source === 'dkhpdk').length;
            const withSchedule = allScheduleData.filter(c => Array.isArray(c.scheduleDetails) && c.scheduleDetails.length > 0).length;
            const noSchedule = allScheduleData.length - withSchedule;

            log(`✅ Đã tải thành công ${allScheduleData.length} lớp học phần.`);
            if (fetchPrerequisites) log(`📚 Bao gồm: ${dkhp} lớp chính + ${dkhpdk} lớp điều kiện`);
            if (noSchedule > 0) log(`⚠️ ${noSchedule} lớp chưa có lịch học, ${withSchedule} lớp có lịch đầy đủ`);
            debugLog('Schedule breakdown', { total: allScheduleData.length, dkhp, dkhpdk, withSchedule, noSchedule });

            await renderScheduleTable();
        } else {
            log(`❌ Lỗi khi tải lịch học: ${scheduleRes?.message || 'Server có thể quá tải'}`, true);
        }

        updateProgressBar(-1);
        toggleLoading(fetchBtn, false);
    };

    const fetchRegisteredClasses = async () => {
        if (!authToken) return;
        toggleLoading(refreshRegisteredBtn, true);
        const fetchPrerequisites = prerequisiteToggle?.checked || false;
        const res = await backendRequest('getRegisteredClasses', { dotId, fetchPrerequisites });
        if (res && res.success) {
            log(`✅ Tải danh sách đã đăng ký thành công (${res.body.length} lớp).`);
            await renderRegisteredTable(res.body);
        } else {
            log(`❌ Lỗi khi tải danh sách đã đăng ký: ${res?.message || 'Không rõ'}`, true);
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
        const delay = Math.max(parseInt(delayInput.value, 10) || 1000, 500);

        classesBySubject.forEach((classes, maHocPhan) => {
            const tenMonHoc = classes[0].tenMonHoc || maHocPhan;
            const source = classes[0].source;
            const intervalId = setInterval(async () => {
                if (isProcessStopped) return;
                const statusRes = await backendRequest('checkClassStatus', { dotId, maHocPhan, source });
                if (!statusRes || !statusRes.success) return;
                for (const available of statusRes.body) {
                    if (selectedClasses.has(available.id.toString()) && available.phanTramDangKy < 100) {
                        log(`[${tenMonHoc}] 🔔 Phát hiện lớp còn chỗ: ${available.maLopHocPhan}`);
                        const reg = await backendRequest('register', { classId: available.id, source });
                        if (reg && reg.success) {
                            log(`🎉 [${tenMonHoc}] ĐĂNG KÝ THÀNH CÔNG!`);
                            clearInterval(registrationIntervals.get(maHocPhan));
                            registrationIntervals.delete(maHocPhan);
                            classes.forEach(c => selectedClasses.delete(c.id.toString()));
                            await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                            if (registrationIntervals.size === 0) await stopProcess();
                            return;
                        } else {
                            log(`❌ [${tenMonHoc}] Chèn thất bại: ${reg?.message || 'Lỗi'}`, true);
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
        const delay = Math.max(parseInt(delayInput.value, 10) || 1000, 500);

        classesBySubject.forEach((classes, maHocPhan) => {
            const tenMonHoc = classes[0].tenMonHoc;
            const intervalId = setInterval(async () => {
                if (isProcessStopped) return;
                for (const cls of classes) {
                    if (isProcessStopped) return;
                    log(`[${tenMonHoc}] ⏳ Gửi yêu cầu đăng ký ${cls.maLopHocPhan}...`);
                    const result = await backendRequest('register', { classId: cls.id, source: cls.source });
                    if (result && (result.success || result.message === 'Bạn đã đăng ký môn này rồi.')) {
                        log(`🎉 [${tenMonHoc}] THÀNH CÔNG!`);
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

    const toggleActionButtons = (processing) => {
        startInsertionBtn.classList.toggle('hidden', processing);
        startRegistrationBtn.classList.toggle('hidden', processing);
        stopBtn.classList.toggle('hidden', !processing);
    };

    // Render schedule
    const renderScheduleTable = async () => {
        const q = searchInput.value.toLowerCase();
        const selectedSubject = subjectFilter.value;
        if (allScheduleData.length > 0) {
            const subjects = [...new Set(allScheduleData.map(c => c.tenMonHoc))].sort();
            subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>' + subjects.map(s => `<option value="${s}" ${s === selectedSubject ? 'selected' : ''}>${s}</option>`).join('');
        }
        const data = allScheduleData.filter(c =>
            (!selectedSubject || c.tenMonHoc === selectedSubject) &&
            (`${c.tenMonHoc} ${c.maLopHocPhan} ${c.maHocPhan}`.toLowerCase().includes(q))
        );
        if (data.length === 0) {
            scheduleContainer.innerHTML = allScheduleData.length === 0
                ? '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập và nhấn "Lấy dữ liệu".</p>'
                : '<p class="text-gray-500 text-center py-8">Không tìm thấy lớp học phần nào.</p>';
            return;
        }
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-10">
                <tr>
                    <th class="px-6 py-3">Tên môn học & Lịch học</th>
                    <th class="px-6 py-3">Mã LHP</th>
                    <th class="px-6 py-3">Loại HP</th>
                    <th class="px-6 py-3">Số TC</th>
                    <th class="px-6 py-3">Trạng thái</th>
                    <th class="px-6 py-3">Đã ĐK</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        data.forEach(cls => {
            const tr = document.createElement('tr');
            const isSelected = selectedClasses.has(cls.id.toString());
            tr.className = `bg-white border-b hover:bg-sky-100 cursor-pointer ${isSelected ? 'bg-yellow-200' : ''}`;
            tr.dataset.classId = cls.id;

            const isBatBuoc = subjectTypeMap.get(cls.maHocPhan);
            const typeHtml = cls.source === 'dkhpdk'
                ? `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-purple-200 text-purple-800">Điều kiện</span>`
                : (isBatBuoc === undefined ? 'N/A' : (isBatBuoc
                    ? `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-green-200 text-green-800">Bắt buộc</span>`
                    : `<span class="text-xs font-medium px-2.5 py-0.5 rounded bg-red-200 text-red-800">Tự chọn</span>`));

            const hasErr = cls.scheduleDetails?.error || !cls.scheduleDetails || (Array.isArray(cls.scheduleDetails) && cls.scheduleDetails.length === 0);
            const schedHtml = (hasErr && DEBUG_MODE)
                ? `${formatScheduleDetail(cls.scheduleDetails, cls.maLopHocPhan)}<br><button class="retry-schedule-btn bg-blue-500 text-white hover:bg-blue-600" data-class-id="${cls.id}" data-class-name="${cls.maLopHocPhan}">🔄 Thử lại</button>`
                : formatScheduleDetail(cls.scheduleDetails, cls.maLopHocPhan);

            tr.innerHTML = `
                <th class="px-6 py-4 font-medium text-gray-900">
                    ${cls.tenMonHoc}
                    <div class="text-xs mt-1 text-gray-600">${schedHtml}</div>
                </th>
                <td class="px-6 py-4">${cls.maLopHocPhan}</td>
                <td class="px-6 py-4">${typeHtml}</td>
                <td class="px-6 py-4">${cls.soTinChi === 0 ? '' : (cls.soTinChi ?? 'N/A')}</td>
                <td class="px-6 py-4">${cls.tenTrangThai || 'N/A'}</td>
                <td class="px-6 py-4 font-semibold ${cls.phanTramDangKy >= 100 ? 'text-red-500' : 'text-green-500'}">${cls.phanTramDangKy}%</td>
            `;
            tbody.appendChild(tr);
        });
        scheduleContainer.innerHTML = '';
        scheduleContainer.appendChild(table);
    };

    // Render registered
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
                    <th class="px-6 py-3">Tên môn học & Lịch học</th>
                    <th class="px-6 py-3">Mã LHP</th>
                    <th class="px-6 py-3">Số TC</th>
                    <th class="px-6 py-3">Trạng thái</th>
                    <th class="px-6 py-3">Hành động</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        data.forEach(reg => {
            const tr = document.createElement('tr');
            tr.className = 'bg-white border-b hover:bg-gray-50';
            const badge = reg.source === 'dkhpdk' ? `<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded bg-purple-200 text-purple-800">Điều kiện</span>` : '';
            tr.innerHTML = `
                <th class="px-6 py-4 font-medium text-gray-900">
                    ${reg.tenMonHoc} ${badge}
                    <div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(reg.scheduleDetails, reg.maLopHocPhan)}</div>
                </th>
                <td class="px-6 py-4">${reg.maLopHocPhan}</td>
                <td class="px-6 py-4">${reg.soTinChi === 0 ? '' : (reg.soTinChi ?? 'N/A')}</td>
                <td class="px-6 py-4">${reg.tenTrangThaiLopHocPhan || 'N/A'}</td>
                <td class="px-6 py-4">${
                    reg.isAllowCancel === false ? '' :
                    `<button data-reg-id="${reg.id ?? ''}" data-ten-mon="${reg.tenMonHoc ?? ''}" data-source="${reg.source ?? ''}" class="font-medium text-red-600 hover:underline cancel-btn">Hủy</button>`
                }</td>
            `;
            tbody.appendChild(tr);
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
            const badge = cls.source === 'dkhpdk' ? `<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded-sm bg-purple-200 text-purple-800">ĐK</span>` : '';
            return `
                <div class="flex justify-between items-center bg-blue-50 p-2 rounded-md hover:bg-blue-100">
                    <div>
                        <p class="font-semibold text-sm text-blue-800">${cls.tenMonHoc} ${badge}</p>
                        <div class="text-xs text-gray-600 mt-1">${formatSelectedClassDetail(cls, cls.scheduleDetails)}</div>
                    </div>
                    <button data-class-id="${cls.id}" class="remove-selected-btn text-red-500 hover:text-red-700 ml-2">&times;</button>
                </div>
            `;
        }).join('');
        registrationControls.classList.remove('hidden');
    };

    // Event listeners
    loginBtn.addEventListener('click', handleLogin);
    refreshRegisteredBtn.addEventListener('click', fetchRegisteredClasses);
    startInsertionBtn.addEventListener('click', startInsertion);
    startRegistrationBtn.addEventListener('click', startRegistration);
    stopBtn.addEventListener('click', stopProcess);
    searchInput.addEventListener('input', () => renderScheduleTable());
    subjectFilter.addEventListener('change', () => renderScheduleTable());
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    // Toggle change
    document.addEventListener('change', (e) => {
        if (e.target.id === 'prerequisite-toggle') {
            const toggleLabel = document.getElementById('toggle-label');
            if (e.target.checked) {
                toggleLabel.classList.remove('toggle-off');
                toggleLabel.classList.add('toggle-on');
                log('🟢 Đã bật chế độ lấy môn học điều kiện');
            } else {
                toggleLabel.classList.remove('toggle-on');
                toggleLabel.classList.add('toggle-off');
                log('🔴 Đã tắt chế độ lấy môn học điều kiện');
            }
            allScheduleData = [];
            subjectTypeMap = new Map();
            scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Nhấn "Lấy dữ liệu" để tải lại với cài đặt mới.</p>';
            selectedClasses.clear();
            updateSelectedList();
            if (authToken) backendRequest('clearCache', { cacheType: 'schedule' });
        }
    });

    // Clicks
    document.addEventListener('click', async (e) => {
        // select schedule row
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow && !e.target.closest('.retry-schedule-btn')) {
            const classId = scheduleRow.dataset.classId;
            const cls = allScheduleData.find(c => c.id.toString() === classId);
            if (!cls) return;
            if (selectedClasses.has(classId)) selectedClasses.delete(classId);
            else selectedClasses.set(classId, cls);
            scheduleRow.classList.toggle('bg-yellow-200');
            updateSelectedList();
            return;
        }

        // retry schedule button
        const retryBtn = e.target.closest('.retry-schedule-btn');
        if (retryBtn && authToken) {
            const classId = retryBtn.dataset.classId;
            const className = retryBtn.dataset.className;
            await retryClassSchedule(classId, className, retryBtn);
            return;
        }

        // remove selected
        const removeBtn = e.target.closest('.remove-selected-btn');
        if (removeBtn) {
            const classId = removeBtn.dataset.classId;
            selectedClasses.delete(classId);
            const row = document.querySelector(`#schedule-container tr[data-class-id='${classId}']`);
            if (row) row.classList.remove('bg-yellow-200');
            updateSelectedList();
            return;
        }

        // cancel registration
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const { regId, tenMon, source } = cancelBtn.dataset;
            cancelRegistration(regId, tenMon, source);
            return;
        }
    });
});
