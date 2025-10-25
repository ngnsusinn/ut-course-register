import { executeTransaction, logActivity } from '../database/db_utils.js';

// Main webhook handler for SEPay
export default async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    try {
        const webhookData = req.body;
        if (!webhookData || !webhookData.content) {
            return res.status(400).json({ success: false, message: 'Invalid webhook data' });
        }

        const {
            gateway,
            transactionDate,
            accountNumber,
            subAccount,
            transferType,
            transferAmount,
            accumulated,
            code,
            content,
            referenceCode,
            description
        } = webhookData;

        const amountIn = transferType === 'in' ? transferAmount : 0;

        // Use transaction to process payment + subscription creation
        const result = await executeTransaction(async (connection) => {
            // persist incoming transaction
            await connection.execute(
                `INSERT INTO transactions (gateway, transaction_date, account_number, sub_account, amount_in, amount_out, accumulated, code, transaction_content, reference_number, body)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [gateway, transactionDate, accountNumber, subAccount || '', amountIn, 0, accumulated, code, content, referenceCode, description || '']
            );

            // extract order id from content, expecting 'DH<id>' pattern
            const regex = /DH(\d+)/i;
            const match = String(content).match(regex);
            if (!match || !match[1]) {
                return { success: false, message: 'Order ID not found in transaction content' };
            }
            const orderId = parseInt(match[1], 10);

            // fetch order and ensure pending
            const [orders] = await connection.execute('SELECT * FROM orders WHERE id = ? AND payment_status IN ("Pending","Unpaid")', [orderId]);
            if (!orders || orders.length === 0) return { success: false, message: 'Order not found or already processed' };
            const order = orders[0];

            // verify amount
            if (parseFloat(amountIn) !== parseFloat(order.amount)) {
                return { success: false, message: 'Amount mismatch' };
            }

            // update order
            await connection.execute(
                `UPDATE orders SET payment_status = 'Paid', transaction_ref = ?, paid_at = NOW(), updated_at = NOW() WHERE id = ?`,
                [referenceCode, orderId]
            );

            // insert transaction with order_id (update previously inserted row by reference)
            await connection.execute('UPDATE transactions SET order_id = ? WHERE reference_number = ?', [orderId, referenceCode]);

            // create subscription based on plan
            const [plans] = await connection.execute('SELECT * FROM subscription_plans WHERE id = ?', [order.plan_id || order.plan_type]);
            const duration = (plans && plans[0] && plans[0].duration_days) ? plans[0].duration_days : 1;

            await connection.execute(
                `INSERT INTO vip_subscriptions (user_id, plan_id, order_id, start_date, expiry_date, status, created_at, updated_at)
                 VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'Active', NOW(), NOW())`,
                [order.user_id, order.plan_id || order.plan_type, orderId, duration]
            );

            // activity log
            await logActivity(order.user_id, 'PAYMENT_RECEIVED', 'order', String(orderId), `Payment received for order #${orderId}`, null);

            return { success: true, message: 'Payment processed successfully' };
        });

        return res.status(result.success ? 200 : 400).json(result);

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
    }
};