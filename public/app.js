document.addEventListener('DOMContentLoaded', () => {
    // Enhanced CSS với responsive design
    const style = document.createElement('style');
    style.innerHTML = `
        input:checked ~ .dot { 
            transform: translateX(100%); 
            background-color: #48bb78; 
        }
        input:checked ~ .block { 
            background-color: #a7f3d0; 
        }
        
        .loader { 
            border: 3px solid #f3f3f3; 
            border-top: 3px solid #3498db; 
            border-radius: 50%; 
            width: 20px; 
            height: 20px; 
            animation: spin 0.8s linear infinite;
            display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        /* Enhanced responsive table */
        @media screen and (max-width: 768px) {
            .responsive-table table thead { display: none; }
            .responsive-table table tr { 
                display: block; 
                margin-bottom: 1rem; 
                border: 1px solid #e2e8f0; 
                border-radius: 12px; 
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                overflow: hidden;
                background: white;
            }
            .responsive-table table th[scope="row"] { 
                display: block; 
                font-size: 1.1rem; 
                padding: 1rem; 
                background: linear-gradient(45deg, #f7fafc, #edf2f7); 
                border-bottom: 1px solid #e2e8f0;
                font-weight: 600;
            }
            .responsive-table table td { 
                display: flex; 
                justify-content: space-between; 
                align-items: center; 
                text-align: right; 
                padding: 0.75rem 1rem; 
                border-bottom: 1px solid #f7fafc;
            }
            .responsive-table table td:last-child { border-bottom: none; }
            .responsive-table table td::before { 
                content: attr(data-label); 
                font-weight: 600; 
                text-align: left; 
                padding-right: 1rem;
                color: #4a5568;
            }
        }
        
        /* Progress animations */
        .progress-shimmer {
            position: relative;
            overflow: hidden;
        }
        .progress-shimmer::after {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
            animation: shimmer 2s infinite;
        }
        @keyframes shimmer {
            0% { left: -100%; }
            100% { left: 100%; }
        }
        
        /* Status indicators */
        .status-pulse {
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        /* Loading states */
        .loading-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 255, 255, 0.9);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 50;
            border-radius: inherit;
        }
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
    let userPanel, greetingMsg, prerequisiteToggle, fetchBtn, logoutBtn;
    let progressBarContainer, progressBarElement, progressBarText;

    // State Management
    let authToken = null;
    let dotId = null;
    let allScheduleData = [];
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;

    // Performance tracking
    let lastFetchTime = 0;
    let requestCount = 0;

    // Enhanced Backend Communication với comprehensive timeout handling
    const backendRequest = async (action, payload = {}, retries = 2) => {
        const startTime = Date.now();
        
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                // Progress delay for retries
                if (attempt > 0) {
                    await new Promise(resolve => setTimeout(resolve, 300 * attempt));
                    log(`🔄 Thử lại lần ${attempt + 1} cho '${action}'...`);
                }
                
                // Request timeout setup
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout
                
                const headers = { 'Content-Type': 'application/json' };
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
                
                const response = await fetch('/api/handler', { 
                    method: 'POST', 
                    headers, 
                    body: JSON.stringify({ action, payload }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                const responseTime = Date.now() - startTime;
                requestCount++;
                
                if (!response.ok) {
                    if (response.status === 524) {
                        const errorData = await response.json().catch(() => ({}));
                        log(`⚠️ Server timeout cho '${action}' (${responseTime}ms)`, true);
                        if (errorData.suggestion) {
                            log(`💡 Gợi ý: ${errorData.suggestion}`, false);
                        }
                        return { 
                            success: false, 
                            message: 'Server timeout - thử giảm phạm vi dữ liệu',
                            timeout: true 
                        };
                    }
                    
                    const errorData = await response.json().catch(() => ({ 
                        message: `HTTP Error: ${response.status}` 
                    }));
                    
                    if (attempt === retries - 1) {
                        log(`❌ Lỗi '${action}': ${errorData.message} (${responseTime}ms)`, true);
                        return null;
                    }
                    continue;
                }
                
                const result = await response.json();
                
                // Log performance info
                if (result.processingTime) {
                    log(`⚡ '${action}' hoàn thành trong ${result.processingTime}ms`);
                }
                
                return result;
                
            } catch (error) {
                const responseTime = Date.now() - startTime;
                
                if (error.name === 'AbortError') {
                    log(`⏱️ Request '${action}' timeout sau ${responseTime}ms`, true);
                    return { success: false, message: 'Request timeout', timeout: true };
                }
                
                if (attempt === retries - 1) {
                    log(`❌ Lỗi mạng '${action}': ${error.message} (${responseTime}ms)`, true);
                    return null;
                }
            }
        }
    };

    // Utility Functions
    const log = (message, isError = false) => {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('p');
        logEntry.innerHTML = `<span class="text-gray-400">[${timestamp}]</span> ${message}`;
        logEntry.className = isError ? 'text-red-400' : 'text-green-300';
        logOutput.appendChild(logEntry);
        logOutput.scrollTop = logOutput.scrollHeight;
        
        // Keep log clean (max 100 entries)
        if (logOutput.children.length > 100) {
            logOutput.removeChild(logOutput.firstChild);
        }
    };

    const toggleLoading = (button, isLoading) => {
        if (!button) return;
        if (isLoading) {
            button.disabled = true;
            if (!button.originalHTML) button.originalHTML = button.innerHTML;
            button.innerHTML = `<div class="loader"></div>`;
        } else {
            button.disabled = false;
            if (button.originalHTML) {
                button.innerHTML = button.originalHTML;
            }
        }
    };

    // Store original HTML for all buttons
    [loginBtn, startInsertionBtn, startRegistrationBtn, stopBtn, refreshRegisteredBtn].forEach(btn => {
        if (btn) btn.originalHTML = btn.innerHTML;
    });

    // Enhanced Progress Bar với animation
    const updateProgressBar = (current, total, message = '', subMessage = '') => {
        if (!progressBarContainer) return;
        if (current === -1) {
            progressBarContainer.classList.add('hidden');
            return;
        }
        
        progressBarContainer.classList.remove('hidden');
        const percentage = total > 0 ? Math.min((current / total) * 100, 100) : 0;
        
        progressBarElement.style.width = `${percentage}%`;
        progressBarElement.className = percentage < 100 ? 
            'bg-blue-600 h-3 rounded-full transition-all duration-300 progress-shimmer' : 
            'bg-green-600 h-3 rounded-full transition-all duration-300';
        
        let displayMessage = message;
        if (subMessage) displayMessage += ` - ${subMessage}`;
        if (total > 0) displayMessage += ` (${current}/${total})`;
        
        progressBarText.textContent = displayMessage;
    };

    // Enhanced Format Functions
    const formatScheduleDetail = (details) => {
        if (!details || details.error || !Array.isArray(details) || details.length === 0) {
            return '<span class="text-red-500 text-xs">Không có thông tin lịch học</span>';
        }
        
        return details.map(d => `
            <div class="text-xs mb-1 p-1 bg-gray-50 rounded">
                <span class="font-medium text-blue-600">Thứ ${d.thu}</span> - 
                <span class="text-gray-700">Tiết ${d.tietHoc}</span><br>
                <span class="text-gray-500">${new Date(d.ngayBatDau).toLocaleDateString('vi-VN')} - ${new Date(d.ngayKetThuc).toLocaleDateString('vi-VN')}</span>
            </div>
        `).join('');
    };

    const formatSelectedClassDetail = (cls, details) => {
        if (!details || details.error) return '<span class="text-red-500">Không tải được lịch</span>';
        if (!Array.isArray(details) || details.length === 0) return '<span>Chưa có thông tin lịch học</span>';
        
        return details.map(detail => 
            `<span class="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded mr-1 mb-1">
                ${cls.maLopHocPhan} | Thứ ${detail.thu} | Tiết ${detail.tietHoc}
            </span>`
        ).join('');
    };

    // Enhanced UI Update Functions
    const updateUIAfterLogin = (profile) => {
        loginForm.style.display = 'none';
        
        if (!document.getElementById('user-panel-content')) {
            const panelContainer = document.createElement('div');
            panelContainer.id = 'user-panel-content';
            panelContainer.className = 'space-y-4';
            panelContainer.innerHTML = `
                <div id="greeting-msg" class="mt-4 text-lg font-semibold text-blue-700 p-3 bg-blue-50 rounded-lg"></div>
                
                <div id="prerequisite-toggle-container" class="flex items-center justify-center my-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <label for="prerequisite-toggle" class="flex items-center cursor-pointer w-full">
                        <div class="relative">
                            <input type="checkbox" id="prerequisite-toggle" class="sr-only">
                            <div class="block bg-gray-600 w-14 h-8 rounded-full transition-colors duration-200"></div>
                            <div class="dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform duration-200"></div>
                        </div>
                        <div class="ml-3">
                            <div class="text-gray-700 font-medium">Lấy dữ liệu môn học điều kiện</div>
                            <div class="text-xs text-yellow-600">⚠️ Có thể làm chậm quá trình tải</div>
                        </div>
                    </label>
                </div>
                
                <div id="progress-bar-container" class="my-4 hidden">
                    <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                        <div id="progress-bar-element" class="bg-blue-600 h-3 rounded-full transition-all duration-300" style="width: 0%"></div>
                    </div>
                    <p id="progress-bar-text" class="text-center text-sm text-gray-600 mt-2"></p>
                    <div class="text-xs text-gray-500 text-center mt-1">
                        <span id="performance-info">Requests: 0</span>
                    </div>
                </div>
                
                <button id="fetch-schedule-btn" class="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold py-3 px-4 rounded-lg hover:from-blue-700 hover:to-blue-800 transition duration-300 flex items-center justify-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM6 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" />
                    </svg>
                    <span>Lấy dữ liệu lịch học</span>
                </button>
                
                <button id="logout-btn" class="w-full bg-gray-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 transition duration-300">
                    Đăng xuất
                </button>
            `;
            loginForm.parentNode.insertBefore(panelContainer, loginForm.nextSibling);

            // Re-assign element variables
            greetingMsg = document.getElementById('greeting-msg');
            prerequisiteToggle = document.getElementById('prerequisite-toggle');
            fetchBtn = document.getElementById('fetch-schedule-btn');
            logoutBtn = document.getElementById('logout-btn');
            progressBarContainer = document.getElementById('progress-bar-container');
            progressBarElement = document.getElementById('progress-bar-element');
            progressBarText = document.getElementById('progress-bar-text');
            
            // Store original HTML
            fetchBtn.originalHTML = fetchBtn.innerHTML;
            logoutBtn.originalHTML = logoutBtn.innerHTML;
            
            // Add event listeners
            fetchBtn.addEventListener('click', fetchFullSchedule);
            logoutBtn.addEventListener('click', handleLogout);
        }
        
        greetingMsg.innerHTML = `
            <div class="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-green-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Xin chào, <strong>${profile.hoDem} ${profile.ten}</strong>!
            </div>
        `;
        document.getElementById('user-panel-content').style.display = 'block';
    };

    const resetUI = () => {
        loginForm.style.display = 'block';
        const panel = document.getElementById('user-panel-content');
        if (panel) panel.style.display = 'none';

        scheduleContainer.innerHTML = `
            <div class="text-center py-12">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p class="text-gray-500">Vui lòng đăng nhập để xem dữ liệu</p>
            </div>
        `;
        
        registeredContainer.innerHTML = `
            <div class="text-center py-12">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p class="text-gray-500">Chưa có dữ liệu đăng ký</p>
            </div>
        `;
        
        logOutput.innerHTML = '<p class="text-blue-400">>>> Ứng dụng đã reset - sẵn sàng đăng nhập lại</p>';
        subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>';
        searchInput.value = '';
        allScheduleData = [];
        selectedClasses.clear();
        updateSelectedList();
        updateProgressBar(-1);
        requestCount = 0;
    };

    // Core Logic Functions
    const handleLogin = async () => {
        toggleLoading(loginBtn, true);
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        
        if (!username || !password) {
            log("⚠️ Vui lòng nhập tên đăng nhập và mật khẩu.", true);
            toggleLoading(loginBtn, false);
            return;
        }

        log("🔐 Đang xác thực...");
        const tokenRes = await backendRequest('login', { username, password });

        if (tokenRes && tokenRes.token) {
            authToken = tokenRes.token;
            log("✅ Đăng nhập thành công.");
            
            log("📊 Đang lấy thông tin cơ bản...");
            const initialData = await backendRequest('getInitialData');
            
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                log(`🎯 Đã chọn đợt: ${initialData.dot.tenHocKy}`);
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
        log("👋 Đã đăng xuất.");
    };

    // Enhanced Schedule Fetching với comprehensive monitoring
    const fetchFullSchedule = async () => {
        if (!authToken) return log("🔒 Chưa đăng nhập.", true);
        
        toggleLoading(fetchBtn, true);
        isProcessStopped = false;
        requestCount = 0;
        lastFetchTime = Date.now();
        
        log("🚀 Bắt đầu lấy toàn bộ lịch học từ server...");
        updateProgressBar(0, 100, 'Đang khởi tạo...', 'Chuẩn bị request');
        
        const fetchPrerequisites = prerequisiteToggle?.checked || false;
        
        if (fetchPrerequisites) {
            log("⚠️ Đang bật chế độ lấy môn điều kiện - có thể mất nhiều thời gian...", false);
        }
        
        try {
            const startTime = Date.now();
            updateProgressBar(10, 100, 'Đang gửi request', 'Chờ server xử lý...');
            
            const scheduleRes = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites });
            const totalTime = Date.now() - startTime;
            
            if (scheduleRes && scheduleRes.success) {
                allScheduleData = scheduleRes.schedule || [];
                subjectTypeMap = new Map(Object.entries(scheduleRes.subjectTypes || {}));
                
                const stats = {
                    classes: allScheduleData.length,
                    subjects: scheduleRes.totalSubjects || 0,
                    processed: scheduleRes.processedSubjects || 0,
                    time: (totalTime / 1000).toFixed(1)
                };
                
                log(`✅ Tải thành công ${stats.classes} lớp học từ ${stats.processed}/${stats.subjects} môn (${stats.time}s).`);
                
                updateProgressBar(80, 100, 'Đang xử lý dữ liệu', 'Tạo bảng...');
                await renderScheduleTable();
                
                updateProgressBar(100, 100, 'Hoàn thành', `${stats.classes} lớp học`);
                
                // Performance info update
                const perfInfo = document.getElementById('performance-info');
                if (perfInfo) {
                    perfInfo.textContent = `Requests: ${requestCount} | Time: ${stats.time}s`;
                }
                
                setTimeout(() => updateProgressBar(-1), 3000);
            } else if (scheduleRes && scheduleRes.timeout) {
                log("⏱️ Server timeout - dữ liệu quá lớn để xử lý trong thời gian cho phép.", true);
                log("💡 Thử tắt 'môn học điều kiện' để giảm tải hoặc thử lại sau.");
                updateProgressBar(-1);
            } else {
                log("❌ Lỗi khi tải lịch học từ server.", true);
                updateProgressBar(-1);
            }
        } catch (error) {
            log(`💥 Lỗi không mong muốn: ${error.message}`, true);
            updateProgressBar(-1);
        }
        
        toggleLoading(fetchBtn, false);
    };

    // Registration functions với enhanced monitoring
    const fetchRegisteredClasses = async () => {
        if (!authToken) return;
        toggleLoading(refreshRegisteredBtn, true);
        
        log("🔍 Đang tải danh sách đã đăng ký...");
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

    const startInsertion = () => {
        if (selectedClasses.size === 0) return log("⚠️ Vui lòng chọn lớp để chờ.", true);
        
        stopProcess();
        isProcessStopped = false;
        toggleActionButtons(true);
        log(`🎯 Bắt đầu quá trình chờ lớp cho ${selectedClasses.size} lớp...`);

        const classesBySubject = new Map();
        selectedClasses.forEach(cls => {
            if (!classesBySubject.has(cls.maHocPhan)) classesBySubject.set(cls.maHocPhan, []);
            classesBySubject.get(cls.maHocPhan).push(cls);
        });
        
        const delay = Math.max(parseInt(delayInput.value, 10) || 1000, 500);
        log(`⏱️ Sử dụng delay: ${delay}ms giữa các request`);

        classesBySubject.forEach((classes, maHocPhan) => {
            const tenMonHoc = classes[0].tenMonHoc || maHocPhan;
            const source = classes[0].source;

            const intervalId = setInterval(async () => {
                if (isProcessStopped) return;
                
                log(`[${tenMonHoc}] 👁️ Kiểm tra tình trạng lớp...`);
                const statusRes = await backendRequest('checkClassStatus', { dotId, maHocPhan, source });

                if (!statusRes || !statusRes.success) {
                    log(`[${tenMonHoc}] ❌ Không thể kiểm tra trạng thái`, true);
                    return;
                }

                for (const availableClass of statusRes.body) {
                    if (selectedClasses.has(availableClass.id.toString()) && availableClass.phanTramDangKy < 100) {
                        log(`[${tenMonHoc}] 🎉 Phát hiện lớp còn chỗ: ${availableClass.maLopHocPhan} (${100 - availableClass.phanTramDangKy}% trống)`);
                        
                        const regResult = await backendRequest('register', { classId: availableClass.id, source });

                        if (regResult && regResult.success) {
                            log(`🏆 [${tenMonHoc}] ĐĂNG KÝ THÀNH CÔNG! Dừng chờ cho môn này.`);
                            clearInterval(registrationIntervals.get(maHocPhan));
                            registrationIntervals.delete(maHocPhan);
                            classes.forEach(c => selectedClasses.delete(c.id.toString()));
                            await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                            
                            if (registrationIntervals.size === 0) await stopProcess();
                            return;
                        } else {
                            log(`❌ [${tenMonHoc}] Chờ thất bại: ${regResult?.message || 'Lỗi'}`, true);
                        }
                    }
                }
            }, delay);
            
            registrationIntervals.set(maHocPhan, intervalId);
        });
    };

    const startRegistration = () => {
        if (selectedClasses.size === 0) return log("⚠️ Vui lòng chọn lớp để đăng ký.", true);
        
        stopProcess();
        isProcessStopped = false;
        toggleActionButtons(true);
        log(`🚀 Bắt đầu đăng ký liên tục cho ${selectedClasses.size} lớp...`);

        const classesBySubject = new Map();
        selectedClasses.forEach(cls => {
            if (!classesBySubject.has(cls.maHocPhan)) classesBySubject.set(cls.maHocPhan, []);
            classesBySubject.get(cls.maHocPhan).push(cls);
        });
        
        const delay = Math.max(parseInt(delayInput.value, 10) || 1000, 500);
        log(`⏱️ Sử dụng delay: ${delay}ms giữa các request`);

        classesBySubject.forEach((classes, maHocPhan) => {
            const tenMonHoc = classes[0].tenMonHoc;
            const source = classes[0].source;
            
            const intervalId = setInterval(async () => {
                if (isProcessStopped) return;
                
                // Try direct registration first
                for (const cls of classes) {
                    if (isProcessStopped) return;
                    
                    log(`[${tenMonHoc}] ⚡ Gửi yêu cầu đăng ký lớp ${cls.maLopHocPhan}...`);
                    const result = await backendRequest('register', { classId: cls.id, source: cls.source });
                    
                    if (result && (result.success || result.message?.includes('Bạn đã đăng ký môn này rồi'))) {
                        log(`🏆 [${tenMonHoc}] THÀNH CÔNG! Dừng đăng ký cho môn này.`);
                        clearInterval(registrationIntervals.get(maHocPhan));
                        registrationIntervals.delete(maHocPhan);
                        classes.forEach(c => selectedClasses.delete(c.id.toString()));
                        await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                        
                        if (registrationIntervals.size === 0) await stopProcess();
                        return;
                    } else if (result) {
                        log(`❌ [${tenMonHoc}] ${result.message}`, result.success === false);
                    }
                }
                
                // Check for available slots
                log(`[${tenMonHoc}] 👁️ Kiểm tra slot trống...`);
                const statusRes = await backendRequest('checkClassStatus', { dotId, maHocPhan, source });
                if (!statusRes || !statusRes.success) return;
                
                for (const availableClass of statusRes.body) {
                    if (selectedClasses.has(availableClass.id.toString()) && availableClass.phanTramDangKy < 100) {
                        log(`[${tenMonHoc}] 🎯 Phát hiện lớp còn chỗ ${availableClass.maLopHocPhan} (${100 - availableClass.phanTramDangKy}% trống)`);
                        
                        const regResult = await backendRequest('register', { classId: availableClass.id, source });
                        
                        if (regResult && regResult.success) {
                            log(`🏆 [${tenMonHoc}] ĐĂNG KÝ THÀNH CÔNG! Dừng chờ cho môn này.`);
                            clearInterval(registrationIntervals.get(maHocPhan));
                            registrationIntervals.delete(maHocPhan);
                            classes.forEach(c => selectedClasses.delete(c.id.toString()));
                            await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                            
                            if (registrationIntervals.size === 0) await stopProcess();
                            return;
                        } else {
                            log(`❌ [${tenMonHoc}] Chờ thất bại: ${regResult?.message || 'Lỗi'}`, true);
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
        
        registrationIntervals.forEach((intervalId, subject) => {
            clearInterval(intervalId);
            log(`🛑 Đã dừng quá trình cho môn: ${subject}`);
        });
        
        registrationIntervals.clear();
        toggleActionButtons(false);
        log("✅ Đã dừng tất cả quá trình.");
    };

    const toggleActionButtons = (isProcessing) => {
        startInsertionBtn.classList.toggle('hidden', isProcessing);
        startRegistrationBtn.classList.toggle('hidden', isProcessing);
        stopBtn.classList.toggle('hidden', !isProcessing);
        
        // Update button states
        if (isProcessing) {
            stopBtn.classList.add('status-pulse');
        } else {
            stopBtn.classList.remove('status-pulse');
        }
    };

    // Enhanced Rendering Functions
    const renderScheduleTable = async () => {
        const query = searchInput.value.toLowerCase();
        const selectedSubject = subjectFilter.value;
        
        // Update subject filter
        if (allScheduleData.length > 0) {
            const subjects = [...new Set(allScheduleData.map(cls => cls.tenMonHoc))].sort();
            subjectFilter.innerHTML = '<option value="">Tất cả môn học (' + allScheduleData.length + ' lớp)</option>' + 
                subjects.map(s => `<option value="${s}" ${s === selectedSubject ? 'selected' : ''}>${s}</option>`).join('');
        }
        
        // Filter data
        const filteredData = allScheduleData.filter(cls => 
            (!selectedSubject || cls.tenMonHoc === selectedSubject) &&
            (`${cls.tenMonHoc} ${cls.maLopHocPhan} ${cls.maHocPhan}`.toLowerCase().includes(query))
        );
        
        if (filteredData.length === 0) {
            scheduleContainer.innerHTML = allScheduleData.length === 0 ? 
                `<div class="text-center py-12">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p class="text-gray-500">Vui lòng đăng nhập và nhấn "Lấy Dữ Liệu"</p>
                </div>` :
                `<div class="text-center py-12">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p class="text-gray-500">Không tìm thấy lớp học phần nào</p>
                </div>`;
            return;
        }
        
        // Create enhanced table
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gradient-to-r from-gray-100 to-gray-200 sticky top-0 z-10">
                <tr>
                    <th scope="col" class="px-6 py-4 font-semibold">
                        <div class="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            Tên môn học & Lịch học
                        </div>
                    </th>
                    <th scope="col" class="px-6 py-4 font-semibold">Mã LHP</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Loại HP</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Số TC</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Trạng thái</th>
                    <th scope="col" class="px-6 py-4 font-semibold">
                        <div class="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            % Đã ĐK
                        </div>
                    </th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        
        const tbody = table.querySelector('tbody');
        
        filteredData.forEach(cls => {
            const row = document.createElement('tr');
            const isSelected = selectedClasses.has(cls.id.toString());
            row.className = `bg-white border-b hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 cursor-pointer transition-all duration-200 ${isSelected ? 'bg-gradient-to-r from-yellow-100 to-orange-100 border-yellow-300' : ''}`;
            row.dataset.classId = cls.id;
            
            const isBatBuoc = subjectTypeMap.get(cls.maHocPhan);
            const typeHtml = cls.source === 'dkhpdk' ? 
                '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">📚 Điều kiện</span>' :
                (isBatBuoc === undefined ? '<span class="text-gray-400">N/A</span>' : 
                (isBatBuoc ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">✅ Bắt buộc</span>' : 
                '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">🎯 Tự chọn</span>'));
            
            const percentage = cls.phanTramDangKy;
            const statusColor = percentage >= 100 ? 'text-red-500' : 
                               percentage >= 80 ? 'text-orange-500' : 'text-green-500';
            const statusIcon = percentage >= 100 ? '🚫' : 
                              percentage >= 80 ? '⚠️' : '✅';
            
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900">
                    <div class="flex items-start">
                        <div class="flex-1">
                            <div class="font-semibold text-gray-900 mb-1">${cls.tenMonHoc}</div>
                            <div class="text-xs text-gray-600 bg-gray-50 rounded-md p-2 mt-2">${formatScheduleDetail(cls.scheduleDetails)}</div>
                        </div>
                        ${isSelected ? '<div class="ml-2 flex-shrink-0"><span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-200 text-yellow-800">Đã chọn</span></div>' : ''}
                    </div>
                </th>
                <td class="px-6 py-4" data-label="Mã LHP">
                    <span class="font-mono text-blue-600 font-semibold">${cls.maLopHocPhan}</span>
                </td>
                <td class="px-6 py-4" data-label="Loại HP">${typeHtml}</td>
                <td class="px-6 py-4 text-center font-semibold" data-label="Số TC">${cls.soTinChi > 0 ? cls.soTinChi : (cls.soTinChi ?? 'N/A')}</td>
                <td class="px-6 py-4" data-label="Trạng thái">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        ${cls.tenTrangThai || 'N/A'}
                    </span>
                </td>
                <td class="px-6 py-4 text-center" data-label="% Đã ĐK">
                    <div class="flex items-center justify-center">
                        <span class="text-lg mr-1">${statusIcon}</span>
                        <span class="font-bold ${statusColor}">${percentage}%</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                        <div class="h-1.5 rounded-full transition-all duration-300 ${percentage >= 100 ? 'bg-red-500' : percentage >= 80 ? 'bg-orange-500' : 'bg-green-500'}" style="width: ${percentage}%"></div>
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        scheduleContainer.innerHTML = '';
        scheduleContainer.appendChild(table);
        
        // Add loading overlay if needed
        if (filteredData.length > 50) {
            log(`📊 Hiển thị ${filteredData.length} lớp học - có thể mất chút thời gian để render`);
        }
    };

    const renderRegisteredTable = async (data) => {
        if (!data || data.length === 0) {
            registeredContainer.innerHTML = `
                <div class="text-center py-12">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <p class="text-gray-500">Bạn chưa đăng ký học phần nào</p>
                </div>
            `;
            return;
        }
        
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = `
            <thead class="text-xs text-gray-700 uppercase bg-gradient-to-r from-green-100 to-emerald-200 sticky top-0 z-10">
                <tr>
                    <th scope="col" class="px-6 py-4 font-semibold">
                        <div class="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Tên môn học & Lịch học
                        </div>
                    </th>
                    <th scope="col" class="px-6 py-4 font-semibold">Mã LHP</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Số TC</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Trạng thái</th>
                    <th scope="col" class="px-6 py-4 font-semibold">Hành động</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        
        const tbody = table.querySelector('tbody');
        
        data.forEach((reg, index) => {
            const row = document.createElement('tr');
            row.className = `bg-white border-b hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 transition-all duration-200 ${index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`;
            
            const sourceBadge = reg.source === 'dkhpdk' ? 
                '<span class="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">📚 Điều kiện</span>' : '';
            
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900">
                    <div class="flex items-start">
                        <div class="flex-1">
                            <div class="flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4" />
                                </svg>
                                <span class="font-semibold text-green-800">${reg.tenMonHoc}</span>
                                ${sourceBadge}
                            </div>
                            <div class="text-xs text-gray-600 bg-green-50 rounded-md p-2 mt-2">${formatScheduleDetail(reg.scheduleDetails)}</div>
                        </div>
                    </div>
                </th>
                <td class="px-6 py-4" data-label="Mã LHP">
                    <span class="font-mono text-green-600 font-semibold">${reg.maLopHocPhan}</span>
                </td>
                <td class="px-6 py-4 text-center font-semibold" data-label="Số TC">${reg.soTinChi > 0 ? reg.soTinChi : (reg.soTinChi ?? 'N/A')}</td>
                <td class="px-6 py-4" data-label="Trạng thái">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        ✅ ${reg.tenTrangThaiLopHocPhan || 'Đã đăng ký'}
                    </span>
                </td>
                <td class="px-6 py-4" data-label="Hành động">
                    ${reg.isAllowCancel !== false ? 
                        `<button data-reg-id="${reg.id ?? ''}" data-ten-mon="${reg.tenMonHoc ?? ''}" data-source="${reg.source ?? ''}" class="cancel-btn inline-flex items-center px-3 py-1.5 border border-red-300 text-sm leading-4 font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 transition-all duration-200">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Hủy
                        </button>` : 
                        '<span class="inline-flex items-center px-3 py-1.5 text-sm text-gray-400 bg-gray-100 rounded-md">🔒 Không thể hủy</span>'}
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        registeredContainer.innerHTML = '';
        registeredContainer.appendChild(table);
    };

    const updateSelectedList = async () => {
        const selectedCount = selectedClasses.size;
        
        // Update counter
        const countElement = document.getElementById('selected-count');
        if (countElement) {
            countElement.textContent = selectedCount;
            countElement.className = selectedCount > 0 ? 
                'px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full animate-pulse' :
                'px-2 py-1 bg-gray-100 text-gray-500 text-xs font-medium rounded-full';
        }
        
        if (selectedCount === 0) {
            selectedList.innerHTML = `
                <div class="text-center py-8">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-gray-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p class="text-gray-500 text-sm">Chưa có lớp nào được chọn</p>
                    <p class="text-xs text-gray-400 mt-1">Click vào lớp trong bảng để chọn</p>
                </div>
            `;
            registrationControls.classList.add('hidden');
            return;
        }
        
        selectedList.innerHTML = [...selectedClasses.values()].map(cls => {
            const sourceBadge = cls.source === 'dkhpdk' ? 
                '<span class="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-200 text-purple-800">ĐK</span>' : '';
            
            return `
                <div class="group flex justify-between items-center bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg border border-blue-200 hover:from-blue-100 hover:to-indigo-100 transition-all duration-200">
                    <div class="flex-1">
                        <div class="flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4" />
                            </svg>
                            <p class="font-semibold text-sm text-blue-900">${cls.tenMonHoc}${sourceBadge}</p>
                        </div>
                        <div class="text-xs text-gray-600 mt-2 bg-white/50 rounded p-1">${formatSelectedClassDetail(cls, cls.scheduleDetails)}</div>
                    </div>
                    <button data-class-id="${cls.id}" class="remove-selected-btn ml-3 text-red-500 hover:text-red-700 hover:bg-red-100 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 group-hover:scale-110">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            `;
        }).join('');
        
        registrationControls.classList.remove('hidden');
    };

    const cancelRegistration = async (registrationId, tenMonHoc, source) => {
        const confirmed = confirm(`🗑️ Bạn có chắc muốn hủy môn "${tenMonHoc}" không?\n\nLưu ý: Hành động này không thể hoàn tác!`);
        if (!confirmed) return;
        
        log(`🗑️ Đang hủy môn ${tenMonHoc}...`);
        const result = await backendRequest('cancel', { registrationId, source });
        
        if (result && result.success) {
            log(`✅ Hủy môn "${tenMonHoc}" thành công.`);
            await fetchRegisteredClasses();
        } else {
            log(`❌ Hủy môn "${tenMonHoc}" thất bại: ${result?.message || 'Lỗi không xác định'}`, true);
        }
    };

    // Event Listeners
    loginBtn.addEventListener('click', handleLogin);
    refreshRegisteredBtn.addEventListener('click', fetchRegisteredClasses);
    startInsertionBtn.addEventListener('click', startInsertion);
    startRegistrationBtn.addEventListener('click', startRegistration);
    stopBtn.addEventListener('click', stopProcess);
    searchInput.addEventListener('input', () => renderScheduleTable());
    subjectFilter.addEventListener('change', () => renderScheduleTable());
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

    // Enhanced Click Handlers
    document.addEventListener('click', (e) => {
        // Schedule row selection với visual feedback
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow && scheduleRow.dataset.classId) {
            const classId = scheduleRow.dataset.classId;
            const cls = allScheduleData.find(c => c.id.toString() === classId);
            if (!cls) return;
            
            const wasSelected = selectedClasses.has(classId);
            
            if (wasSelected) {
                selectedClasses.delete(classId);
                scheduleRow.classList.remove('bg-gradient-to-r', 'from-yellow-100', 'to-orange-100', 'border-yellow-300');
                log(`➖ Đã bỏ chọn: ${cls.tenMonHoc} (${cls.maLopHocPhan})`);
            } else {
                selectedClasses.set(classId, cls);
                scheduleRow.classList.add('bg-gradient-to-r', 'from-yellow-100', 'to-orange-100', 'border-yellow-300');
                log(`➕ Đã chọn: ${cls.tenMonHoc} (${cls.maLopHocPhan})`);
            }
            
            updateSelectedList();
        }
        
        // Remove selected class
        const removeBtn = e.target.closest('.remove-selected-btn');
        if (removeBtn) {
            const classId = removeBtn.dataset.classId;
            const cls = selectedClasses.get(classId);
            
            selectedClasses.delete(classId);
            const rowToUpdate = document.querySelector(`#schedule-container tr[data-class-id="${classId}"]`);
            if (rowToUpdate) {
                rowToUpdate.classList.remove('bg-gradient-to-r', 'from-yellow-100', 'to-orange-100', 'border-yellow-300');
            }
            
            if (cls) {
                log(`➖ Đã bỏ chọn: ${cls.tenMonHoc} (${cls.maLopHocPhan})`);
            }
            
            updateSelectedList();
        }
        
        // Cancel registration với confirmation
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const { regId, tenMon, source } = cancelBtn.dataset;
            cancelRegistration(regId, tenMon, source);
        }
    });

    // Clear log functionality
    document.addEventListener('click', (e) => {
        if (e.target.closest('#clear-log-btn')) {
            logOutput.innerHTML = '<p class="text-blue-400">>>> Log đã được xóa - sẵn sàng cho hoạt động mới</p>';
            log('🧹 Log đã được dọn dẹp');
        }
    });

    // Initialize Application
    log('🚀 Ứng dụng Enhanced UTH Course Registration Tool đã sẵn sàng!');
    log('💡 Hãy đăng nhập để bắt đầu sử dụng các tính năng');
    
    // Performance monitoring
    setInterval(() => {
        const perfInfo = document.getElementById('performance-info');
        if (perfInfo && requestCount > 0) {
            const avgTime = lastFetchTime > 0 ? ((Date.now() - lastFetchTime) / 1000).toFixed(1) : 0;
            perfInfo.textContent = `Requests: ${requestCount} | Uptime: ${avgTime}s`;
        }
    }, 1000);
});
