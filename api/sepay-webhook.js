import mysql from 'mysql2/promise';

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'your_db_user',
    password: process.env.DB_PASSWORD || 'your_db_password',
    database: process.env.DB_NAME || 'uth_registration',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Validate environment variables
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    console.error('Missing required database environment variables');
    throw new Error('Database configuration is incomplete');
}

// Create connection pool
let pool;
const getPool = () => {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
};

// Helper: Process VIP payment with the new schema
async function processVIPPayment(orderId, webhookData) {
    const connection = await getPool().getConnection();
    try {
        // 1. Log the raw webhook payload for auditing
        const [logResult] = await connection.execute(
            'INSERT INTO payment_gateway_logs (gateway_name, raw_payload) VALUES (?, ?)',
            [`Sepay_${webhookData.gateway || 'Unknown'}`, JSON.stringify(webhookData)]
        );
        const logId = logResult.insertId;

        await connection.beginTransaction();

        // 2. Get order details and lock the row to prevent race conditions
        const [orders] = await connection.execute(
            `SELECT o.id, o.user_id, o.amount, p.duration_days 
             FROM vip_orders o
             JOIN vip_packages p ON o.package_id = p.id
             WHERE o.id = ? AND o.status = 'pending' FOR UPDATE`,
            [orderId]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Order not found or already processed' };
        }
        const order = orders[0];

        // 3. Verify amount matches
        const amountIn = webhookData.transferType === 'in' ? parseFloat(webhookData.transferAmount) : 0;
        if (amountIn !== parseFloat(order.amount)) {
            await connection.execute('UPDATE vip_orders SET status = ? WHERE id = ?', ['failed', orderId]);
            await connection.commit();
            return { success: false, message: `Amount mismatch: expected ${order.amount}, got ${amountIn}` };
        }

        // 4. Create a transaction record
        const [txnResult] = await connection.execute(
            `INSERT INTO vip_transactions (order_id, gateway_txn_id, payment_gateway, amount_paid, status) 
             VALUES (?, ?, ?, ?, 'completed')`,
            [orderId, webhookData.referenceCode, `Sepay_${webhookData.gateway}`, amountIn]
        );
        const transactionId = txnResult.insertId;
        
        // Link the log to the transaction now that we have the ID
        await connection.execute('UPDATE payment_gateway_logs SET transaction_id = ? WHERE id = ?', [transactionId, logId]);

        // 5. Update order status to 'paid'
        await connection.execute('UPDATE vip_orders SET status = ? WHERE id = ?', ['paid', orderId]);

        // 6. Grant VIP by creating a subscription record
        // Check if user has an existing, active subscription to extend the date
        const [existingVIP] = await connection.execute(
            'SELECT expires_at FROM vip_subscriptions WHERE user_id = ? AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1',
            [order.user_id]
        );

        const now = new Date();
        let startDate = now;
        if (existingVIP.length > 0) {
            // Start the new subscription period after the old one ends
            startDate = new Date(existingVIP[0].expires_at);
        }
        
        const expiryDate = new Date(startDate);
        expiryDate.setDate(expiryDate.getDate() + order.duration_days);

        await connection.execute(
            'INSERT INTO vip_subscriptions (user_id, order_id, started_at, expires_at) VALUES (?, ?, ?, ?)',
            [order.user_id, orderId, (existingVIP.length > 0 ? startDate : now), expiryDate]
        );

        await connection.commit();

        return {
            success: true,
            message: 'Payment processed successfully',
            expiryDate: expiryDate.toISOString()
        };

    } catch (error) {
        await connection.rollback();
        console.error('Error processing payment:', error);
        return { success: false, message: error.message };
    } finally {
        connection.release();
    }
}

// Main webhook handler
export default async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://your-domain.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        const webhookData = req.body;

        // Basic validation
        if (!webhookData || !webhookData.content || !webhookData.referenceCode) {
            return res.status(400).json({ success: false, message: 'Invalid webhook data' });
        }

        // Extract order ID from transaction content (e.g., "DH123")
        const regex = /DH(\d+)/i;
        const match = webhookData.content.match(regex);

        if (!match || !match[1]) {
            console.log('Webhook received, but no Order ID found in content:', webhookData.content);
            // Still save the log for manual checking
            const conn = await getPool().getConnection();
            await conn.execute(
                'INSERT INTO payment_gateway_logs (gateway_name, raw_payload) VALUES (?, ?)',
                [`Sepay_${webhookData.gateway || 'Unknown'}`, JSON.stringify(webhookData)]
            );
            conn.release();
            return res.status(200).json({ success: false, message: 'Order ID not found in transaction content' });
        }

        const orderId = parseInt(match[1], 10);

        // Process the payment using the new, robust function
        const result = await processVIPPayment(orderId, webhookData);

        return res.status(200).json(result);

    } catch (error) {
        console.error('Webhook handler error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error: ' + error.message
        });
    }
};