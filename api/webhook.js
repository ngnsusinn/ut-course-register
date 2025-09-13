const db = require('./db');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // Giả sử body từ webhook có dạng: { orderId: 'UTHVIP123', status: 'success' }
        const { orderId, status } = req.body; 
        const transactionId = (orderId || '').replace('UTHVIP', '');

        if (status === 'success' && transactionId) {
            const [transactions] = await db.execute('SELECT * FROM transactions WHERE id = ? AND status = "pending"', [transactionId]);
            
            if (transactions.length > 0) {
                const transaction = transactions[0];
                
                // Cập nhật giao dịch
                await db.execute('UPDATE transactions SET status = "completed" WHERE id = ?', [transactionId]);

                // Cộng dồn ngày VIP cho user
                await db.execute(
                    `UPDATE users SET vip_until = DATE_ADD(GREATEST(IFNULL(vip_until, NOW()), NOW()), INTERVAL ? DAY) WHERE id = ?`,
                    [transaction.plan_days, transaction.user_id]
                );

                console.log(`✅ VIP activated for transaction ${transactionId}, user ${transaction.user_id}`);
            }
        }
        
        res.status(200).json({ message: 'Webhook received successfully' });

    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};