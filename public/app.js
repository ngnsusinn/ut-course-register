document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const studentIdInput = document.getElementById('student-id');
    const passwordInput = document.getElementById('password');
    const loginButton = document.getElementById('login-button');
    const tokenOutput = document.getElementById('token-output');
    const courseCodeInput = document.getElementById('course-code');
    const registerButton = document.getElementById('register-button');
    const refreshButton = document.getElementById('refresh-button');
    const registeredContainer = document.getElementById('registered-container');
    const logOutput = document.getElementById('log-output');
    const paymentButton = document.getElementById('payment-button');
    const amountInput = document.getElementById('amount');

    // State
    let authToken = '';

    // Logger
    function log(message) {
        const timestamp = new Date().toLocaleTimeString();
        logOutput.innerHTML += `<div>[${timestamp}] ${message}</div>`;
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    // API Caller
    async function apiCall(action, body) {
        log(`Gửi yêu cầu: ${action}`);
        try {
            const response = await fetch('/api/handler', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...body }),
            });
            const data = await response.json();
            if (!response.ok || data.error) {
                throw new Error(data.message || data.error || 'Lỗi không xác định');
            }
            log(`Phản hồi thành công cho: ${action}`);
            return data;
        } catch (error) {
            log(`Lỗi khi thực hiện ${action}: ${error.message}`);
            alert(`Lỗi: ${error.message}`);
            throw error;
        }
    }

    // Login
    loginButton.addEventListener('click', async () => {
        const studentId = studentIdInput.value;
        const password = passwordInput.value;
        if (!studentId || !password) {
            alert('Vui lòng nhập Mã sinh viên và Mật khẩu.');
            return;
        }
        try {
            const data = await apiCall('login', { studentId, password });
            if (data.token) {
                authToken = data.token;
                tokenOutput.value = authToken;
                log('Đăng nhập thành công, đã nhận được token.');
                await fetchRegisteredCourses();
            }
        } catch (error) { /* Handled in apiCall */ }
    });
    
    // Fetch Registered Courses
    async function fetchRegisteredCourses() {
        if (!authToken) {
            alert('Bạn cần đăng nhập trước (lấy token).');
            return;
        }
        try {
            const data = await apiCall('getRegisteredCourses', { token: authToken });
            renderCourses(data.data);
        } catch (error) { /* Handled in apiCall */ }
    }
    
    // Register Course
    registerButton.addEventListener('click', async () => {
        if (!authToken) {
            alert('Bạn cần đăng nhập trước.'); return;
        }
        const courseCode = courseCodeInput.value;
        if (!courseCode) {
            alert('Vui lòng nhập mã môn học.'); return;
        }
        try {
            const data = await apiCall('registerCourse', { token: authToken, courseCode });
            alert(data.message || 'Đăng ký thành công!');
            log(`Kết quả đăng ký ${courseCode}: ${data.message}`);
            await fetchRegisteredCourses();
        } catch (error) { /* Handled in apiCall */ }
    });

    refreshButton.addEventListener('click', fetchRegisteredCourses);

    // Render Courses Table
    function renderCourses(courses) {
        if (!courses || courses.length === 0) {
            registeredContainer.innerHTML = `<p class="text-gray-500 text-center py-8">Không có môn học nào được đăng ký.</p>`;
            return;
        }
        const table = `
            <table class="min-w-full bg-white">
                <thead class="bg-gray-200">
                    <tr>
                        <th class="py-2 px-4 text-left">Mã MH</th>
                        <th class="py-2 px-4 text-left">Tên môn học</th>
                        <th class="py-2 px-4 text-left">TC</th>
                        <th class="py-2 px-4 text-left">Lớp</th>
                    </tr>
                </thead>
                <tbody>
                    ${courses.map(c => `
                        <tr class="border-b">
                            <td class="py-2 px-4">${c.courseCode}</td>
                            <td class="py-2 px-4">${c.courseName}</td>
                            <td class="py-2 px-4">${c.credit}</td>
                            <td class="py-2 px-4">${c.className}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
        registeredContainer.innerHTML = table;
    }

    // VNPAY Payment
    paymentButton.addEventListener('click', async () => {
        const amount = amountInput.value;
        if (!amount || amount <= 0) {
            alert('Vui lòng nhập số tiền hợp lệ.');
            log('Lỗi: Số tiền không hợp lệ.');
            return;
        }
        try {
            const data = await apiCall('create_payment_url', {
                amount,
                orderDescription: `Thanh toan hoc phi so tien ${amount}`,
            });
            if (data.paymentUrl) {
                log('Đã tạo URL thành công. Đang chuyển hướng đến VNPAY...');
                window.location.href = data.paymentUrl;
            }
        } catch (error) { /* Handled in apiCall */ }
    });
});