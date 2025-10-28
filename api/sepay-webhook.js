import mysql from 'mysql2/promise';

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'your_db_user',
    password: process.env.DB_PASSWORD || 'your_db_password',
    database: process.env.DB_NAME || 'uth_registration',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+07:00'
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

// helper: format Date -> 'YYYY-MM-DD HH:mm:ss'
function formatToMySQL(dt) {
    const pad = n => (n < 10 ? '0' + n : n);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

// Helper: Process VIP payment (kept logic but ensure safe release)
async function processVIPPayment(orderId, transactionData) {
    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            'SELECT * FROM orders WHERE id = ? AND payment_status = "Unpaid" FOR UPDATE',
            [orderId]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Order not found or already paid' };
        }

        const order = orders[0];

        if (order.payment_status === 'Cancelled') {
            await connection.rollback();
            return { success: false, message: 'Order has been cancelled' };
        }

        // Verify amount matches; cast both to numbers
        const txAmount = parseFloat(transactionData.amount_in || 0);
        const orderAmount = parseFloat(order.amount || 0);

        if (Math.abs(txAmount - orderAmount) > 0.001) {
            await connection.rollback();
            return { success: false, message: 'Amount mismatch' };
        }

        // Update order status
        await connection.execute(
            'UPDATE orders SET payment_status = "Paid", paid_at = NOW(), transaction_ref = ?, updated_at = NOW() WHERE id = ?',
            [transactionData.reference_number, orderId]
        );

        // Get plan duration from database
        const [planData] = await connection.execute(
            'SELECT duration_days, plan_name FROM vip_plans WHERE plan_key = ? AND is_active = 1',
            [order.plan_type]
        );
        
        let daysToAdd;
        if (planData.length === 0) {
            // Fallback to hardcoded durations if plan not in database
            const planDurations = {
                '1day': 1,
                '3days': 3,
                '7days': 7,
                '30days': 30
            };
            daysToAdd = planDurations[order.plan_type] || 1;
        } else {
            daysToAdd = planData[0].duration_days;
        }

        // Check existing VIP (use FOR UPDATE to avoid race)
        const [existingVIP] = await connection.execute(
            'SELECT * FROM vip_subscriptions WHERE user_id = ? AND expiry_date > NOW() ORDER BY expiry_date DESC LIMIT 1 FOR UPDATE',
            [order.user_id]
        );

        let expiryDate;
        if (existingVIP.length > 0) {
            // Extend from existing expiry date - update directly with DATE_ADD in SQL
            await connection.execute(
                'UPDATE vip_subscriptions SET expiry_date = DATE_ADD(?, INTERVAL ? DAY), plan_type = ?, updated_at = NOW() WHERE id = ?',
                [existingVIP[0].expiry_date, daysToAdd, order.plan_type, existingVIP[0].id]
            );
            
            // Get the calculated expiry for logging
            const [result] = await connection.execute(
                'SELECT DATE_FORMAT(DATE_ADD(?, INTERVAL ? DAY), "%Y-%m-%d %H:%i:%s") as new_expiry',
                [existingVIP[0].expiry_date, daysToAdd]
            );
            expiryDate = result[0].new_expiry;
        } else {
            // Start from now - insert directly with DATE_ADD in SQL
            await connection.execute(
                'INSERT INTO vip_subscriptions (user_id, plan_type, expiry_date, created_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), NOW())',
                [order.user_id, order.plan_type, daysToAdd]
            );
            
            // Get the calculated expiry for logging
            const [result] = await connection.execute(
                'SELECT DATE_FORMAT(DATE_ADD(NOW(), INTERVAL ? DAY), "%Y-%m-%d %H:%i:%s") as new_expiry',
                [daysToAdd]
            );
            expiryDate = result[0].new_expiry;
        }

        console.log(`[DEBUG WEBHOOK] Inserted VIP with expiry date: ${expiryDate} for ${daysToAdd} days, order #${orderId}`);

        // Log activity
        await connection.execute(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
            [order.user_id, 'VIP_PURCHASE', `Purchased ${order.plan_name} - Order #${orderId}`]
        );

        await connection.commit();

        return {
            success: true,
            message: 'Payment processed successfully',
            expiryDate: new Date(expiryDate).toISOString()
        };

    } catch (error) {
        try { await connection.rollback(); } catch (_) {}
        console.error('Error in processVIPPayment:', error);
        return { success: false, message: error.message || 'Unknown error' };
    } finally {
        connection.release();
    }
}

// Main webhook handler
export default async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://your-domain.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    try {
        const webhookData = req.body;

        if (!webhookData || !webhookData.content) {
            return res.status(400).json({ success: false, message: 'Invalid webhook data' });
        }

        // destructure safely
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

        // convert transactionDate string -> JS Date assuming incoming time is UTC or local.
        // If incoming is already local VN time, remove the +7 logic.
        // Here we assume incoming is UTC string "YYYY-MM-DD HH:mm:ss" -> treat it as UTC then add +7
        // If your bank sends VN local time already, set useAsIs = true.
        const useAsIs = false; // set true if incoming transactionDate already in +07:00
        let dtObj;
        if (!transactionDate) {
            dtObj = new Date(); // fallback to now
        } else {
            // Parse "YYYY-MM-DD HH:mm:ss" by replacing space with 'T' and treating as UTC if useAsIs=false
            const t = transactionDate.trim().replace(' ', 'T');
            if (useAsIs) {
                // treat as local VN time -> create Date from components without timezone shift
                // create as local by appending local offset
                dtObj = new Date(t);
            } else {
                // treat as UTC then add +7
                dtObj = new Date(t + 'Z'); // force as UTC
                dtObj = new Date(dtObj.getTime() + 7 * 60 * 60 * 1000); // shift to +07:00
            }
        }

        const transactionDateStr = formatToMySQL(dtObj);

        // compute amount_in/out depending on transferType
        const amountIn = transferType === 'in' ? parseFloat(transferAmount || 0) : 0;
        const amountOut = transferType === 'out' ? parseFloat(transferAmount || 0) : 0;

        // Insert transaction (use a dedicated connection)
        const conn = await getPool().getConnection();
        try {
            await conn.execute(
                `INSERT INTO transactions 
                (gateway, transaction_date, account_number, sub_account, amount_in, amount_out, 
                accumulated, code, transaction_content, reference_number, body, received_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [gateway || '', transactionDateStr, accountNumber || '', subAccount || '', amountIn, amountOut,
                 accumulated || 0, code || '', content || '', referenceCode || '', description || '']
            );
        } finally {
            conn.release();
        }

        // Extract order ID from transaction content (pattern DH<number>)
        const regex = /DH(\d+)/i;
        const match = (content || '').match(regex);

        if (!match || !match[1]) {
            return res.status(200).json({
                success: false,
                message: 'Order ID not found in transaction content'
            });
        }

        const orderId = parseInt(match[1], 10);

        // Process the payment (this will update orders, vip_subscriptions, activity_logs)
        const result = await processVIPPayment(orderId, {
            amount_in: amountIn,
            reference_number: referenceCode
        });

        // Update transactions row to set order_id where reference_number matches (safe update)
        const conn2 = await getPool().getConnection();
        try {
            await conn2.execute(
                'UPDATE transactions SET order_id = ? WHERE reference_number = ?',
                [orderId, referenceCode]
            );
        } finally {
            conn2.release();
        }

        return res.status(200).json(result);

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error: ' + (error && error.message ? error.message : String(error))
        });
    }
};
