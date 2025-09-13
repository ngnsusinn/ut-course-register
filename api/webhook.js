const db = require('./db');

module.exports = async (req, res) => {
    // Chỉ chấp nhận phương thức POST
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // --- PHẦN QUAN TRỌNG: XÁC THỰC WEBHOOK ---
        // Mỗi cổng thanh toán có cách xác thực riêng (dùng signature, checksum, IP...).
        // Bạn PHẢI triển khai bước này để đảm bảo an toàn, tránh bị giả mạo giao dịch.
        // Đọc kỹ tài liệu từ nhà cung cấp dịch vụ thanh toán của bạn.
        // const signature = req.headers['x-payment-signature'];
        // const isVerified = verifySignature(req.body, signature, process.env.PAYMENT_SECRET_KEY);
        // if (!isVerified) {
        //     return res.status(403).json({ message: 'Invalid signature' });
        // }
        
        // Giả sử body từ webhook có dạng: { orderId: 'UTHVIP123', status: 'success' }
        // Bạn cần điều chỉnh dựa trên dữ liệu thực tế mà cổng thanh toán gửi về.
        const { orderId, status } = req.body; 
        
        // Lấy transaction ID từ orderId
        const transactionId = (orderId || '').replace('UTHVIP', '');

        if (status === 'success' && transactionId) {
            // Tìm giao dịch đang ở trạng thái "pending"
            const [transactions] = await db.execute('SELECT * FROM transactions WHERE id = ? AND status = "pending"', [transactionId]);
            
            if (transactions.length > 0) {
                const transaction = transactions[0];
                
                // 1. Cập nhật trạng thái giao dịch thành "completed"
                await db.execute('UPDATE transactions SET status = "completed" WHERE id = ?', [transactionId]);

                // 2. Cập nhật thời hạn VIP cho người dùng
                // Dùng GREATEST(IFNULL(vip_until, NOW()), NOW()) để cộng dồn ngày VIP
                // nếu người dùng mua thêm khi vẫn còn hạn.
                await db.execute(
                    `UPDATE users SET vip_until = DATE_ADD(GREATEST(IFNULL(vip_until, NOW()), NOW()), INTERVAL ? DAY) WHERE id = ?`,
                    [transaction.plan_days, transaction.user_id]
                );

                console.log(`✅ VIP activated for transaction ${transactionId}, user ${transaction.user_id}`);
            }
        }
        
        // Luôn trả về mã 200 OK để cổng thanh toán biết bạn đã nhận được thông báo.
        res.status(200).json({ message: 'Webhook received successfully' });

    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};