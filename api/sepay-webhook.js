// ut/api/sepay-webhook.js
const { query } = require('./db');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        const transactionData = req.body;

        // 1. Lưu lại toàn bộ giao dịch từ Sepay
        await query(
            `INSERT INTO tb_transactions (gateway, transaction_date, account_number, amount_in, transaction_content, reference_number, body)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                transactionData.gateway,
                transactionData.transactionDate,
                transactionData.accountNumber,
                transactionData.transferAmount,
                transactionData.content,
                transactionData.referenceCode,
                JSON.stringify(transactionData)
            ]
        );

        // 2. Tách mã đơn hàng từ nội dung chuyển khoản
        const content = transactionData.content || '';
        const regex = /DH(\d+)/i; // Tìm kiếm "DH" theo sau là các chữ số
        const matches = content.match(regex);

        if (!matches || !matches[1]) {
            return res.status(200).json({ success: false, message: 'Order ID not found in transaction content.' });
        }

        const orderId = matches[1];
        const amount = transactionData.transferAmount;

        // 3. Tìm đơn hàng tương ứng
        const orders = await query(
            "SELECT * FROM tb_orders WHERE id = ? AND total = ? AND payment_status = 'Unpaid'",
            [orderId, amount]
        );

        if (orders.length === 0) {
            return res.status(200).json({ success: false, message: `Order ${orderId} not found or already paid.` });
        }

        const order = orders[0];
        const username = order.username;

        // 4. Cập nhật trạng thái đơn hàng -> 'Paid'
        await query("UPDATE tb_orders SET payment_status = 'Paid' WHERE id = ?", [orderId]);

        // 5. Cập nhật trạng thái VIP cho người dùng
        let daysToAdd;
        if (order.total == 10000) daysToAdd = 1;
        else if (order.total == 30000) daysToAdd = 3;
        else if (order.total == 50000) daysToAdd = 5;
        else daysToAdd = 0;

        if (daysToAdd > 0) {
            // Lấy thông tin VIP hiện tại
            const users = await query('SELECT vip_expiry_date FROM users_vip WHERE username = ?', [username]);
            const currentUser = users[0];

            let newExpiryDate;
            const now = new Date();

            // Nếu user đã là VIP và còn hạn, thì cộng dồn ngày
            if (currentUser && currentUser.vip_expiry_date && new Date(currentUser.vip_expiry_date) > now) {
                newExpiryDate = new Date(currentUser.vip_expiry_date);
            } else {
                // Nếu là VIP mới hoặc hết hạn, tính từ hôm nay
                newExpiryDate = now;
            }

            newExpiryDate.setDate(newExpiryDate.getDate() + daysToAdd);

            await query(
                'UPDATE users_vip SET role = ?, vip_expiry_date = ? WHERE username = ?',
                ['vip', newExpiryDate, username]
            );
        }

        // Phản hồi thành công cho Sepay
        return res.status(200).json({ success: true, message: 'Webhook processed successfully.' });

    } catch (error) {
        console.error('Webhook Error:', error);
        // Trả về lỗi nhưng vẫn status 200 để Sepay không gửi lại
        return res.status(200).json({ success: false, message: 'An internal error occurred.' });
    }
};