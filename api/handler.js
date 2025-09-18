const fetch = require('node-fetch');
const crypto = require('crypto');
const querystring = require('querystring');

// Utility: Sort object keys for VNPAY signature
function sortObject(obj) {
    let sorted = {};
    let str = [];
    let key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) {
            str.push(encodeURIComponent(key));
        }
    }
    str.sort();
    for (key = 0; key < str.length; key++) {
        sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
    }
    return sorted;
}

// Tiện ích: Gọi API nội bộ của trường
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

// Tiện ích: Lấy chi tiết lịch học cho một lớp
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    return (result && result.success) ? result.body : { error: true, message: result.message };
}

// === BỘ NÃO XỬ LÝ CÁC HÀNH ĐỘNG TỪ CLIENT ===
module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    // Handle VNPAY callback
    if (req.method === 'GET' && req.url && req.url.includes('/api/vnpay/return')) {
        const vnp_Params = req.query || {};
        const secureHash = vnp_Params['vnp_SecureHash'];
        
        delete vnp_Params['vnp_SecureHash'];
        delete vnp_Params['vnp_SecureHashType'];
        
        const sorted_params = sortObject(vnp_Params);
        const secretKey = process.env.VNP_HASH_SECRET;
        const signData = querystring.stringify(sorted_params, { encode: false });
        const hmac = crypto.createHmac("sha512", secretKey);
        const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
        
        if (secureHash === signed) {
            const responseCode = vnp_Params['vnp_ResponseCode'];
            if (responseCode === '00') {
                // Payment successful
                res.writeHead(302, { Location: '/?payment=success' });
                return res.end();
            }
        }
        
        res.writeHead(302, { Location: '/?payment=failed' });
        return res.end();
    }
    
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        switch (action) {
            // --- HÀNH ĐỘNG XÁC THỰC ---
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

            // --- HÀNH ĐỘNG LẤY DỮ LIỆU ---
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

            // --- HÀNH ĐỘNG GHI (ĐĂNG KÝ/HỦY) ---
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

            // === VNPAY PAYMENT ACTIONS ===
            case 'createPaymentUrl': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { amount, orderInfo, bankCode, language, userId } = payload;
                
                // Get environment variables
                const tmnCode = process.env.VNP_TMN_CODE;
                const secretKey = process.env.VNP_HASH_SECRET;
                const vnpUrl = process.env.VNP_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
                const returnUrl = process.env.VNP_RETURN_URL || 'https://your-vercel-app.vercel.app/api/vnpay/return';
                
                if (!tmnCode || !secretKey) {
                    return res.status(500).json({ 
                        success: false, 
                        message: 'VNPAY configuration missing. Please set environment variables.' 
                    });
                }
                
                const date = new Date();
                const createDate = date.getFullYear().toString() +
                    ('0' + (date.getMonth() + 1)).slice(-2) +
                    ('0' + date.getDate()).slice(-2) +
                    ('0' + date.getHours()).slice(-2) +
                    ('0' + date.getMinutes()).slice(-2) +
                    ('0' + date.getSeconds()).slice(-2);
                
                const orderId = createDate + Math.floor(Math.random() * 1000000);
                const locale = language || 'vn';
                const currCode = 'VND';
                
                let vnp_Params = {};
                vnp_Params['vnp_Version'] = '2.1.0';
                vnp_Params['vnp_Command'] = 'pay';
                vnp_Params['vnp_TmnCode'] = tmnCode;
                vnp_Params['vnp_Locale'] = locale;
                vnp_Params['vnp_CurrCode'] = currCode;
                vnp_Params['vnp_TxnRef'] = orderId;
                vnp_Params['vnp_OrderInfo'] = orderInfo || 'Thanh toan hoc phi UTH';
                vnp_Params['vnp_OrderType'] = 'other';
                vnp_Params['vnp_Amount'] = amount * 100;
                vnp_Params['vnp_ReturnUrl'] = returnUrl;
                vnp_Params['vnp_IpAddr'] = req.headers['x-forwarded-for'] || 
                    req.connection?.remoteAddress || 
                    req.socket?.remoteAddress || 
                    '127.0.0.1';
                vnp_Params['vnp_CreateDate'] = createDate;
                
                if (bankCode) {
                    vnp_Params['vnp_BankCode'] = bankCode;
                }
                
                vnp_Params = sortObject(vnp_Params);
                
                const signData = querystring.stringify(vnp_Params, { encode: false });
                const hmac = crypto.createHmac("sha512", secretKey);
                const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
                vnp_Params['vnp_SecureHash'] = signed;
                
                const paymentUrl = vnpUrl + '?' + querystring.stringify(vnp_Params, { encode: false });
                
                result = {
                    success: true,
                    paymentUrl: paymentUrl,
                    orderId: orderId
                };
                break;
            }
            
            case 'checkPaymentStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { orderId, transDate } = payload;
                
                const tmnCode = process.env.VNP_TMN_CODE;
                const secretKey = process.env.VNP_HASH_SECRET;
                const vnpApi = process.env.VNP_API || 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
                
                const date = new Date();
                const vnp_RequestId = date.getTime().toString();
                const vnp_Version = '2.1.0';
                const vnp_Command = 'querydr';
                const vnp_CreateDate = date.getFullYear().toString() +
                    ('0' + (date.getMonth() + 1)).slice(-2) +
                    ('0' + date.getDate()).slice(-2) +
                    ('0' + date.getHours()).slice(-2) +
                    ('0' + date.getMinutes()).slice(-2) +
                    ('0' + date.getSeconds()).slice(-2);
                
                const vnp_IpAddr = req.headers['x-forwarded-for'] || '127.0.0.1';
                const vnp_OrderInfo = 'Kiem tra trang thai thanh toan';
                
                const data = vnp_RequestId + "|" + vnp_Version + "|" + vnp_Command + "|" + 
                            tmnCode + "|" + orderId + "|" + transDate + "|" + 
                            vnp_CreateDate + "|" + vnp_IpAddr + "|" + vnp_OrderInfo;
                
                const hmac = crypto.createHmac("sha512", secretKey);
                const vnp_SecureHash = hmac.update(Buffer.from(data, 'utf-8')).digest("hex");
                
                const dataObj = {
                    'vnp_RequestId': vnp_RequestId,
                    'vnp_Version': vnp_Version,
                    'vnp_Command': vnp_Command,
                    'vnp_TmnCode': tmnCode,
                    'vnp_TxnRef': orderId,
                    'vnp_OrderInfo': vnp_OrderInfo,
                    'vnp_TransactionDate': transDate,
                    'vnp_CreateDate': vnp_CreateDate,
                    'vnp_IpAddr': vnp_IpAddr,
                    'vnp_SecureHash': vnp_SecureHash
                };
                
                try {
                    const response = await fetch(vnpApi, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(dataObj)
                    });
                    
                    result = await response.json();
                } catch (error) {
                    result = { success: false, message: 'Error checking payment status: ' + error.message };
                }
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