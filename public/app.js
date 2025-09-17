document.addEventListener('DOMContentLoaded', () => {
    // === CÁC BIẾN DOM ELEMENT (KHÔNG THAY ĐỔI) ===
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const logOutput = document.getElementById('log-output');
    const statusEl = document.getElementById('status');
    const userNameEl = document.getElementById('user-name');
    const dotDkhpEl = document.getElementById('dot-dkhp');
    const classIdsInput = document.getElementById('class-ids');
    const intervalInput = document.getElementById('interval');
    const refreshBtn = document.getElementById('refresh-registered-btn');
    const registeredContainer = document.getElementById('registered-container');
    const donateBtn = document.getElementById('donate-btn');
    const donationAmountInput = document.getElementById('donation-amount');
    // Thêm biến cho container alert mới
    const alertContainer = document.getElementById('alert-container');

    let token = null;
    let dotId = null;
    let registrationInterval = null;

    // --- CÁC HÀM TIỆN ÍCH ---

    function log(message, isError = false) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.innerHTML = `<span class="text-gray-500">${timestamp}:</span> ${message}`;
        if (isError) {
            logEntry.classList.add('text-red-400');
        } else {
            logEntry.classList.add('text-green-400');
        }
        logOutput.appendChild(logEntry);
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    // ===== HÀM HIỂN THỊ THÔNG BÁO MỚI =====
    function showAlert(message, type = 'success') {
        // Xác định màu sắc dựa trên loại thông báo
        const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
        const icon = type === 'success' 
            ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>` 
            : `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;

        const alertDiv = document.createElement('div');
        alertDiv.className = `p-4 ${bgColor} text-white rounded-lg shadow-lg flex items-center transition-opacity duration-300`;
        alertDiv.innerHTML = `${icon}<span>${message}</span>`;
        
        alertContainer.innerHTML = ''; // Xóa thông báo cũ
        alertContainer.appendChild(alertDiv);

        // Tự động xóa thông báo sau 5 giây
        setTimeout(() => {
            alertDiv.style.opacity = '0';
            setTimeout(() => {
                if (alertContainer.contains(alertDiv)) {
                    alertContainer.removeChild(alertDiv);
                }
            }, 500);
        }, 5000);
    }

    // ===== ĐOẠN CODE KIỂM TRA URL KHI TẢI TRANG =====
    function checkPaymentStatus() {
        const urlParams = new URLSearchParams(window.location.search);
        const paymentStatus = urlParams.get('payment_status');
        const message = urlParams.get('message');

        if (paymentStatus && message) {
            showAlert(decodeURIComponent(message), paymentStatus);
            // Xóa các tham số khỏi URL để không hiển thị lại khi tải lại trang
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
    // Gọi hàm này ngay khi DOM được tải xong
    checkPaymentStatus();
    // ===============================================

    async function apiCall(action, payload = {}) {
        // ... (phần còn lại của hàm apiCall giữ nguyên)
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers,
                body: JSON.stringify({ action, payload })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Lỗi không xác định' }));
                throw new Error(errorData.message || `Lỗi HTTP: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            log(`Lỗi API (${action}): ${error.message}`, true);
            showAlert(`Lỗi API: ${error.message}`, 'error');
            return { success: false, message: error.message };
        }
    }

    // --- XỬ LÝ SỰ KIỆN (phần còn lại giữ nguyên) ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        loginBtn.disabled = true;
        loginBtn.textContent = 'Đang đăng nhập...';
        log('Bắt đầu quá trình đăng nhập...');

        const result = await apiCall('login', { username, password });
        
        if (result.success && result.body.token) {
            token = result.body.token;
            log('Đăng nhập thành công! Lấy dữ liệu ban đầu...');
            showAlert('Đăng nhập thành công!');
            statusEl.textContent = 'Đã đăng nhập';
            statusEl.className = 'font-semibold text-green-600';
            
            const initialData = await apiCall('getInitialData');
            if (initialData.success) {
                log('Lấy dữ liệu ban đầu thành công.');
                userNameEl.textContent = initialData.profile.hoDem + ' ' + initialData.profile.ten;
                dotDkhpEl.textContent = initialData.dot.tenDot;
                dotId = initialData.dot.id;
                startBtn.disabled = false;
            } else {
                log('Không thể lấy dữ liệu ban đầu.', true);
                showAlert('Lỗi: Không thể lấy dữ liệu ban đầu.', 'error');
            }
        } else {
            log(`Đăng nhập thất bại: ${result.message}`, true);
            showAlert(`Đăng nhập thất bại: ${result.message}`, 'error');
            statusEl.textContent = 'Đăng nhập thất bại';
            statusEl.className = 'font-semibold text-red-600';
        }

        loginBtn.disabled = false;
        loginBtn.textContent = 'Đăng nhập';
    });

    // ... (các hàm startBtn, stopBtn, fetchRegisteredClasses, donateBtn giữ nguyên không đổi) ...
    startBtn.addEventListener('click', () => {
        const classIds = classIdsInput.value.split(',').map(id => id.trim()).filter(id => id);
        const interval = parseInt(intervalInput.value, 10);

        if (classIds.length === 0) {
            showAlert('Vui lòng nhập ít nhất một mã lớp học phần.', 'error');
            return;
        }
        if (isNaN(interval) || interval < 100) {
            showAlert('Thời gian chờ phải là một số và lớn hơn hoặc bằng 100ms.', 'error');
            return;
        }

        log(`Bắt đầu đăng ký cho các lớp: ${classIds.join(', ')} với tần suất ${interval}ms.`);
        startBtn.disabled = true;
        stopBtn.disabled = false;
        classIdsInput.disabled = true;
        intervalInput.disabled = true;
        
        registrationInterval = setInterval(async () => {
            log(`Gửi yêu cầu đăng ký cho ${classIds.length} lớp...`);
            const payload = {
                idDot: dotId,
                dsLop: classIds.map(id => ({ idLopHocPhan: id, isLopHocPhanDeNghi: false }))
            };
            const result = await apiCall('registerClasses', payload);
            
            if (result.success) {
                log(`Kết quả: ${JSON.stringify(result.body)}`);
                if (result.body && result.body.some(r => r.trangThai === 'ThanhCong')) {
                    log('Phát hiện đăng ký thành công! Đã dừng tiến trình.', false);
                    showAlert('Đăng ký thành công!', 'success');
                    stopBtn.click();
                    await fetchRegisteredClasses();
                }
            } else {
                log(`Đăng ký thất bại: ${result.message}`, true);
                if (result.status === 401) {
                    log('Token hết hạn. Vui lòng đăng nhập lại.', true);
                    showAlert('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.', 'error');
                    stopBtn.click();
                }
            }
        }, interval);
    });

    stopBtn.addEventListener('click', () => {
        if (registrationInterval) {
            clearInterval(registrationInterval);
            registrationInterval = null;
            log('Đã dừng quá trình đăng ký.');
            startBtn.disabled = false;
            stopBtn.disabled = true;
            classIdsInput.disabled = false;
            intervalInput.disabled = false;
        }
    });
    
    async function fetchRegisteredClasses() {
        if (!token || !dotId) {
            showAlert('Vui lòng đăng nhập để xem các lớp đã đăng ký.', 'error');
            return;
        }
        log('Đang tải danh sách lớp đã đăng ký...');
        registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Đang tải...</p>';

        const result = await apiCall('getRegisteredClasses', { idDot: dotId });

        if (result.success && result.body) {
            log(`Tải thành công ${result.body.length} lớp.`);
            if (result.body.length === 0) {
                registeredContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Bạn chưa đăng ký lớp nào trong đợt này.</p>';
                return;
            }
            const table = document.createElement('table');
            table.className = 'min-w-full divide-y divide-gray-200';
            table.innerHTML = `
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mã LHP</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tên Môn Học</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trạng thái</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                </tbody>
            `;
            const tbody = table.querySelector('tbody');
            result.body.forEach(cls => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">${cls.maLopHocPhan}</td>
                    <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${cls.tenMonHoc}</td>
                    <td class="px-4 py-2 whitespace-nowrap text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${cls.trangThaiDangKy === 'DaDangKy' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">${cls.trangThaiDangKy}</span></td>
                `;
                tbody.appendChild(row);
            });
            registeredContainer.innerHTML = '';
            registeredContainer.appendChild(table);

        } else {
            log('Tải danh sách lớp thất bại.', true);
            registeredContainer.innerHTML = `<p class="text-red-500 text-center py-8">Lỗi khi tải: ${result.message}</p>`;
        }
    }

    refreshBtn.addEventListener('click', fetchRegisteredClasses);
    
    donateBtn.addEventListener('click', async () => {
        const amount = donationAmountInput.value;
        if (!amount || amount < 1000) {
            showAlert('Vui lòng nhập số tiền ủng hộ hợp lệ (tối thiểu 1,000 VND).', 'error');
            return;
        }

        log(`Tạo yêu cầu thanh toán cho ${amount} VND...`);
        donateBtn.disabled = true;
        donateBtn.textContent = 'Đang xử lý...';

        const result = await apiCall('create_vnpay_payment', { amount: parseInt(amount) });
        
        if (result.success && result.paymentUrl) {
            log('Đã tạo URL thanh toán. Chuyển hướng đến VNPay...');
            window.location.href = result.paymentUrl;
        } else {
            log('Tạo yêu cầu thanh toán thất bại.', true);
            showAlert('Không thể tạo yêu cầu thanh toán. Vui lòng thử lại.', 'error');
            donateBtn.disabled = false;
            donateBtn.textContent = 'Ủng hộ qua VNPay';
        }
    });

});