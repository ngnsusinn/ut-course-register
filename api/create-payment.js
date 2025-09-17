// ut/api/create-payment.js
const { query } = require('./db');

// Thay thế bằng thông tin tài khoản nhận tiền của bạn
const SEPAY_ACCOUNT_NUMBER = 'YOUR_BANK_ACCOUNT'; // SỐ TÀI KHOẢN NGÂN HÀNG
const SEPAY_BANK_CODE = 'MBBank'; // HOẶC VIETCOMBANK, TECHCOMBANK...

module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    const { username, price, days } = req.body;

    if (!username || !price || !days) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        // 1. Tạo đơn hàng trong database
        const result = await query(
            'INSERT INTO tb_orders (username, total, payment_status) VALUES (?, ?, ?)',
            [username, price, 'Unpaid']
        );

        const orderId = result.insertId;
        const orderPrefix = 'DH'; // Tiền tố đơn hàng
        const orderContent = `${orderPrefix}${orderId}`;

        // 2. Tạo URL thanh toán Sepay
        const qrUrl = `https://qr.sepay.vn/img?acc=${SEPAY_ACCOUNT_NUMBER}&bank=${SEPAY_BANK_CODE}&amount=${price}&des=${orderContent}&template=compact`;

        return res.status(200).json({
            success: true,
            orderId,
            orderContent,
            qrUrl,
            paymentInfo: {
                accountName: "TEN CHU TAI KHOAN", // Thay tên chủ tài khoản
                accountNumber: SEPAY_ACCOUNT_NUMBER,
                bankName: SEPAY_BANK_CODE,
                amount: price,
                content: orderContent
            }
        });

    } catch (error) {
        console.error("Payment creation error:", error);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};