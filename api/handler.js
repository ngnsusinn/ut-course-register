// ut/api/handler.js
const fetch = require('node-fetch');
const { query } = require('./db'); // Import hàm query DB

// Hàm gọi API nội bộ của trường
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
        return await response.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Lấy chi tiết lịch học cho một lớp
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    return (result && result.success) ? result.body : { error: true, message: result.message };
}

// === HÀM MỚI: KIỂM TRA HOẶC TẠO USER TRONG DATABASE VIP ===
async function checkOrCreateUserVip(username) {
    try {
        // Reset role về free nếu hết hạn
        await query('UPDATE users_vip SET role = "free", vip_expiry_date = NULL WHERE vip_expiry_date IS NOT NULL AND vip_expiry_date < NOW()');

        let users = await query('SELECT * FROM users_vip WHERE username = ?', [username]);
        if (users.length === 0) {
            // Nếu chưa có user thì thêm mới
            await query('INSERT INTO users_vip (username, role) VALUES (?, ?)', [username, 'free']);
            return { username, role: 'free', vip_expiry_date: null };
        }
        return users[0];
    } catch (error) {
        console.error("Database error in checkOrCreateUserVip:", error);
        return { username, role: 'free', vip_expiry_date: null }; // fallback
    }
}

// === BỘ NÃO XỬ LÝ CÁC HÀNH ĐỘNG TỪ CLIENT ===
module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        switch (action) {
            // --- LOGIN ---
            case 'login': {
                const { username, password } = payload;
                result = await callApi('/user/login', 'POST', null, { username, password });

                if (result.success) {
                    const userVipStatus = await checkOrCreateUserVip(username);
                    result.body.user.role = userVipStatus.role;
                }
                break;
            }

            // --- LẤY DỮ LIỆU BAN ĐẦU ---
            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApi(`/getDot`, 'GET', token);
                const latestDot = (dotsRes.success && dotsRes.body.length)
                                ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                                : null;
                const hocPhanRes = latestDot ? await callApi(`/getHocPhanTrongDot?idDot=${latestDot.id}`, 'GET', token) : { success: false };
                const registeredRes = latestDot ? await callApi(`/getLopHocPhanDaDangKy?idDot=${latestDot.id}`, 'GET', token) : { success: false };

                result = {
                    success: true,
                    profile: profileRes.success ? profileRes.body : null,
                    latestDot,
                    hocPhan: hocPhanRes.success ? hocPhanRes.body : [],
                    registered: registeredRes.success ? registeredRes.body : [],
                };
                break;
            }

            // --- TÌM LỚP HỌC ---
            case 'searchClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { idHocPhan, idDot, source } = payload;
                result = await callApi(`/getLopHocPhan?idHocPhan=${idHocPhan}&idDot=${idDot}`, 'GET', token, null, source);
                break;
            }

            // --- CHI TIẾT LỊCH HỌC ---
            case 'getScheduleDetails': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                result = await getScheduleDetails(classId, token, source);
                break;
            }

            // --- ĐĂNG KÝ HỌC PHẦN ---
            case 'registerClass': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { idDot, dsLop } = payload;
                result = await callApi('/dangKyHocPhan', 'POST', token, { idDot, dsLop });
                break;
            }

            // --- HỦY ĐĂNG KÝ ---
            case 'cancelClass': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { idDot, idLopHocPhan, idHocPhan } = payload;
                result = await callApi('/huyDangKyHocPhan', 'POST', token, { idDot, idLopHocPhan, idHocPhan });
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action' });
        }

        return res.status(200).json(result);
    } catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ success: false, message: 'An internal server error occurred.' });
    }
};
