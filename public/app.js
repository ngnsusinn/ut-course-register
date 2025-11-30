document.addEventListener('DOMContentLoaded', async () => {
    // === LOAD CONFIGURATION FROM BACKEND ===
    await window.AppConfig.load();
    const CONFIG = window.AppConfig.get();
    
    // Aliases for module functions (for backward compatibility)
    const Utils = window.AppUtils;
    const API = window.AppAPI;
    const Cache = window.AppCache;
    const Conflict = window.AppConflict;
    const Swap = window.AppSwap;
    const Modal = window.AppModal;

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
    let userPanel, greetingMsg, prerequisiteToggle, prerequisiteToggleContainer, fetchBtn, logoutBtn, progressBarContainer, progressBarElement, progressBarText, vipStatusElement, upgradeVipBtn;

    // State (app-specific, not in Cache module)
    let authToken = null;
    let dotId = null;
    let userId = null;
    let vipStatus = { hasVIP: false };
    let registrationIntervals = new Map();
    let isProcessStopped = false;
    
    // VIP Module alias
    const VIP = window.AppVIP;
    
    // === DATA STORAGE (using Cache module directly) ===
    // All data is accessed via Cache module: 
    // Cache.allScheduleData, Cache.registeredClassesData, 
    // Cache.selectedClasses, Cache.swapPendingClasses, Cache.subjectTypeMap
    
    // Aliases for Maps (direct reference)
    const selectedClasses = Cache.selectedClasses;
    const swapPendingClasses = Cache.swapPendingClasses;
    const subjectTypeMap = Cache.subjectTypeMap;
    
    // Expose data for timetable module (using Cache module)
    window.getRegisteredClassesData = () => Cache.registeredClassesData;
    window.getSelectedClassesData = () => {
        const allClasses = [];
        Cache.selectedClasses.forEach(cls => allClasses.push(cls));
        Cache.swapPendingClasses.forEach(swap => allClasses.push(swap.target));
        return allClasses;
    };

    // === USE MODULE FUNCTIONS ===
    // Cache lookups: Cache.getScheduleById(), Cache.getRegisteredByCode(), etc.
    // Swap validation: Swap.canSwapClass()
    // Conflict detection: Conflict.checkScheduleConflict()

    // Assign originalHTML safely
    const buttons = [loginBtn, startInsertionBtn, startRegistrationBtn, stopBtn, refreshRegisteredBtn];
    buttons.forEach(btn => { if (btn) btn.originalHTML = btn.innerHTML; });

    // === BACKEND COMMUNICATION (using API module) ===
    const backendRequest = async (action, payload = {}) => {
        API.setToken(authToken);
        return await API.request(action, payload);
    };

    // --- UTILITY FUNCTIONS (aliases to modules) ---
    const log = (message, isError = false) => Utils.log(message, isError);
    const toggleLoading = (button, isLoading) => Utils.toggleLoading(button, isLoading);
    const formatDayOfWeek = (thu) => Utils.formatDayOfWeek(thu);
    const formatScheduleDetail = (details) => Utils.formatScheduleDetail(details);
    const formatSelectedClassDetail = (cls, details) => Utils.formatSelectedClassDetail(cls, details);

    // --- SCHEDULE CONFLICT DETECTION (using Conflict module) ---
    const checkScheduleConflict = (classScheduleDetails, registeredData) => 
        Conflict.checkScheduleConflict(classScheduleDetails, registeredData);
    
    const checkScheduleConflictBetweenTwo = (schedule1, schedule2) => 
        Conflict.checkConflictBetweenTwo(schedule1, schedule2);
    
    // --- SWAP VALIDATION (using Swap module) ---
    const canSwapClass = (registeredClass, targetClass) => 
        Swap.canSwapClass(registeredClass, targetClass);

    // --- MODAL FUNCTIONS ---
    const showGuideModal = () => Modal.showGuide();
    const showConfirmModal = (message, onConfirm, onCancel) => Modal.showConfirm(message, onConfirm, onCancel);

    // Templates alias
    const Templates = window.AppTemplates;

    // --- VIP MODULE INITIALIZATION ---
    // Initialize VIP module with callbacks (will be fully set up after updateVIPDisplay is defined)
    const initVIPModule = () => {
        VIP.init({
            backendRequest,
            log,
            getConfig: () => CONFIG,
            getUserId: () => userId,
            getVIPStatus: () => vipStatus,
            onVIPStatusChange: async (newVipStatus) => {
                if (newVipStatus) {
                    vipStatus = newVipStatus;
                }
                updateVIPDisplay();
            },
            onVIPExpired: () => {
                // Reset UI to non-VIP state
                Cache.allScheduleData = [];
                selectedClasses.clear();
                updateSelectedList();
                renderScheduleTable();
                localStorage.removeItem('userDataCache');
            }
        });
    };

    // VIP function aliases (using VIP module)
    const showVIPModal = () => VIP.showModal();
    const checkAndUpdateVIPStatus = () => VIP.checkAndUpdateStatus();
    const startVIPExpiryCheck = () => VIP.startExpiryCheck();
    const stopVIPExpiryCheck = () => VIP.stopExpiryCheck();
	
    const updateVIPDisplay = () => {
        if (!vipStatusElement) return;

        const isVip = !!vipStatus.hasVIP;

        if (isVip) {
            vipStatusElement.innerHTML = Templates.vipStatusActive(vipStatus.daysLeft, vipStatus.expiryDate);
            upgradeVipBtn.innerHTML = Templates.vipButton(true);
            upgradeVipBtn.classList.remove('hidden');

            if (prerequisiteToggleContainer) prerequisiteToggleContainer.classList.remove('hidden');
            if (prerequisiteToggle) prerequisiteToggle.disabled = false;
            if (fetchBtn) fetchBtn.classList.remove('hidden');
            if (selectedList) selectedList.classList.remove('hidden');
        } else {
            vipStatusElement.innerHTML = Templates.vipStatusInactive;
            upgradeVipBtn.innerHTML = Templates.vipButton(false);
            upgradeVipBtn.classList.remove('hidden');

            if (prerequisiteToggleContainer) prerequisiteToggleContainer.classList.add('hidden');
            if (prerequisiteToggle) {
                prerequisiteToggle.disabled = true;
                prerequisiteToggle.checked = false;
            }
            if (fetchBtn) fetchBtn.classList.add('hidden');
            if (selectedList) selectedList.classList.add('hidden');
        }
    };

    // --- UI UPDATE FUNCTIONS ---
    const updateUIAfterLogin = (profile) => {
        loginForm.classList.add('hidden');

        // Create user panel if not exists
        if (!document.getElementById('user-panel-content')) {
            const panelContainer = document.createElement('div');
            panelContainer.id = 'user-panel-content';
            panelContainer.className = 'space-y-4';
            panelContainer.innerHTML = Templates.userPanel;
            loginForm.parentNode.insertBefore(panelContainer, loginForm.nextSibling);

            // Re-assign element variables
            greetingMsg = document.getElementById('greeting-msg');
            vipStatusElement = document.getElementById('vip-status');
            upgradeVipBtn = document.getElementById('upgrade-vip-btn');
            prerequisiteToggle = document.getElementById('prerequisite-toggle');
            prerequisiteToggleContainer = document.getElementById('prerequisite-toggle-container');
            fetchBtn = document.getElementById('fetch-schedule-btn');
            logoutBtn = document.getElementById('logout-btn');
            progressBarContainer = document.getElementById('progress-bar-container');
            progressBarElement = document.getElementById('progress-bar-element');
            progressBarText = document.getElementById('progress-bar-text');

            // Add event listeners
            if (fetchBtn) fetchBtn.originalHTML = fetchBtn.innerHTML;
            if (logoutBtn) logoutBtn.originalHTML = logoutBtn.innerHTML;
            fetchBtn.addEventListener('click', fetchFullSchedule);
            logoutBtn.addEventListener('click', handleLogout);
            upgradeVipBtn.addEventListener('click', showVIPModal);
        }

        greetingMsg.textContent = `Xin chào, ${profile.hoDem} ${profile.ten}!`;
        document.getElementById('user-panel-content').classList.remove('hidden');

        // Update VIP display
        updateVIPDisplay();
    };

    const resetUI = () => {
        loginForm.classList.remove('hidden');
        const panel = document.getElementById('user-panel-content');
        if (panel) panel.classList.add('hidden');

        scheduleContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Vui lòng đăng nhập để xem dữ liệu.</p>';
        registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Chưa có dữ liệu.</p>';
        logOutput.innerHTML = '';
        subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>';
        searchInput.value = '';
        Cache.allScheduleData = [];
        selectedClasses.clear();
        swapPendingClasses.clear();
        updateSelectedList();

        // Cleanup VIP module
        VIP.cleanup();
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
    // Save cached data to localStorage (delegate to Cache module)
    const saveCachedData = () => Cache.saveToStorage(userId);

    // Load cached data from localStorage (delegate to Cache module)
    const loadCachedData = (currentUserId) => Cache.loadFromStorage(currentUserId);

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
            
            // Save session to localStorage with JWT token
            localStorage.setItem('userSession', JSON.stringify({
                token: authToken,
                username: username,
                loginTime: new Date().getTime()
            }));
            
            log("✅ Đăng nhập thành công.");
            const initialData = await backendRequest('getInitialData');
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                userId = initialData.profile.maSinhVien || initialData.profile.username;
                vipStatus = initialData.vip || { hasVIP: false };
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                updateUIAfterLogin(initialData.profile);
                
                // Try to load cached data first (check if belongs to current user)
                const hasCachedData = loadCachedData(userId);
                
                if (hasCachedData) {
                    log('📦 Đã khôi phục dữ liệu từ cache');
                    
                    // Update UI with cached data
                    if (Cache.allScheduleData.length > 0) {
                        renderScheduleTable();
                        // Update button text to "Tải lại"
                        if (fetchBtn) {
                            const btnSpan = fetchBtn.querySelector('span');
                            if (btnSpan) btnSpan.textContent = 'Tải lại lịch học';
                            fetchBtn.originalHTML = fetchBtn.innerHTML;
                        }
                    }
                    
                    if (Cache.registeredClassesData.length > 0) {
                        renderRegisteredTable(Cache.registeredClassesData);
                    }
                    
                    if (selectedClasses.size > 0) {
                        updateSelectedList();
                    }
                } else {
                    // No cache, fetch fresh data
                    await fetchRegisteredClasses();
                }
                
                // Start VIP expiry check
                startVIPExpiryCheck();
            } else {
                log(`❌ Lỗi lấy dữ liệu ban đầu: ${initialData?.message || 'Không rõ'}`, true);
                authToken = null;
                localStorage.removeItem('userSession');
            }
        } else {
            log(`❌ Đăng nhập thất bại: ${tokenRes?.message || 'Lỗi không xác định'}`, true);
        }
        toggleLoading(loginBtn, false);
    };

    // Validate JWT token with portal API (via backend proxy to avoid CORS)
    const validateTokenWithPortal = async (token) => {
        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    action: 'validateToken'
                })
            });
            
            const data = await response.json();
            
            if (data.success && data.valid) {
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Token validation failed:', error);
            return false;
        }
    };

    // Auto-login with saved session
    const autoLogin = async () => {
        const session = localStorage.getItem('userSession');
        if (!session) return false;
        
        try {
            const { token, loginTime } = JSON.parse(session);
            
            // Session expires based on CONFIG
            if (new Date().getTime() - loginTime > CONFIG.SESSION_DURATION) {
                localStorage.removeItem('userSession');
                return false;
            }
            
            // Validate token with portal API
            const isValid = await validateTokenWithPortal(token);
            
            if (!isValid) {
                log('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', true);
                localStorage.removeItem('userSession');
                return false;
            }
            
            // Token is valid, restore session
            authToken = token;
            
            log('✅ Đã khôi phục phiên đăng nhập');
            
            const initialData = await backendRequest('getInitialData');
            if (initialData && initialData.success) {
                dotId = initialData.dot.id;
                userId = initialData.profile.maSinhVien || initialData.profile.username;
                vipStatus = initialData.vip || { hasVIP: false };
                log(`✅ Đã chọn đợt: ${initialData.dot.tenHocKy}`);
                updateUIAfterLogin(initialData.profile);
                
                // Try to load cached data first (check if belongs to current user)
                const hasCachedData = loadCachedData(userId);
                
                if (hasCachedData) {
                    log('📦 Đã khôi phục dữ liệu từ cache');
                    
                    // Update UI with cached data
                    if (Cache.allScheduleData.length > 0) {
                        renderScheduleTable();
                        // Update button text to "Tải lại"
                        if (fetchBtn) {
                            const btnSpan = fetchBtn.querySelector('span');
                            if (btnSpan) btnSpan.textContent = 'Tải lại lịch học';
                            fetchBtn.originalHTML = fetchBtn.innerHTML;
                        }
                    }
                    
                    if (Cache.registeredClassesData.length > 0) {
                        renderRegisteredTable(Cache.registeredClassesData);
                    }
                    
                    if (selectedClasses.size > 0) {
                        updateSelectedList();
                    }
                } else {
                    // No cache, fetch fresh data
                    await fetchRegisteredClasses();
                }
                
                // Start VIP expiry check
                startVIPExpiryCheck();
                
                return true;
            } else {
                log('❌ Không thể tải dữ liệu, vui lòng đăng nhập lại', true);
                localStorage.removeItem('userSession');
                authToken = null;
                return false;
            }
        } catch (error) {
            console.error('Auto-login failed:', error);
            localStorage.removeItem('userSession');
            return false;
        }
    };

    const handleLogout = async () => {
        await stopProcess();
        
        // Stop VIP expiry check
        stopVIPExpiryCheck();
        
        authToken = null;
        dotId = null;
        userId = null;
        vipStatus = { hasVIP: false };
        
        // Clear session and cache
        localStorage.removeItem('userSession');
        localStorage.removeItem('userDataCache');

        // Reset fetch button to its initial state for the next login
        if (fetchBtn) {
            const btnSpan = fetchBtn.querySelector('span');
            if (btnSpan) {
                btnSpan.textContent = 'Tải lịch học';
            }
            fetchBtn.originalHTML = fetchBtn.innerHTML;
        }

        resetUI();
        log("Đã đăng xuất.");
    };

    const fetchFullSchedule = async () => {
        if (!authToken) return log("Chưa đăng nhập.", true);
        if (!vipStatus.hasVIP) {
            log("⚠️ Bạn cần nâng cấp VIP để lấy dữ liệu lịch học.", true);
            return;
        }
        toggleLoading(fetchBtn, true);
        isProcessStopped = false;
        log("♻️ Bắt đầu lấy toàn bộ lịch học từ server...");

        const fetchPrerequisites = prerequisiteToggle?.checked || false;

        const scheduleRes = await backendRequest('getFullSchedule', { dotId, fetchPrerequisites, userId });

        if (scheduleRes && scheduleRes.success) {
            // Filter out locked classes from the schedule
            const totalClasses = scheduleRes.schedule.length;
            const unlockedClasses = scheduleRes.schedule.filter(cls => cls.tenTrangThai !== 'Đã khóa lớp');
            
            Cache.allScheduleData = unlockedClasses;
            Cache.subjectTypeMap = new Map(Object.entries(scheduleRes.subjectTypes));
            
            // Rebuild cache for fast lookups
            Cache.rebuildScheduleCache();
            
            log(`✅ Đã tải thành công ${totalClasses} lớp học phần.`);
            log(`📋 Hiển thị ${unlockedClasses.length} lớp chưa khóa (đã lọc bỏ ${totalClasses - unlockedClasses.length} lớp đã khóa).`);

            // Save to cache
            saveCachedData();

            // Update button's originalHTML to its new state before toggling loading off
            fetchBtn.originalHTML = fetchBtn.originalHTML.replace('Tải lịch học', 'Tải lại lịch học');

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
        // Always fetch prerequisites (set to true)
        const fetchPrerequisites = true;

        const registeredRes = await backendRequest('getRegisteredClasses', { dotId, fetchPrerequisites, userId });

        if (registeredRes && registeredRes.success) {
            Cache.registeredClassesData = registeredRes.body; // Save for conflict detection
            
            // Rebuild cache for fast lookups
            Cache.rebuildRegisteredCache();
            
            await renderRegisteredTable(registeredRes.body);
            
            // Save to cache
            saveCachedData();
            
            // Re-render schedule table to update conflict highlights
            renderScheduleTable();
            log(`✅ Tải danh sách đã đăng ký thành công (${registeredRes.body.length} lớp).`);
        } else {
            log("❌ Lỗi khi tải danh sách đã đăng ký.", true);
        }
        toggleLoading(refreshRegisteredBtn, false);
    };

    const cancelRegistration = async (registrationId, tenMonHoc, source) => {
        // Use custom confirmation modal instead of default confirm()
        showConfirmModal(
            `Bạn có chắc chắn muốn hủy môn học <strong>"${tenMonHoc}"</strong> không?<br><br>Hành động này không thể hoàn tác.`,
            async () => {
                // On confirm
                log(`Đang hủy môn ${tenMonHoc}...`);

                const result = await backendRequest('cancel', { registrationId, source });

                if (result && result.success) {
                    log(`✅ Hủy thành công.`);
                    await fetchRegisteredClasses();
                } else {
                    log(`❌ Hủy thất bại: ${result?.message || 'Lỗi'}`, true);
                }
            },
            () => {
                // On cancel - do nothing
                log(`Đã hủy thao tác hủy môn ${tenMonHoc}.`);
            }
        );
    };

    // Swap class function - Check target slot first, cancel old class, then register new class
    const swapClass = async (registeredData, targetData) => {
        const { id: regId, code: regCode, name: regName, source: regSource } = registeredData;
        const { id: targetId, code: targetCode, name: targetName, source: targetSource, maHocPhan: targetMaHocPhan } = targetData;
        
        log(`🔄 Bắt đầu đổi lớp: ${regName} (${regCode}) → ${targetName} (${targetCode})`);
        
        // Step 1: Check target class availability first
        log(`🔍 Kiểm tra lớp đích ${targetCode}...`);
        
        // Extract maHocPhan from targetCode if not available (remove last 2 characters)
        const maHocPhan = targetMaHocPhan || targetCode.slice(0, -2);
        
        const checkResult = await backendRequest('checkClassAvailability', { 
            classId: targetId, 
            dotId, 
            maHocPhan, 
            source: targetSource 
        });
        
        if (!checkResult || !checkResult.success) {
            log(`⚠️ Không thể kiểm tra lớp đích, dừng đổi lớp để an toàn`, true);
            return false;
        }
        
        if (checkResult.isFull) {
            log(`❌ Lớp ${targetCode} đã đầy (${checkResult.phanTramDangKy}%)`, true);
            return false;
        }
        
        if (!checkResult.canRegister) {
            log(`❌ Lớp ${targetCode} không thể đăng ký - ${checkResult.message}`, true);
            return false;
        }
        
        log(`✅ Lớp ${targetCode} còn chỗ (${checkResult.phanTramDangKy}%), tiếp tục đổi lớp...`);
        
        // Step 2: Cancel old registered class FIRST (before registering new one)
        log(`🗑️ Đang hủy lớp cũ ${regName} (${regCode})...`);
        const cancelResult = await backendRequest('cancel', { registrationId: regId, source: regSource });
        
        if (!cancelResult || !cancelResult.success) {
            log(`❌ Hủy lớp ${regCode} thất bại: ${cancelResult?.message || 'Lỗi không xác định'}`, true);
            return false;
        }
        
        log(`✅ Đã hủy lớp ${regCode} thành công`);
        
        // Step 3: Register target class (after canceling old one)
        log(`📝 Đang đăng ký lớp ${targetName} (${targetCode})...`);
        const registerResult = await backendRequest('register', { classId: targetId, source: targetSource });
        
        if (!registerResult || !registerResult.success) {
            log(`❌ Đăng ký lớp ${targetCode} thất bại: ${registerResult?.message || 'Lỗi không xác định'}`, true);
            log(`⚠️ CẢNH BÁO: Đã hủy lớp ${regCode} nhưng không đăng ký được lớp ${targetCode}. Vui lòng đăng ký lại thủ công!`, true);
            await fetchRegisteredClasses();
            return false;
        }
        
        log(`✅ Đăng ký lớp ${targetCode} thành công!`);
        log(`🎉 Đổi lớp hoàn tất: ${regName} → ${targetName}`);
        
        // Refresh registered classes list
        await fetchRegisteredClasses();
        
        return true;
    };

    const startInsertion = () => {
        if (!vipStatus.hasVIP) {
            log("⚠️ Bạn cần nâng cấp VIP để thực hiện chèn lớp.", true);
            return;
        }
        
        const totalClasses = selectedClasses.size + swapPendingClasses.size;
        if (totalClasses === 0) {
            return log("Vui lòng chọn lớp để chèn.", true);
        }
        
        stopProcess();
        isProcessStopped = false;
        toggleActionButtons(true);
        log("🚀 Bắt đầu quá trình chèn lớp...");

        const classesBySubject = new Map();
        const completedSubjects = new Set(); // Track completed subjects
        
        // Add regular selected classes
        selectedClasses.forEach(cls => {
            if (!classesBySubject.has(cls.maHocPhan)) classesBySubject.set(cls.maHocPhan, []);
            classesBySubject.get(cls.maHocPhan).push({ type: 'regular', class: cls });
        });
        
        // Add swap pending classes (only target classes for insertion)
        swapPendingClasses.forEach((swap, targetClassId) => {
            const targetClass = swap.target;
            if (!classesBySubject.has(targetClass.maHocPhan)) classesBySubject.set(targetClass.maHocPhan, []);
            classesBySubject.get(targetClass.maHocPhan).push({ 
                type: 'swap', 
                class: targetClass,
                registeredClass: swap.registered
            });
        });
        
        const delay = parseInt(delayInput.value, 10) || 1000;

        classesBySubject.forEach((classItems, maHocPhan) => {
            const tenMonHoc = classItems[0].class.tenMonHoc || maHocPhan;
            const source = classItems[0].class.source;

            const intervalId = setInterval(async () => {
                // Check if this subject already completed
                if (completedSubjects.has(maHocPhan)) {
                    clearInterval(intervalId);
                    registrationIntervals.delete(maHocPhan);
                    return;
                }
                if (isProcessStopped) return;
                const statusRes = await backendRequest('checkClassStatus', { dotId, maHocPhan, source });

                if (!statusRes || !statusRes.success) return;

                for (const availableClass of statusRes.body) {
                    const matchedItem = classItems.find(item => item.class.id.toString() === availableClass.id.toString());
                    
                    if (matchedItem && availableClass.phanTramDangKy < 100) {
                        if (matchedItem.type === 'swap') {
                            // Handle swap: cancel old class first, then register new class
                            const regClass = matchedItem.registeredClass;
                            log(`[${tenMonHoc}] 🔔 Đổi lớp: ${regClass.maLopHocPhan} → ${availableClass.maLopHocPhan}`);
                            
                            const swapResult = await swapClass(
                                {
                                    id: regClass.id,
                                    code: regClass.maLopHocPhan,
                                    name: regClass.tenMonHoc,
                                    source: regClass.source
                                },
                                {
                                    id: availableClass.id,
                                    code: availableClass.maLopHocPhan,
                                    name: availableClass.tenMonHoc,
                                    source: availableClass.source
                                }
                            );
                            
                            if (swapResult) {
                                log(`🎉 [${tenMonHoc}] ĐỔI LỚP THÀNH CÔNG! Dừng chèn cho môn này.`);
                                swapPendingClasses.delete(matchedItem.class.id.toString());
                                updateSelectedList();
                                
                                // Mark subject as completed to prevent further checks
                                completedSubjects.add(maHocPhan);
                                clearInterval(registrationIntervals.get(maHocPhan));
                                registrationIntervals.delete(maHocPhan);
                                break;
                            }
                        } else {
                            // Handle regular registration
                            log(`[${tenMonHoc}] 🔔 Phát hiện lớp còn chỗ: ${availableClass.maLopHocPhan}`);
                            const regResult = await backendRequest('register', { classId: availableClass.id, source });

                            if (regResult && regResult.success) {
                                log(`🎉 [${tenMonHoc}] ĐĂNG KÝ THÀNH CÔNG! Dừng chèn cho môn này.`);
                                clearInterval(registrationIntervals.get(maHocPhan));
                                registrationIntervals.delete(maHocPhan);
                                selectedClasses.delete(availableClass.id.toString());
                                await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                                if (registrationIntervals.size === 0) await stopProcess();
                                return;
                            } else {
                                log(`❌ [${tenMonHoc}] Chèn thất bại: ${regResult?.message || 'Lỗi'}`, true);
                            }
                        }
                    }
                }
            }, delay);
            registrationIntervals.set(maHocPhan, intervalId);
        });
    };

    const startRegistration = () => {
        if (!vipStatus.hasVIP) {
            log("⚠️ Bạn cần nâng cấp VIP để thực hiện đăng ký.", true);
            return;
        }
        
        const totalClasses = selectedClasses.size + swapPendingClasses.size;
        if (totalClasses === 0) {
            return log("Vui lòng chọn lớp để đăng ký.", true);
        }
        
        stopProcess();
        isProcessStopped = false;
        toggleActionButtons(true);
        log("🚀 Bắt đầu đăng ký liên tục...");

        const classesBySubject = new Map();
        const completedSubjects = new Set(); // Track completed subjects
        
        // Add regular selected classes
        selectedClasses.forEach(cls => {
            if (!classesBySubject.has(cls.maHocPhan)) classesBySubject.set(cls.maHocPhan, []);
            classesBySubject.get(cls.maHocPhan).push({ type: 'regular', class: cls });
        });
        
        // Add swap pending classes
        swapPendingClasses.forEach((swap, targetClassId) => {
            const targetClass = swap.target;
            if (!classesBySubject.has(targetClass.maHocPhan)) classesBySubject.set(targetClass.maHocPhan, []);
            classesBySubject.get(targetClass.maHocPhan).push({ 
                type: 'swap', 
                class: targetClass,
                registeredClass: swap.registered
            });
        });
        
        const delay = parseInt(delayInput.value, 10) || 1000;

        classesBySubject.forEach((classItems, maHocPhan) => {
            const tenMonHoc = classItems[0].class.tenMonHoc;

            const intervalId = setInterval(async () => {
                // Check if this subject already completed
                if (completedSubjects.has(maHocPhan)) {
                    clearInterval(intervalId);
                    registrationIntervals.delete(maHocPhan);
                    return;
                }
                if (isProcessStopped) return;
                
                for (const item of classItems) {
                    if (isProcessStopped) return;
                    
                    if (item.type === 'swap') {
                        // Handle swap registration
                        const regClass = item.registeredClass;
                        log(`[${tenMonHoc}] 🔄 Thử đổi lớp: ${regClass.maLopHocPhan} → ${item.class.maLopHocPhan}`);
                        
                        const swapResult = await swapClass(
                            {
                                id: regClass.id,
                                code: regClass.maLopHocPhan,
                                name: regClass.tenMonHoc,
                                source: regClass.source
                            },
                            {
                                id: item.class.id,
                                code: item.class.maLopHocPhan,
                                name: item.class.tenMonHoc,
                                source: item.class.source
                            }
                        );
                        
                        if (swapResult) {
                            swapPendingClasses.delete(item.class.id.toString());
                            await updateSelectedList();
                            
                            // Mark subject as completed to prevent further checks
                            completedSubjects.add(maHocPhan);
                            clearInterval(registrationIntervals.get(maHocPhan));
                            registrationIntervals.delete(maHocPhan);
                            if (registrationIntervals.size === 0) await stopProcess();
                            return;
                        }
                    } else {
                        // Handle regular registration
                        log(`[${tenMonHoc}] ⏳ Gửi yêu cầu đăng ký lớp ${item.class.maLopHocPhan}...`);
                        const result = await backendRequest('register', { classId: item.class.id, source: item.class.source });

                        if (result && (result.success || result.message === 'Bạn đã đăng ký môn này rồi.')) {
                            log(`🎉 [${tenMonHoc}] THÀNH CÔNG! Dừng đăng ký cho môn này.`);
                            clearInterval(registrationIntervals.get(maHocPhan));
                            registrationIntervals.delete(maHocPhan);
                            selectedClasses.delete(item.class.id.toString());
                            await Promise.all([fetchRegisteredClasses(), updateSelectedList(), renderScheduleTable()]);
                            if (registrationIntervals.size === 0) await stopProcess();
                            return;
                        } else if (result) {
                            log(`❌ [${tenMonHoc}] Thất bại: ${result.message}`, true);
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
        if (vipStatus.hasVIP) {
            startInsertionBtn.classList.toggle('hidden', isProcessing);
            startRegistrationBtn.classList.toggle('hidden', isProcessing);
        }
        stopBtn.classList.toggle('hidden', !isProcessing);
    };

    // --- RENDER FUNCTIONS ---
    const renderScheduleTable = async () => {
        const query = searchInput.value.toLowerCase();
        const selectedSubject = subjectFilter.value;
        if (Cache.allScheduleData.length > 0) {
            const subjects = [...new Set(Cache.allScheduleData.map(cls => cls.tenMonHoc))].sort();
            subjectFilter.innerHTML = '<option value="">Tất cả môn học</option>' + subjects.map(s => `<option value="${s}" ${s === selectedSubject ? 'selected' : ''}>${s}</option>`).join('');
        }
        // Show all classes including "Đã khóa lớp"
        const filteredData = Cache.allScheduleData.filter(cls =>
            (!selectedSubject || cls.tenMonHoc === selectedSubject) &&
            (`${cls.tenMonHoc} ${cls.maLopHocPhan} ${cls.maHocPhan}`.toLowerCase().includes(query))
        );
        if (filteredData.length === 0) {
            scheduleContainer.innerHTML = Templates.emptySchedule(Cache.allScheduleData.length > 0);
            return;
        }
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = Templates.scheduleTableHeader;
        const tbody = table.querySelector('tbody');
        filteredData.forEach(cls => {
            const row = document.createElement('tr');
            const isSelected = selectedClasses.has(cls.id.toString());
            
            // Check if class is locked
            const isLocked = cls.tenTrangThai === 'Đã khóa lớp';
            
            // Check for schedule conflict
            const conflictCheck = checkScheduleConflict(cls.scheduleDetails, Cache.registeredClassesData);
            const hasConflict = conflictCheck.hasConflict;
            
            // Build row class and cursor based on status
            let rowClass = 'bg-white border-b transition-colors duration-200';
            if (isLocked) {
                // Locked class - gray background, not clickable
                rowClass += ' bg-gray-200 cursor-not-allowed opacity-60';
            } else if (hasConflict) {
                // Conflict - red background, not clickable
                rowClass += ' bg-red-100 cursor-not-allowed';
            } else if (isSelected) {
                // Selected - blue background, clickable
                rowClass += ' bg-blue-200 cursor-pointer hover:bg-sky-100';
            } else {
                // Normal - white background, clickable
                rowClass += ' cursor-pointer hover:bg-sky-100';
            }
            
            row.className = rowClass;
            row.dataset.classId = cls.id;
            
            // Store locked status
            if (isLocked) {
                row.dataset.isLocked = 'true';
            }
            
            // Store conflict info for tooltip
            if (hasConflict) {
                row.dataset.hasConflict = 'true';
                row.dataset.conflictInfo = JSON.stringify(conflictCheck.conflicts);
            }
            
            const isBatBuoc = subjectTypeMap.get(cls.maHocPhan);
            const typeHtml = Templates.subjectTypeBadge(cls.source, isBatBuoc);
            
            // Add warnings below subject name (only conflict warning, not locked)
            let warnings = '';
            if (hasConflict) {
                const conflictItemsHtml = conflictCheck.conflicts.map(c => {
                    const regClass = getRegisteredByCode(c.registeredCode);
                    return Templates.conflictItem(c, regClass, cls);
                }).join('');
                
                warnings = Templates.conflictWarningBox(conflictItemsHtml);
            }
            
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900">${cls.tenMonHoc}${warnings}<div class="text-xs mt-1 text-gray-600">${formatScheduleDetail(cls.scheduleDetails)}</div></th>
                <td class="px-6 py-4" data-label="Mã LHP">${cls.maLopHocPhan}</td>
                <td class="px-6 py-4 whitespace-nowrap" data-label="Loại HP">${typeHtml}</td>
                <td class="px-6 py-4" data-label="Số TC">${cls.soTinChi === 0 ? '' : (cls.soTinChi ?? 'N/A')}</td>
                <td class="px-6 py-4" data-label="Trạng thái">${cls.tenTrangThai || 'N/A'}</td>
                <td class="px-6 py-4 font-semibold ${cls.phanTramDangKy >= 100 ? 'text-red-500' : 'text-green-500'}" data-label="Đã ĐK">${cls.phanTramDangKy}%</td>`;
            tbody.appendChild(row);
        });
        scheduleContainer.innerHTML = '';
        scheduleContainer.appendChild(table);
    };

    // Render module alias
    const Render = window.AppRender;

    const renderRegisteredTable = async (data) => {
        if (!data || data.length === 0) {
            registeredContainer.innerHTML = Render.emptyRegisteredTable();
            return;
        }
        const table = document.createElement('table');
        table.className = 'w-full text-sm text-left text-gray-500';
        table.innerHTML = Render.registeredTableHeader();
        const tbody = table.querySelector('tbody');
        data.forEach(reg => {
            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50';
            const sourceBadge = Templates.sourceBadge(reg.source);
            
            // Try to find maHocPhan from cache if not present in registered data
            let maHocPhan = reg.maHocPhan;
            if (!maHocPhan) {
                const matchingClass = getScheduleByCode(reg.maLopHocPhan);
                if (matchingClass) {
                    maHocPhan = matchingClass.maHocPhan;
                }
            }
            
            row.innerHTML = Render.registeredTableRow(reg, sourceBadge, formatScheduleDetail(reg.scheduleDetails), maHocPhan);
            tbody.appendChild(row);
        });
        registeredContainer.innerHTML = '';
        registeredContainer.appendChild(table);
    };

    // Show swap from conflict modal - allows swapping directly from conflict warning
    const showSwapFromConflictModal = async (registeredClassData, targetClassData) => {
        const { id: regId, code: regCode, name: regName, source: regSource } = registeredClassData;
        const { id: targetId, code: targetCode, name: targetName } = targetClassData;
        
        // Find registered class details using cache
        const registeredClass = getRegisteredById(regId);
        if (!registeredClass) {
            log('❌ Không tìm thấy thông tin lớp đã đăng ký', true);
            return;
        }
        
        // Find target class using cache
        const targetClass = getScheduleById(targetId);
        if (!targetClass) {
            log('❌ Không tìm thấy thông tin lớp đích', true);
            return;
        }
        
        // Show modal to confirm swap to the target class directly
        showConfirmModal(
            `Xác nhận đổi lớp trùng lịch?<br><br>` +
            `<div class="bg-gray-50 p-3 rounded mb-2">` +
            `<p class="text-sm"><span class="font-semibold text-red-600">Hủy:</span> ${regName} <span class="text-gray-500">(${regCode})</span></p>` +
            `<p class="text-sm"><span class="font-semibold text-green-600">Đăng ký:</span> ${targetName} <span class="text-gray-500">(${targetCode})</span></p>` +
            `</div>` +
            `<p class="text-sm text-gray-600">Lớp mới sẽ được thêm vào danh sách đổi lớp.</p>`,
            () => {
                // Remove old swap entry if exists and add new one
                Cache.removeSwapByRegisteredId(regId);
                Cache.addSwapPending(targetId, registeredClass, targetClass);
                
                log(`✅ Đã thêm vào danh sách đổi lớp: ${regName} (${regCode}) → ${targetName} (${targetCode})`);
                updateSelectedList();
                
                // Re-render schedule table to update conflict status
                renderScheduleTable();
            },
            () => {
                // On cancel - do nothing
            }
        );
    };

    // Show swap class modal from registered classes table
    const showSwapClassModal = async (registeredClassData) => {
        const { id: regId, code: regCode, name: regName, source: regSource, subjectCode, status: regStatus } = registeredClassData;
        
        // Find registered class details using cache
        const registeredClass = getRegisteredById(regId);
        if (!registeredClass) {
            log('❌ Không tìm thấy thông tin lớp đã đăng ký', true);
            return;
        }
        
        // Get subject code - try multiple sources (prioritize registeredClass data)
        let actualSubjectCode = subjectCode || registeredClass.maHocPhan;
        
        // If still not found, extract from maLopHocPhan by removing last 2 characters
        // Example: DT012301 -> DT0123, TT0401 -> TT04
        if (!actualSubjectCode && regCode) {
            actualSubjectCode = regCode.slice(0, -2);
            console.log('✅ Extracted maHocPhan from maLopHocPhan:', regCode, '->', actualSubjectCode);
        }
        
        // Last resort: search using cache
        if (!actualSubjectCode) {
            let matchingClass = getScheduleById(regId) || getScheduleByCode(regCode);
            if (matchingClass) {
                actualSubjectCode = matchingClass.maHocPhan;
                console.log('✅ Found maHocPhan from cache:', actualSubjectCode);
            }
        }
        
        if (!actualSubjectCode) {
            log('❌ Không tìm thấy mã học phần của lớp này', true);
            console.log('❌ Debug info:');
            console.log('  - Registered class data:', registeredClass);
            console.log('  - Tried to find with:', { regId, regCode });
            console.log('  - subjectCode from button:', subjectCode);
            return;
        }
        
        console.log('🔍 Looking for classes with maHocPhan:', actualSubjectCode);
        console.log('📊 Total classes in Cache.allScheduleData:', Cache.allScheduleData.length);
        console.log('🔍 Current class code (regCode):', regCode);
        
        // Try to find classes in Cache.allScheduleData first
        let availableClasses = Cache.allScheduleData.filter(cls => {
            const matches = cls.maHocPhan === actualSubjectCode && 
                cls.maLopHocPhan !== regCode &&
                cls.tenTrangThai !== 'Đã khóa lớp' &&
                cls.tenTrangThai !== 'Đang lên kế hoạch';
            
            if (cls.maHocPhan === actualSubjectCode) {
                console.log('  ➜ Same subject:', cls.maLopHocPhan, '| isCurrent:', cls.maLopHocPhan === regCode, '| Status:', cls.tenTrangThai, '| Match:', matches);
            }
            
            return matches;
        });
        
        console.log('Classes found in Cache.allScheduleData:', availableClasses.length);
        
        // If no classes found in cache, fetch from API
        if (availableClasses.length === 0) {
            log(`🔍 Không tìm thấy lớp trong cache, đang lấy từ API cho môn ${regName}...`);
            
            // Extract maHocPhan from maLopHocPhan: Remove last 2 characters
            // Example: DT012301 -> DT0123, TT0401 -> TT04
            let detectedMaHocPhan = actualSubjectCode;
            
            if (!detectedMaHocPhan || detectedMaHocPhan.length < 2) {
                detectedMaHocPhan = regCode.slice(0, -2);
                console.log('✅ Extracted maHocPhan from maLopHocPhan:', regCode, '->', detectedMaHocPhan);
            }
            
            console.log('🔍 Using maHocPhan for API call:', detectedMaHocPhan);
            
            const checkStatusRes = await backendRequest('checkClassStatus', { 
                dotId, 
                maHocPhan: detectedMaHocPhan, 
                source: regSource 
            });
            
            if (checkStatusRes && checkStatusRes.success && Array.isArray(checkStatusRes.body)) {
                // Get schedule details for each class (don't need to check availability again, data is already accurate)
                const classesWithDetails = await Promise.all(
                    checkStatusRes.body.map(async (cls) => {
                        const scheduleDetails = await backendRequest('getScheduleDetails', {
                            classId: cls.id,
                            source: regSource
                        });
                        
                        return {
                            ...cls,
                            maHocPhan: detectedMaHocPhan,
                            tenMonHoc: regName,
                            source: regSource,
                            scheduleDetails: scheduleDetails?.success ? scheduleDetails.body : { error: true }
                        };
                    })
                );
                
                // Filter out current registered class and locked/planning classes
                availableClasses = classesWithDetails.filter(cls => 
                    cls.maLopHocPhan !== regCode &&
                    cls.tenTrangThai !== 'Đã khóa lớp' &&
                    cls.tenTrangThai !== 'Đang lên kế hoạch'
                );
                
                console.log('Classes fetched from API:', availableClasses.length);
                log(`✅ Đã lấy ${availableClasses.length} lớp từ API`);
            } else {
                log(`❌ Không thể lấy danh sách lớp từ API`, true);
            }
        }
        
        if (availableClasses.length === 0) {
            log(`❌ Không có lớp nào khác để đổi cho môn ${regName} (Mã HP: ${actualSubjectCode})`, true);
            return;
        }
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'swap-class-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
        
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div class="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex justify-between items-center">
                    <div>
                        <h2 class="text-2xl font-bold">🔄 Đổi lớp học phần</h2>
                        <p class="text-sm text-blue-100 mt-1">Lớp hiện tại: ${regName} (${regCode})</p>
                    </div>
                    <button id="close-swap-modal" class="text-white hover:text-gray-200 transition">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                
                <div class="p-6 overflow-y-auto flex-1">
                    <div class="mb-4 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
                        <p class="text-sm text-gray-700">
                            <span class="font-bold">📋 Lịch học hiện tại:</span><br>
                            <div class="mt-2 text-gray-600">${formatScheduleDetail(registeredClass.scheduleDetails)}</div>
                        </p>
                    </div>
                    
                    <h3 class="text-lg font-bold text-gray-800 mb-3">Chọn lớp muốn đổi đến:</h3>
                    
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm text-left text-gray-500">
                            <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                                <tr>
                                    <th scope="col" class="px-4 py-3">Mã LHP</th>
                                    <th scope="col" class="px-4 py-3">Lịch học</th>
                                    <th scope="col" class="px-4 py-3">Trạng thái</th>
                                    <th scope="col" class="px-4 py-3">Đã ĐK</th>
                                    <th scope="col" class="px-4 py-3">Hành động</th>
                                </tr>
                            </thead>
                            <tbody id="swap-classes-tbody"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Render available classes
        const tbody = modal.querySelector('#swap-classes-tbody');
        availableClasses.forEach(cls => {
            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50';
            
            // Check if schedules conflict
            const hasConflict = checkScheduleConflictBetweenTwo(registeredClass.scheduleDetails, cls.scheduleDetails);
            const conflictBadge = hasConflict 
                ? '<span class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">⚠️ Trùng lịch</span>' 
                : '<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">✓ Không trùng</span>';
            
            const isFull = cls.phanTramDangKy >= 100;
            const statusColor = isFull ? 'text-red-600 font-bold' : 'text-green-600';
            
            row.innerHTML = `
                <td class="px-4 py-3 font-medium">${cls.maLopHocPhan}</td>
                <td class="px-4 py-3">
                    <div class="text-xs">${formatScheduleDetail(cls.scheduleDetails)}</div>
                </td>
                <td class="px-4 py-3">${cls.tenTrangThai || 'N/A'}</td>
                <td class="px-4 py-3 ${statusColor}">${cls.phanTramDangKy}%</td>
                <td class="px-4 py-3">
                    <div class="flex flex-col gap-2">
                        ${conflictBadge}
                        <button class="execute-swap-btn px-3 py-1 text-xs font-semibold rounded transition bg-blue-600 text-white hover:bg-blue-700"
                                data-target-id="${cls.id}"
                                data-target-code="${cls.maLopHocPhan}"
                                data-target-name="${cls.tenMonHoc}"
                                data-target-source="${cls.source}"
                                data-has-conflict="${hasConflict}">
                            🔄 Đổi lớp
                        </button>
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        // Close modal handler
        modal.querySelector('#close-swap-modal').addEventListener('click', () => {
            modal.remove();
        });
        
        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        // Execute swap handler
        modal.querySelectorAll('.execute-swap-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const targetId = btn.dataset.targetId;
                const targetCode = btn.dataset.targetCode;
                const targetName = btn.dataset.targetName;
                const targetSource = btn.dataset.targetSource;
                const hasConflict = btn.dataset.hasConflict === 'true';
                
                // Find target class full info from availableClasses (not allScheduleData)
                const targetClass = availableClasses.find(c => c.id.toString() === targetId);
                if (!targetClass) {
                    alert('❌ Không tìm thấy thông tin lớp đích');
                    console.log('❌ Debug: targetId =', targetId);
                    console.log('❌ Available classes:', availableClasses.map(c => ({ id: c.id, code: c.maLopHocPhan })));
                    return;
                }
                
                // Find registered class full info using cache
                const registeredClassFull = getRegisteredById(regId);
                if (!registeredClassFull) {
                    log('❌ Không tìm thấy thông tin lớp đã đăng ký', true);
                    return;
                }
                
                const conflictWarning = hasConflict 
                    ? '<div class="mb-3 p-3 bg-yellow-50 border-l-4 border-yellow-500 rounded"><p class="text-sm text-yellow-800 font-semibold">⚠️ CẢNH BÁO: Lớp này trùng lịch với lớp hiện tại!</p></div>'
                    : '';
                
                const slotInfo = targetClass.phanTramDangKy >= 100 
                    ? '<p class="text-sm text-orange-600 mt-2">⏳ Lớp đích đang đầy, hệ thống sẽ tự động chờ và đổi khi có chỗ trống.</p>'
                    : '<p class="text-sm text-green-600 mt-2">✅ Lớp đích còn chỗ, sẽ đổi ngay khi bắt đầu chèn/đăng ký.</p>';
                
                const confirmMsg = `
                    ${conflictWarning}
                    <p class="text-gray-700 mb-2">Xác nhận thêm vào danh sách đổi lớp?</p>
                    <div class="bg-gray-50 p-3 rounded mb-2">
                        <p class="text-sm"><span class="font-semibold text-red-600">Hủy:</span> ${regName} <span class="text-gray-500">(${regCode})</span></p>
                        <p class="text-sm"><span class="font-semibold text-green-600">Đăng ký:</span> ${targetName} <span class="text-gray-500">(${targetCode})</span></p>
                    </div>
                    ${slotInfo}
                `;
                
                showConfirmModal(
                    confirmMsg,
                    () => {
                        // Remove old swap entry if exists
                        const oldSwapKey = Cache.removeSwapByRegisteredId(regId);
                        
                        // Add new swap entry with target class ID as key
                        Cache.addSwapPending(targetId, registeredClassFull, targetClass);
                        
                        if (oldSwapKey) {
                            log(`✅ Đã cập nhật đổi lớp: ${regName} (${regCode}) → ${targetName} (${targetCode})`);
                        } else {
                            log(`✅ Đã thêm vào danh sách đổi lớp: ${regName} (${regCode}) → ${targetName} (${targetCode})`);
                        }
                        
                        if (targetClass.phanTramDangKy >= 100) {
                            log(`⏳ Lớp đích đang đầy (${targetClass.phanTramDangKy}%), hệ thống sẽ tự động chờ cho đến khi có chỗ trống`);
                        }
                        
                        updateSelectedList();
                        modal.remove();
                    },
                    () => {
                        // On cancel - do nothing
                    }
                );
            });
        });
    };

    const updateSelectedList = async () => {
        if (!vipStatus.hasVIP) {
            selectedList.innerHTML = Templates.emptySelectedList(false);
            registrationControls.classList.add('hidden');
            return;
        }
        
        const totalCount = selectedClasses.size + swapPendingClasses.size;
        
        if (totalCount === 0) {
            selectedList.innerHTML = Templates.emptySelectedList(true);
            registrationControls.classList.add('hidden');
            saveCachedData();
            return;
        }
        
        let html = '';
        
        // Render regular selected classes
        selectedClasses.forEach(cls => {
            const sourceBadge = Templates.sourceBadge(cls.source);
            html += Templates.selectedClassItem(cls, formatSelectedClassDetail(cls, cls.scheduleDetails), sourceBadge);
        });
        
        // Render swap pending classes
        swapPendingClasses.forEach((swap, targetClassId) => {
            const { registered: registeredClass, target: targetClass } = swap;
            const regSourceBadge = Templates.sourceBadge(registeredClass.source);
            const targetSourceBadge = Templates.sourceBadge(targetClass.source);
            
            html += `
                <div class="flex justify-between items-center bg-yellow-50 border-2 border-yellow-400 p-2 rounded-md hover:bg-yellow-100">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            ${Templates.swapIcon}
                            <span class="text-xs font-bold text-yellow-800 uppercase">Đổi lớp</span>
                        </div>
                        <div class="mb-1">
                            <p class="font-semibold text-sm text-gray-500 line-through decoration-2">${registeredClass.tenMonHoc} ${regSourceBadge}</p>
                            <div class="text-xs text-gray-400 line-through mt-1">${formatSelectedClassDetail(registeredClass, registeredClass.scheduleDetails)}</div>
                        </div>
                        <div class="flex items-center gap-2 my-1">
                            <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
                            </svg>
                            <span class="text-xs font-semibold text-green-700">Đổi sang</span>
                        </div>
                        <div>
                            <p class="font-semibold text-sm text-green-800">${targetClass.tenMonHoc} ${targetSourceBadge}</p>
                            <div class="text-xs text-gray-600 mt-1">${formatSelectedClassDetail(targetClass, targetClass.scheduleDetails)}</div>
                        </div>
                    </div>
                    <button data-target-class-id="${targetClassId}" class="remove-swap-btn text-red-500 hover:text-red-700 ml-2 flex-shrink-0">&times;</button>
                </div>`;
        });
        
        selectedList.innerHTML = html;
        registrationControls.classList.remove('hidden');
        
        // Save to cache whenever selection changes
        saveCachedData();
    };

    // --- EVENT LISTENERS ---
    
    // Initialize VIP module
    initVIPModule();
    
    // Guide button
    const guideBtn = document.getElementById('guide-btn');
    if (guideBtn) {
        guideBtn.addEventListener('click', showGuideModal);
    }
    
    // Try auto-login on page load
    autoLogin().then(success => {
        if (!success) {
            // Show login form if auto-login failed
            loginForm.classList.remove('hidden');
        }
    });
    
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
            // Check if class is locked
            if (scheduleRow.dataset.isLocked === 'true') {
                log('🔒 Không thể chọn lớp này vì đã bị khóa', true);
                return;
            }
            
            // Check if row has conflict
            if (scheduleRow.dataset.hasConflict === 'true') {
                const conflicts = JSON.parse(scheduleRow.dataset.conflictInfo);
                const conflictList = conflicts.map((conflict, idx) => {
                    const details = conflict.uniqueConflicts.map(c => 
                        `${c.day}, Tiết ${c.conflictPeriod}`
                    ).join(' và ');
                    return `${idx + 1}. ${conflict.registeredClass} (${conflict.registeredCode}) - ${details}`;
                }).join('\n');
                
                log(`⚠️ KHÔNG THỂ CHỌN LỚP NÀY\n\n🔴 Trùng lịch học với ${conflicts.length} môn đã đăng ký:\n\n${conflictList}\n\n💡 Vui lòng chọn lớp khác hoặc hủy đăng ký lớp bị trùng.`, true);
                return;
            }
            
            if (!vipStatus.hasVIP) {
                log("⚠️ Bạn cần nâng cấp VIP để chọn lớp.", true);
                return;
            }
            const classId = scheduleRow.dataset.classId;
            const cls = getScheduleById(classId);
            if (!cls) return;
            if (selectedClasses.has(classId)) selectedClasses.delete(classId);
            else selectedClasses.set(classId, cls);
            scheduleRow.classList.toggle('bg-blue-200');
            updateSelectedList();
        }
        const removeBtn = e.target.closest('.remove-selected-btn');
        if (removeBtn) {
            if (!vipStatus.hasVIP) {
                log("⚠️ Bạn cần nâng cấp VIP để chỉnh sửa danh sách lớp.", true);
                return;
            }
            const classId = removeBtn.dataset.classId;
            selectedClasses.delete(classId);
            const rowToUpdate = document.querySelector(`#schedule-container tr[data-class-id='${classId}']`);
            if (rowToUpdate) rowToUpdate.classList.remove('bg-blue-200');
            updateSelectedList();
        }
        
        const removeSwapBtn = e.target.closest('.remove-swap-btn');
        if (removeSwapBtn) {
            if (!vipStatus.hasVIP) {
                log("⚠️ Bạn cần nâng cấp VIP để chỉnh sửa danh sách lớp.", true);
                return;
            }
            const targetClassId = removeSwapBtn.dataset.targetClassId;
            swapPendingClasses.delete(targetClassId);
            updateSelectedList();
            log("🗑️ Đã hủy yêu cầu đổi lớp");
        }
        
        const cancelBtn = e.target.closest('.cancel-btn');
        if (cancelBtn) {
            const { regId, tenMon, source } = cancelBtn.dataset;
            cancelRegistration(regId, tenMon, source);
        }
        
        const swapFromRegisteredBtn = e.target.closest('.swap-from-registered-btn');
        if (swapFromRegisteredBtn) {
            const registeredData = {
                id: swapFromRegisteredBtn.dataset.regId,
                code: swapFromRegisteredBtn.dataset.regCode,
                name: swapFromRegisteredBtn.dataset.regName,
                source: swapFromRegisteredBtn.dataset.regSource,
                subjectCode: swapFromRegisteredBtn.dataset.regSubjectCode,
                status: swapFromRegisteredBtn.dataset.regStatus
            };
            
            showSwapClassModal(registeredData);
        }
        
        const swapFromConflictBtn = e.target.closest('.swap-from-conflict-btn');
        if (swapFromConflictBtn) {
            // Prevent row selection when clicking swap button
            e.stopPropagation();
            
            if (!vipStatus.hasVIP) {
                log("⚠️ Bạn cần nâng cấp VIP để sử dụng chức năng đổi lớp.", true);
                return;
            }
            
            const registeredData = {
                id: swapFromConflictBtn.dataset.regId,
                code: swapFromConflictBtn.dataset.regCode,
                name: swapFromConflictBtn.dataset.regName,
                source: swapFromConflictBtn.dataset.regSource,
                subjectCode: swapFromConflictBtn.dataset.regSubjectCode,
                status: swapFromConflictBtn.dataset.regStatus
            };
            
            const targetData = {
                id: swapFromConflictBtn.dataset.targetId,
                code: swapFromConflictBtn.dataset.targetCode,
                name: swapFromConflictBtn.dataset.targetName
            };
            
            showSwapFromConflictModal(registeredData, targetData);
        }
        
        const swapBtn = e.target.closest('.swap-class-btn');
        if (swapBtn) {
            const registeredData = {
                id: swapBtn.dataset.registeredId,
                code: swapBtn.dataset.registeredCode,
                name: swapBtn.dataset.registeredName,
                source: swapBtn.dataset.registeredSource
            };
            const targetData = {
                id: swapBtn.dataset.targetId,
                code: swapBtn.dataset.targetCode,
                name: swapBtn.dataset.targetName,
                source: swapBtn.dataset.targetSource
            };
            
            // Find full class objects using cache
            const registeredClass = getRegisteredById(registeredData.id);
            const targetClass = getScheduleById(targetData.id);
            
            if (!registeredClass || !targetClass) {
                log("❌ Không tìm thấy thông tin đầy đủ của lớp", true);
                return;
            }
            
            // Use helper function to validate swap
            const swapValidation = canSwapClass(registeredClass, targetClass);
            if (!swapValidation.canSwap) {
                log(`❌ Không thể đổi lớp ${registeredData.code} - ${swapValidation.reason}`, true);
                return;
            }
            
            // All validations passed - add to swap pending list
            swapPendingClasses.set(targetData.id, {
                registered: registeredClass,
                target: targetClass
            });
            
            log(`✅ Đã thêm yêu cầu đổi lớp: ${registeredData.name} → ${targetData.name}`);
            log(`📋 Trạng thái: ${registeredStatus} → ${targetStatus}`);
            updateSelectedList();
            
            // Close tooltip
            if (tooltipElement) {
                tooltipElement.remove();
                tooltipElement = null;
            }
        }
    });

    // Add hover tooltip for conflict rows
    let tooltipElement = null;
    
    document.addEventListener('mouseover', (e) => {
        const scheduleRow = e.target.closest('#schedule-container tr');
        if (scheduleRow && scheduleRow.dataset.hasConflict === 'true') {
            // Remove existing tooltip
            if (tooltipElement) {
                tooltipElement.remove();
                tooltipElement = null;
            }
            
            // Create tooltip
            const conflicts = JSON.parse(scheduleRow.dataset.conflictInfo);
            const targetClassId = scheduleRow.dataset.classId;
            const targetClass = getScheduleById(targetClassId);
            
            const conflictMessages = conflicts.map(conflict => {
                // Format all unique conflicts for this class
                const conflictDetails = conflict.uniqueConflicts.map(c => 
                    `<div class="flex items-center gap-2 mt-1.5 text-xs text-red-100">
                        <span class="flex items-center gap-1">
                            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/>
                            </svg>
                            ${c.day}
                        </span>
                        <span class="flex items-center gap-1">
                            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
                            </svg>
                            Tiết ${c.conflictPeriod}
                        </span>
                    </div>`
                ).join('');
                
                // Find the registered class using cache
                const registeredClass = getRegisteredByCode(conflict.registeredCode);
                
                // Use helper function to check swap eligibility
                const swapValidation = canSwapClass(registeredClass, targetClass);
                
                const swapButton = swapValidation.canSwap ? 
                    `<button class="swap-class-btn mt-2 w-full bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-semibold py-1.5 px-3 rounded transition duration-200 flex items-center justify-center gap-1"
                            data-registered-id="${registeredClass.id}"
                            data-registered-code="${conflict.registeredCode}"
                            data-registered-name="${conflict.registeredClass}"
                            data-registered-source="${registeredClass.source}"
                            data-target-id="${targetClassId}"
                            data-target-code="${targetClass?.maLopHocPhan || ''}"
                            data-target-name="${targetClass?.tenMonHoc || ''}"
                            data-target-source="${targetClass?.source || ''}">
                        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z"/>
                        </svg>
                        Đổi lớp
                    </button>` 
                    : `<p class="mt-2 text-xs text-yellow-300">⚠️ Không thể đổi: ${swapValidation.reason}</p>`;
                
                return `<div class="py-2 border-b border-red-500 last:border-0">
                    <div class="flex items-start gap-2">
                        <span class="text-red-200 text-lg flex-shrink-0">📚</span>
                        <div class="flex-1">
                            <p class="font-semibold text-white">${conflict.registeredClass}</p>
                            <p class="text-xs text-red-100 mt-1">Mã LHP: ${conflict.registeredCode}</p>
                            ${conflictDetails}
                            ${swapButton}
                        </div>
                    </div>
                </div>`;
            }).join('');
            
            tooltipElement = document.createElement('div');
            tooltipElement.className = 'fixed bg-gradient-to-br from-red-600 to-red-700 text-white px-4 py-3 rounded-xl shadow-2xl z-50 max-w-md border-2 border-red-500';
            tooltipElement.innerHTML = `
                <div class="flex items-center gap-2 mb-3 pb-2 border-b border-red-500">
                    <svg class="w-6 h-6 text-yellow-300" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                    </svg>
                    <span class="font-bold text-lg">TRÙNG LỊCH HỌC</span>
                </div>
                ${conflictMessages}
                <div class="mt-3 pt-2 text-xs text-red-100">
                    💡 Tip: Chọn lớp học khác hoặc hủy đăng ký lớp bị trùng
                </div>
            `;
            
            document.body.appendChild(tooltipElement);
            
            // Position tooltip near cursor
            const updateTooltipPosition = (event) => {
                const x = event.clientX + 15;
                const y = event.clientY + 15;
                tooltipElement.style.left = x + 'px';
                tooltipElement.style.top = y + 'px';
            };
            
            updateTooltipPosition(e);
            scheduleRow.addEventListener('mousemove', updateTooltipPosition);
            scheduleRow.addEventListener('mouseleave', () => {
                if (tooltipElement) {
                    tooltipElement.remove();
                    tooltipElement = null;
                }
            });
        }
    });
});
