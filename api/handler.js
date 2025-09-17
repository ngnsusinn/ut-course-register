const fetch = require('node-fetch');
const querystring = require('qs');
const crypto = require('crypto');
const moment = require('moment');

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

function sortObject(obj) {
	let sorted = {};
	let str = [];
	let key;
	for (key in obj){
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

// === BỘ NÃO XỬ LÝ CÁC HÀNH ĐỘNG TỪ CLIENT ===
module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET' && req.query.vnp_ResponseCode) {
        let vnp_Params = req.query;
        let secureHash = vnp_Params['vnp_SecureHash'];

        delete vnp_Params['vnp_SecureHash'];
        delete vnp_Params['vnp_SecureHashType'];

        vnp_Params = sortObject(vnp_Params);
        let secretKey = process.env.VNP_HASHSECRET;
        let signData = querystring.stringify(vnp_Params, { encode: false });
        let hmac = crypto.createHmac("sha512", secretKey);
        
        // =============== DÒNG CODE ĐÃ SỬA LỖI ===============
        let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
        // =======================================================

        if(secureHash === signed){
            const success = vnp_Params.vnp_ResponseCode === '00';
            const message = success ? 'Giao dịch thành công' : 'Giao dịch không thành công';
            // Chuyển hướng về trang chủ với tham số
            const redirectUrl = `/?payment_status=${success ? 'success' : 'fail'}&message=${encodeURIComponent(message)}`;
            return res.redirect(301, redirectUrl);
        } else {
            const redirectUrl = `/?payment_status=fail&message=${encodeURIComponent('Chữ ký không hợp lệ')}`;
            return res.redirect(301, redirectUrl);
        }
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

            // --- HÀNH ĐỘNG TẠO THANH TOÁN VNPay ---
            case 'create_vnpay_payment': {
                const { amount, bankCode, language } = payload;
                const date = new Date();
                const createDate = moment(date).format('YYYYMMDDHHmmss');
                const orderId = moment(date).format('DDHHmmss');

                let vnp_Params = {};
                vnp_Params['vnp_Version'] = '2.1.0';
                vnp_Params['vnp_Command'] = 'pay';
                vnp_Params['vnp_TmnCode'] = process.env.VNP_TMNCODE;
                vnp_Params['vnp_Locale'] = language || 'vn';
                vnp_Params['vnp_CurrCode'] = 'VND';
                vnp_Params['vnp_TxnRef'] = orderId;
                vnp_Params['vnp_OrderInfo'] = 'Thanh toan cho ma GD:' + orderId;
                vnp_Params['vnp_OrderType'] = 'other';
                vnp_Params['vnp_Amount'] = amount * 100;
                vnp_Params['vnp_ReturnUrl'] = process.env.VNP_RETURN_URL;
                let ipAddr = req.headers['x-forwarded-for'] ||
                             req.connection.remoteAddress ||
                             req.socket.remoteAddress ||
                             (req.connection.socket ? req.connection.socket.remoteAddress : null);
                vnp_Params['vnp_IpAddr'] = ipAddr;
                vnp_Params['vnp_CreateDate'] = createDate;
                if(bankCode){
                    vnp_Params['vnp_BankCode'] = bankCode;
                }

                vnp_Params = sortObject(vnp_Params);

                let signData = querystring.stringify(vnp_Params, { encode: false });
                let hmac = crypto.createHmac("sha512", process.env.VNP_HASHSECRET);
                let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
                vnp_Params['vnp_SecureHash'] = signed;

                const vnpUrl = process.env.VNP_URL + '?' + querystring.stringify(vnp_Params, { encode: false });

                result = { success: true, paymentUrl: vnpUrl };
                break;
            }

            // --- CÁC HÀNH ĐỘNG KHÁC ---
            default:
                return res.status(400).json({ success: false, message: 'Invalid action' });
        }

        return res.status(200).json(result);

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};