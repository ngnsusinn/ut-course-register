const fetch = require('node-fetch');
const db = require('./db'); // Import kết nối DB đã tạo ở file `api/db.js`

/**
 * Hàm tiện ích để gọi API nội bộ của UTH Portal.
 * @param {string} endpoint - Điểm cuối API (ví dụ: '/user/getSummaryProfile').
 * @param {string} method - Phương thức HTTP ('GET', 'POST', 'DELETE').
 * @param {string} token - JWT token để xác thực.
 * @param {object|null} body - Dữ liệu gửi đi cho phương thức POST.
 * @param {string} source - Nguồn API ('dkhp' hoặc 'dkhpdk').
 * @returns {Promise<object>} - Kết quả trả về từ API.
 */
async function callApi(endpoint, method, token, body = null, source = 'dkhp') {
    let baseApiUrl;
    if (endpoint.startsWith('/user/')) {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1';
    } else if (source === 'dkhpdk') {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhpdk';
    } else {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhp';
    }
    const targetUrl = baseApiUrl + endpoint;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers, body: body ? JSON.stringify(body) : null, timeout: 30000 };

    try {
        const response = await fetch(targetUrl, options);
        if (!response.ok) {
            return { success: false, message: `API Error: Status ${response.status}`, status: response.status };
        }
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        return { success: true, ...data };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

/**
 * Hàm tiện ích để lấy chi tiết lịch học (Thứ, Tiết, Phòng) cho một lớp học phần.
 * @param {string} classId - ID của lớp học phần.
 * @param {string} token - JWT token.
 * @param {string} source - Nguồn API.
 * @returns {Promise<string>} - Chuỗi mô tả lịch học.
 */
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLichHoc?idLopHocPhan=${classId}`, 'GET', token, null, source);
    if (result.success && result.body) {
        return result.body.map(item =>
            `Thứ ${item.thu} (Tiết ${item.tietBatDau}-${item.tietKetThuc}) tại ${item.tenPhong}`
        ).join(', ');
    }
    return 'Không có thông tin lịch học';
}


// === BỘ NÃO XỬ LÝ CÁC HÀNH ĐỘNG TỪ CLIENT ===
module.exports = async (req, res) => {
    // Cấu hình CORS
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        switch (action) {

            // =======================================================
            // SECTION: HÀNH ĐỘNG XÁC THỰC & DỮ LIỆU BAN ĐẦU
            // =======================================================
            case 'login': {
                const { username, password } = payload;
                
                // **ĐÃ CẬP NHẬT: Sử dụng reCAPTCHA cố định như yêu cầu**
                const loginUrl = `https://portal.ut.edu.vn/api/v1/user/login`;

                const response = await fetch(loginUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const tokenData = await response.json();

                if (tokenData && tokenData.token) {
                    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
                    let user = rows[0];
                    if (!user) {
                        await db.execute('INSERT INTO users (username) VALUES (?)', [username]);
                        user = { vip_until: null };
                    }
                    const isVip = user && user.vip_until && new Date(user.vip_until) > new Date();
                    result = { ...tokenData, isVip };
                } else {
                    result = tokenData;
                }
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotRes = await callApi('/dkhp/getDot', 'GET', token);

                if (!profileRes.success || !dotRes.success) {
                    return res.status(500).json({ success: false, message: "Không thể lấy dữ liệu ban đầu từ portal." });
                }

                const latestDot = dotRes.body.reduce((max, dot) => max.id > dot.id ? max : dot);
                
                const [userRows] = await db.execute('SELECT vip_until FROM users WHERE username = ?', [profileRes.body.tenDangNhap]);
                const isVip = userRows[0] && userRows[0].vip_until && new Date(userRows[0].vip_until) > new Date();
                
                result = {
                    success: true,
                    profile: profileRes.body,
                    dot: latestDot,
                    isVip: isVip
                };
                break;
            }

            // ... (Các case khác giữ nguyên) ...

            // =======================================================
            // SECTION: HÀNH ĐỘNG THANH TOÁN VIP
            // =======================================================
            case 'createPayment': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { planDays } = payload;
                const prices = { 1: 5000, 3: 15000, 7: 35000 };
                const amount = prices[planDays];

                if (!amount) return res.status(400).json({ success: false, message: 'Gói VIP không hợp lệ.' });

                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                if (!profileRes.success) return res.status(401).json({ success: false, message: 'Không thể lấy thông tin người dùng.' });
                
                const [userRows] = await db.execute('SELECT id FROM users WHERE username = ?', [profileRes.body.tenDangNhap]);
                if (userRows.length === 0) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại trong DB.' });
                
                const userId = userRows[0].id;

                const [insertResult] = await db.execute(
                    'INSERT INTO transactions (user_id, plan_days, amount, status) VALUES (?, ?, ?, ?)',
                    [userId, planDays, amount, 'pending']
                );
                const transactionId = insertResult.insertId;

                const qrCodeUrl = `https://api.vietqr.io/v2/generate?accountNo=0987654321&accountName=NGUYEN%20VAN%20A&acqId=970415&amount=${amount}&addInfo=UTHVIP${transactionId}&template=compact`;

                result = { success: true, qrCodeUrl: qrCodeUrl };
                break;
            }

            // =======================================================
            // SECTION: HÀNH ĐỘNG LẤY DỮ LIỆU HỌC PHẦN
            // =======================================================
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { idDot, isCay } = payload;
                const source = isCay ? 'dkhpdk' : 'dkhp';
                
                const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${idDot}&isFilter=true`, 'GET', token, null, source);
                if (!subjectsRes.success || !Array.isArray(subjectsRes.body)) {
                    return res.status(500).json({ success: false, message: "Lỗi khi tải danh sách môn học." });
                }

                const classPromises = subjectsRes.body.map(subject => 
                    callApi(`/getLopHocPhanChoDangKy?idDot=${idDot}&maHocPhan=${subject.ma}&isLocTrung=False`, 'GET', token, null, source)
                );
                const classResults = await Promise.all(classPromises);
                
                let allClassData = [];
                classResults.forEach(res => {
                    if (res.success && Array.isArray(res.body)) allClassData.push(...res.body);
                });

                const detailedPromises = allClassData.map(cls => 
                    getScheduleDetails(cls.id, token, source).then(details => ({ ...cls, lichHocChiTiet: details }))
                );
                const detailedSchedule = await Promise.all(detailedPromises);

                result = { success: true, data: detailedSchedule };
                break;
            }

            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { idDot } = payload;
                
                const [dkhpRes, dkhpdkRes] = await Promise.all([
                    callApi(`/getLHPDaDangKy?idDot=${idDot}`, 'GET', token, null, 'dkhp'),
                    callApi(`/getLHPDaDangKy?idDot=${idDot}`, 'GET', token, null, 'dkhpdk')
                ]);

                let registeredClasses = [];
                if (dkhpRes.success && Array.isArray(dkhpRes.body)) registeredClasses.push(...dkhpRes.body.map(c => ({...c, source: 'dkhp'})));
                if (dkhpdkRes.success && Array.isArray(dkhpdkRes.body)) registeredClasses.push(...dkhpdkRes.body.map(c => ({...c, source: 'dkhpdk'})));

                result = { success: true, body: registeredClasses };
                break;
            }

            // =======================================================
            // SECTION: HÀNH ĐỘNG GHI (ĐĂNG KÝ/HỦY)
            // =======================================================
            case 'register': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        res.status(200).json(result);

    } catch (error) {
        console.error('Handler Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ: ' + error.message });
    }
};