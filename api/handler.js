const fetch = require('node-fetch');
const moment = require('moment-timezone');
const crypto = require('crypto');
const querystring = require('qs');

// Tải biến môi trường (chỉ cần thiết khi chạy local, Vercel tự động tải)
// require('dotenv').config();

module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // VNPAY Config from Environment Variables
    const tmnCode = process.env.VNP_TMN_CODE;
    const secretKey = process.env.VNP_SECRET_KEY;
    const vnpUrl = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { action, studentId, password, token, courseCode } = req.body;
    let result = {};

    try {
        switch (action) {
            case 'login': {
                const response = await fetch('https://dkh.uth.edu.vn/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ studentId, password, campusId: 1 })
                });
                result = await response.json();
                break;
            }

            case 'getRegisteredCourses': {
                const response = await fetch('https://dkh.uth.edu.vn/api/sch/w-schregisteredcourse/filter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ sortOrder: "asc", sortField: "", page: 1, pageSize: 100, filter: { semester: "HK1_2025-2026" } })
                });
                result = await response.json();
                break;
            }

            case 'registerCourse': {
                const response = await fetch('https://dkh.uth.edu.vn/api/sch/w-schstudentregister/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ courseCode, semester: "HK1_2025-2026", campusId: 1 })
                });
                result = await response.json();
                break;
            }

            case 'create_payment_url': {
                if (!tmnCode || !secretKey) {
                    throw new Error('VNPAY TmnCode or SecretKey is not configured on the server.');
                }
                const returnUrl = `http://${req.headers.host}/vnpay_return.html`;
                const ipAddr = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
                const date = new Date();
                const createDate = moment(date).tz("Asia/Ho_Chi_Minh").format('YYYYMMDDHHmmss');
                const orderId = moment(date).tz("Asia/Ho_Chi_Minh").format('DDHHmmss');
                const { amount, bankCode, orderDescription, orderType, language } = req.body;
                
                let vnp_Params = {};
                vnp_Params['vnp_Version'] = '2.1.0';
                vnp_Params['vnp_Command'] = 'pay';
                vnp_Params['vnp_TmnCode'] = tmnCode;
                vnp_Params['vnp_Locale'] = language || 'vn';
                vnp_Params['vnp_CurrCode'] = 'VND';
                vnp_Params['vnp_TxnRef'] = orderId;
                vnp_Params['vnp_OrderInfo'] = orderDescription || 'Thanh toan dich vu';
                vnp_Params['vnp_OrderType'] = orderType || 'billpayment';
                vnp_Params['vnp_Amount'] = amount * 100;
                vnp_Params['vnp_ReturnUrl'] = returnUrl;
                vnp_Params['vnp_IpAddr'] = ipAddr;
                vnp_Params['vnp_CreateDate'] = createDate;
                if (bankCode) {
                    vnp_Params['vnp_BankCode'] = bankCode;
                }

                vnp_Params = Object.fromEntries(Object.entries(vnp_Params).sort());
                
                const signData = querystring.stringify(vnp_Params, { encode: false });
                const hmac = crypto.createHmac("sha512", secretKey);
                const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
                vnp_Params['vnp_SecureHash'] = signed;
                
                const paymentUrl = vnpUrl + '?' + querystring.stringify(vnp_Params, { encode: false });
                result = { paymentUrl };
                break;
            }

            default:
                result = { error: 'Invalid action' };
                return res.status(400).json(result);
        }
        res.status(200).json(result);

    } catch (error) {
        console.error('API Handler Error:', error);
        res.status(500).json({ error: error.message });
    }
};