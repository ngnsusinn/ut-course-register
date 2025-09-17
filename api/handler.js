const fetch = require('node-fetch');
const crypto = require('crypto');
const querystring = require('qs'); // Dùng để sắp xếp và chuỗi hóa params

// Tiện ích: Gọi API nội bộ của trường, chỉ dùng trong file này
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
        if (!response.ok) { // Handle non-2xx responses
            return { success: false, message: `API Error: Status ${response.status}`, status: response.status };
        }
        return await response.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Tiện ích: Lấy chi tiết lịch học cho một lớp
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    return (result && result.success) ? result.body : { error: true, message: result.message };
}

// === BỘ NÃO XỬ LÝ CÁC HÀNH ĐỘNG TỪ CLIENT ===
module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'); // Thêm GET
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Phân luồng request cho VNPAY (dựa vào URL) và cho tool (dựa vào body.action)
    const urlPath = req.url.split('?')[0];

    if (urlPath === '/api/vnpay_return' || urlPath === '/api/vnpay_ipn') {
        // Xử lý VNPAY IPN và Return
        try {
            let vnp_Params = req.query;
            let secureHash = vnp_Params['vnp_SecureHash'];
            delete vnp_Params['vnp_SecureHash'];
            delete vnp_Params['vnp_SecureHashType'];

            // Lấy biến môi trường (quan trọng!)
            let secretKey = process.env.VNP_HASHSECRET;

            vnp_Params = Object.entries(vnp_Params).sort(([key1], [key2]) => key1.localeCompare(key2)).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
            let signData = querystring.stringify(vnp_Params, { encode: false });
            let hmac = crypto.createHmac("sha512", secretKey);
            let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

            if (secureHash === signed) {
                console.log("VNPAY transaction valid:", vnp_Params);
                if (urlPath === '/api/vnpay_return') {
                     // Chuyển hướng người dùng về trang kết quả
                     const returnUrl = (process.env.APP_URL || 'http://localhost:3000') + (vnp_Params['vnp_ResponseCode'] === '00' ? '/payment_success.html' : '/payment_fail.html');
                     res.writeHead(302, { Location: returnUrl });
                     res.end();
                } else { // IPN
                    res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
                }
            } else {
                 if (urlPath === '/api/vnpay_return') {
                    const returnUrl = (process.env.APP_URL || 'http://localhost:3000') + '/payment_fail.html';
                    res.writeHead(302, { Location: returnUrl });
                    res.end();
                 } else { // IPN
                    res.status(200).json({ RspCode: '97', Message: 'Fail checksum' });
                 }
            }
        } catch (error) {
            console.error("VNPAY handler error:", error);
            res.status(500).json({ message: "Internal Server Error" });
        }
        return; // Dừng thực thi sau khi xử lý VNPAY
    }


    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        switch (action) {
            // --- HÀNH ĐỘNG MỚI: TẠO URL THANH TOÁN VNPAY ---
            case 'create_payment_url': {
                const ipAddr = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
                
                // Lấy biến môi trường (quan trọng!)
                const tmnCode = process.env.VNP_TMNCODE;
                const secretKey = process.env.VNP_HASHSECRET;
                let vnpUrl = process.env.VNP_URL;
                const returnUrl = (process.env.APP_URL) + '/api/vnpay_return';

                const date = new Date();
                const createDate = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}${date.getSeconds().toString().padStart(2, '0')}`;
                
                const orderId = `order_${Date.now()}`;
                const amount = payload.amount || 10000;
                const orderInfo = payload.orderInfo || 'Thanh toan don hang';
                const locale = 'vn';
                
                let vnp_Params = {
                    'vnp_Version': '2.1.0',
                    'vnp_Command': 'pay',
                    'vnp_TmnCode': tmnCode,
                    'vnp_Locale': locale,
                    'vnp_CurrCode': 'VND',
                    'vnp_TxnRef': orderId,
                    'vnp_OrderInfo': orderInfo,
                    'vnp_OrderType': 'other',
                    'vnp_Amount': amount * 100, // Số tiền nhân 100
                    'vnp_ReturnUrl': returnUrl,
                    'vnp_IpAddr': ipAddr,
                    'vnp_CreateDate': createDate
                };

                vnp_Params = Object.entries(vnp_Params).sort(([key1], [key2]) => key1.localeCompare(key2)).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

                let signData = querystring.stringify(vnp_Params, { encode: false });
                let hmac = crypto.createHmac("sha512", secretKey);
                let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
                vnp_Params['vnp_SecureHash'] = signed;

                vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false });
                
                result = { success: true, paymentUrl: vnpUrl };
                break;
            }

            // --- CÁC HÀNH ĐỘNG GỐC CỦA BẠN ---
            case 'login': {
                const { username, password } = payload;
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }
            case 'getInitialData': {
                 if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApi(`/getDot`, 'GET', token);
                const latestDot = (dotsRes.success && dotsRes.body.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot
                };
                break;
            }
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites } = payload;
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                for (const source of sources) {
                    const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                    if (!subjectsRes.success || !Array.isArray(subjectsRes.body)) continue;

                    if (source === 'dkhp') {
                        subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }

                    await Promise.all(subjectsRes.body.map(async (subject) => {
                        const classEndpoint = source === 'dkhpdk'
                            ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                            : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                        const classRes = await callApi(classEndpoint, 'GET', token, null, source);

                        if (classRes.success && Array.isArray(classRes.body)) {
                             await Promise.all(classRes.body.map(async (cls) => {
                                const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                                allClassData.push({ ...subject, ...cls, source, scheduleDetails });
                            }));
                        }
                    }));
                }
                result = { success: true, schedule: allClassData, subjectTypes: subjectTypeMap };
                break;
            }
            case 'getRegisteredClasses': {
                 if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                 const { dotId, fetchPrerequisites } = payload;
                 const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                 let registeredData = [];

                 for (const source of sources) {
                      const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                      if (regRes.success && Array.isArray(regRes.body)) {
                           await Promise.all(regRes.body.map(async (reg) => {
                                const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                                const scheduleDetails = (detailRes && detailRes.success) ? detailRes.body : { error: true, message: detailRes.message };
                                registeredData.push({ ...reg, source, scheduleDetails });
                           }));
                      }
                 }
                 result = { success: true, body: registeredData };
                 break;
            }
            case 'checkClassStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, maHocPhan, source } = payload;
                 const classEndpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                result = await callApi(classEndpoint, 'GET', token, null, source);
                break;
            }
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
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};