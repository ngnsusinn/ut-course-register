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
    let userPanel, greetingMsg, prerequisiteToggle, fetchBtn, logoutBtn, progressBarContainer, progressBarElement, progressBarText;
    let paymentBtn, paymentModal;

    // State
    let authToken = null;
    let dotId = null;
    let allScheduleData = [];
    let selectedClasses = new Map();
    let subjectTypeMap = new Map();
    let registrationIntervals = new Map();
    let isProcessStopped = false;
    let currentUser = null;

    // Check for payment status in URL
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    if (paymentStatus) {
        if (paymentStatus === 'success') {
            showNotification('✅ Thanh toán học phí thành công!', 'success');
        } else {
            showNotification('❌ Thanh toán thất bại. Vui lòng thử lại.', 'error');
        }
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
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

    const showNotification = (message, type = 'info') => {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
            type === 'success' ? 'bg-green-500' : 
            type === 'error' ? 'bg-red-500' : 'bg-blue-500'
        } text-white`;
        notification.innerHTML = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
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

	// --------- LOGIN HANDLER (thêm vào) ----------
const handleLogin = async (evt) => {
  evt && evt.preventDefault && evt.preventDefault();
  if (!loginBtn) return;
  const username = usernameInput?.value?.trim() || '';
  const password = passwordInput?.value || '';

  if (!username || !password) {
    showNotification('Vui lòng nhập tên đăng nhập và mật khẩu', 'error');
    return;
  }

  toggleLoading(loginBtn, true);
  log('🔐 Đang đăng nhập...');

  // Gọi backend; backendRequest trả về object hoặc null
  const res = await backendRequest('login', { username, password });

  // Nếu backend không có action 'login', thử các biến thể thông dụng
  let result = res;
  if (!result) {
    log('❌ Không nhận được phản hồi từ backend khi gọi "login".', true);
    toggleLoading(loginBtn, false);
    return;
  }

  // Kiểm tra token / thành công
  const token = result.token || result.authToken || result.accessToken || result.data?.token;
  const profile = result.profile || result.user || result.data?.user || result.data || result;

  if (token) {
    authToken = token;
    updateUIAfterLogin(profile);
    showNotification('Đăng nhập thành công', 'success');
    log('✅ Đăng nhập thành công');
  } else if (result.success) {
    // một số backend trả success + user nhưng token ở khác chỗ
    authToken = result.token || result.authToken || null;
    updateUIAfterLogin(profile);
    showNotification('Đăng nhập có vẻ thành công', 'success');
    log('✅ Đăng nhập (success = true)');
  } else {
    const msg = result.message || result.error || 'Sai thông tin đăng nhập hoặc lỗi server';
    showNotification('Đăng nhập thất bại: ' + msg, 'error');
    log('❌ Đăng nhập thất bại: ' + msg, true);
  }

  toggleLoading(loginBtn, false);
};

// Gắn event cho nút và cho phím Enter (username/password)
if (loginBtn) loginBtn.addEventListener('click', handleLogin);
if (passwordInput) passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(e); });
if (usernameInput) usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(e); });
// -----------------------------------------------

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

    const calculateTuitionFee = () => {
        let totalCredits = 0;
        let totalFee = 0;
        const creditPrice = 420000; // Giá mỗi tín chỉ

        selectedClasses.forEach(cls => {
            const credits = parseInt(cls.soTinChi) || 0;
            totalCredits += credits;
        });
        
        totalFee = totalCredits * creditPrice;
        return { totalCredits, totalFee };
    };
    
    // --- UI UPDATE FUNCTIONS ---
    const updateUIAfterLogin = (profile) => {
        currentUser = profile;
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
                 <div id="progress-bar-container" class="my-4 hidden">
                    <div class="w-full bg-gray-200 rounded-full h-2.5"><div id="progress-bar-element" class="bg-blue-600 h-2.5 rounded-full" style="width: 0%"></div></div>
                    <p id="progress-bar-text" class="text-center text-sm text-gray-600 mt-1"></p>
                </div>
                <button id="fetch-schedule-btn" class="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition duration-300 flex items-center justify-center space-x-2"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm4 14a1 1 0 100-2 1 1 0 000 2zM6 5a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" /></svg><span>Lấy dữ liệu</span></button>
                <button id="payment-btn" class="w-full bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700 transition duration-300 flex items-center justify-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                        <path fill-rule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clip-rule="evenodd" />
                    </svg>
                    <span>Thanh toán học phí</span>
                </button>
                <button id="logout-btn" class="w-full bg-gray-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-gray-700 transition duration-300">Đăng xuất</button>
            `;
            loginForm.parentNode.insertBefore(panelContainer, loginForm.nextSibling);

            // Re-assign element variables
            greetingMsg = document.getElementById('greeting-msg');
            prerequisiteToggle = document.getElementById('prerequisite-toggle');
            fetchBtn = document.getElementById('fetch-schedule-btn');
            paymentBtn = document.getElementById('payment-btn');
            logoutBtn = document.getElementById('logout-btn');
            progressBarContainer = document.getElementById('progress-bar-container');
            progressBarElement = document.getElementById('progress-bar-element');
            progressBarText = document.getElementById('progress-bar-text');

            // Add event listeners
            fetchBtn.originalHTML = fetchBtn.innerHTML;
            paymentBtn.originalHTML = paymentBtn.innerHTML;
            logoutBtn.originalHTML = logoutBtn.innerHTML;
            fetchBtn.addEventListener('click', fetchFullSchedule);
            paymentBtn.addEventListener('click', showPaymentModal);
            logoutBtn.addEventListener('click', handleLogout);
        }
        
        greetingMsg.textContent = `Xin chào, ${profile.hoDem} ${profile.ten}!`;
        document.getElementById('user-panel-content').style.display = 'block';
    };

    const showPaymentModal = () => {
        const { totalCredits, totalFee } = calculateTuitionFee();
        
        // Create modal if not exists
        if (!document.getElementById('payment-modal')) {
            const modal = document.createElement('div');
            modal.id = 'payment-modal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center hidden';
            modal.innerHTML = `
                <div class="bg-white rounded-xl p-6 max-w-md w-full mx-4">
                    <h2 class="text-2xl font-bold text-gray-800 mb-4">Thanh toán học phí</h2>
                    
                    <div class="space-y-4 mb-6">
                        <div class="bg-blue-50 p-4 rounded-lg">
                            <p class="text-sm text-gray-600">Tổng số tín chỉ:</p>
                            <p class="text-xl font-semibold text-blue-600">${totalCredits} tín chỉ</p>
                        </div>
                        
                        <div class="bg-green-50 p-4 rounded-lg">
                            <p class="text-sm text-gray-600">Tổng học phí:</p>
                            <p class="text-2xl font-bold text-green-600">${totalFee.toLocaleString('vi-VN')} VNĐ</p>
                        </div>
                        
                        <div class="bg-yellow-50 p-3 rounded-lg">
                            <p class="text-xs text-yellow-800">
                                <strong>Lưu ý:</strong> Học phí tính theo số tín chỉ đã chọn. 
                                Giá mỗi tín chỉ: 420.000 VNĐ
                            </p>
                        </div>
                    </div>
                    
                    <div class="space-y-3">
                        <h3 class="font-semibold text-gray-700">Chọn phương thức thanh toán:</h3>
                        
                        <label class="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                            <input type="radio" name="bankCode" value="" checked class="text-blue-600">
                            <span>Cổng thanh toán VNPAYQR</span>
                        </label>
                        
                        <label class="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                            <input type="radio" name="bankCode" value="VNPAYQR" class="text-blue-600">
                            <span>Thanh toán qua ứng dụng hỗ trợ VNPAYQR</span>
                        </label>
                        
                        <label class="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                            <input type="radio" name="bankCode" value="VNBANK" class="text-blue-600">
                            <span>Thanh toán qua ATM-Tài khoản ngân hàng nội địa</span>
                        </label>
                        
                        <label class="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                            <input type="radio" name="bankCode" value="INTCARD" class="text-blue-600">
                            <span>Thanh toán qua thẻ quốc tế</span>
                        </label>
                    </div>
                    
                    <div class="flex space-x-3 mt-6">
                        <button id="confirm-payment-btn" class="flex-1 bg-green-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-green-700 transition">
                            Xác nhận thanh toán
                        </button>
                        <button id="cancel-payment-btn" class="flex-1 bg-gray-300 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-400 transition">
                            Hủy bỏ
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Add event listeners for payment modal
            document.getElementById('confirm-payment-btn').addEventListener('click', processPayment);
            document.getElementById('cancel-payment-btn').addEventListener('click', () => {
                document.getElementById('payment-modal').classList.add('hidden');
            });
        }
        
        // Update modal content with current data
        const modal = document.getElementById('payment-modal');
        modal.querySelector('.text-xl.font-semibold.text-blue-600').textContent = `${totalCredits} tín chỉ`;
        modal.querySelector('.text-2xl.font-bold.text-green-600').textContent = `${totalFee.toLocaleString('vi-VN')} VNĐ`;
        
        // Show modal
        modal.classList.remove('hidden');
    };

    const processPayment = async () => {
        const { totalFee } = calculateTuitionFee();
        const bankCode = document.querySelector('input[name="bankCode"]:checked').value;
        
        toggleLoading(document.getElementById('confirm-payment-btn'), true);
        log('🔄 Đang tạo liên kết thanh toán VNPAY...');
        
        const selectedClassesList = Array.from(selectedClasses.values())
            .map(cls => `${cls.tenMonHoc} (${cls.maLopHocPhan})`)
            .join(', ');
        
        const orderInfo = `Thanh toan hoc phi UTH - ${currentUser.hoDem} ${currentUser.ten} - ${selectedClassesList}`;
        
        const result = await backendRequest('createPaymentUrl', {
            amount: totalFee,
            orderInfo: orderInfo.substring(0, 255), // Limit to 255 characters
            bankCode: bankCode,
            language: 'vn',
            userId: currentUser.id || currentUser.maSinhVien
        });
        
        if (result && result.success && result.paymentUrl) {
            log('✅ Đã tạo liên kết thanh toán. Đang chuyển hướng...');
            // Store payment info in sessionStorage for later reference
            sessionStorage.setItem('pendingPayment', JSON.stringify({
                orderId: result.orderId,
                amount: totalFee,
                timestamp: new Date().toISOString()
            }));
            // Redirect to VNPAY
            window.location.href = result.paymentUrl;
        } else {
            log('❌ Lỗi tạo liên kết thanh toán: ' + (result?.message || 'Unknown error'), true);
            toggleLoading(document.getElementById('confirm-payment-btn'), false);
        }
    };