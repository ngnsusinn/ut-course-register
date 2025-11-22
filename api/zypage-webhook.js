import mysql from 'mysql2/promise';

// ============================================
// Database configuration
// ============================================
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

// Create connection pool
let pool;
const getPool = () => {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
        console.log('✅ Zypage Webhook database pool created');
    }
    return pool;
};

/**
 * Format Date to MySQL format: YYYY-MM-DD HH:mm:ss
 */
function formatToMySQL(dt) {
    const pad = n => (n < 10 ? '0' + n : n);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

/**
 * Process VIP payment from Zypage
 * Matches plan by amount and user by content
 */
async function processVIPPayment(userId, transactionData) {
    let connection;
    try {
        connection = await getPool().getConnection();
        await connection.beginTransaction();

        // 1. Validate User
        const [users] = await connection.execute(
            'SELECT id, user_id FROM users WHERE user_id = ?',
            [userId]
        );

        if (users.length === 0) {
            await connection.rollback();
            return { success: false, message: `User ${userId} not found` };
        }

        // 2. Find Plan by Amount
        const txAmount = parseFloat(transactionData.amount || 0);
        
        // Find plan with matching price (allow small difference)
        const [plans] = await connection.execute(
            `SELECT id, plan_key, plan_name, duration_days, price 
             FROM vip_plans 
             WHERE ABS(price - ?) < 1000 
             AND is_active = 1 
             LIMIT 1`,
            [txAmount]
        );

        if (plans.length === 0) {
            await connection.rollback();
            return { success: false, message: `No VIP plan found for amount ${txAmount}` };
        }

        const plan = plans[0];
        const durationDays = plan.duration_days;

        // 3. Create Order Record (for history)
        const orderCode = `ZY${Date.now()}`; // Generate a simple order code
        
        await connection.execute(
            `INSERT INTO orders (
                order_code, user_id, plan_id, plan_type, plan_name, 
                amount, payment_status, gateway, transaction_ref, 
                paid_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'Paid', 'Zypage', ?, NOW(), NOW(), NOW())`,
            [
                orderCode, userId, plan.id, plan.plan_key, plan.plan_name,
                txAmount, transactionData.transaction_id
            ]
        );

        // 4. Activate/Extend VIP
        const [subs] = await connection.execute(
            'SELECT id, expiry_date FROM vip_subscriptions WHERE user_id = ? ORDER BY expiry_date DESC LIMIT 1',
            [userId]
        );
        
        let newExpiryDate;
        const now = new Date();
        
        if (subs.length > 0 && new Date(subs[0].expiry_date) > now) {
            // Extend
            const currentExpiry = new Date(subs[0].expiry_date);
            currentExpiry.setDate(currentExpiry.getDate() + durationDays);
            newExpiryDate = currentExpiry;
            
            await connection.execute(
                'UPDATE vip_subscriptions SET expiry_date = ?, updated_at = NOW() WHERE id = ?',
                [formatToMySQL(newExpiryDate), subs[0].id]
            );
        } else {
            // New
            const expiry = new Date();
            expiry.setDate(expiry.getDate() + durationDays);
            newExpiryDate = expiry;
            
            await connection.execute(
                `INSERT INTO vip_subscriptions (user_id, plan_id, plan_type, start_date, expiry_date, status, created_at)
                 VALUES (?, ?, ?, NOW(), ?, 'Active', NOW())`,
                [userId, plan.id, plan.plan_key, formatToMySQL(newExpiryDate)]
            );
        }
        
        // Log activity
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, created_at) 
             VALUES (?, 'VIP_PURCHASE', ?, NOW())`,
            [userId, `Purchased VIP ${plan.plan_name} via Zypage (${txAmount}đ)`]
        );

        await connection.commit();
        return { success: true, message: 'VIP activated successfully' };

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error processing payment:', error);
        return { success: false, message: error.message };
    } finally {
        if (connection) connection.release();
    }
}

export default async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const data = req.body;
        console.log('Zypage Webhook received:', data);
        
        // Extract User ID from content
        // Expect content to contain the User ID (e.g. "2011060123" or "nguyenvana")
        // We'll assume the content IS the User ID or contains it clearly.
        // For simplicity, let's try to find a string that matches a user ID pattern or just take the whole content trimmed.
        
        let content = data.content || data.description || '';
        content = content.trim();
        
        // Simple heuristic: The content is likely the User ID
        // If there are extra words, we might need a regex. 
        // Let's assume the user enters ONLY their Student ID/Username as instructed.
        // Or we can try to extract the first word.
        const userId = content.split(' ')[0]; 
        
        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID not found in content' });
        }
        
        const amount = data.amount || data.money || 0;
        
        const result = await processVIPPayment(userId, {
            amount: amount,
            transaction_id: data.transaction_id || data.id || 'UNKNOWN'
        });
        
        if (result.success) {
            res.status(200).json({ success: true, message: 'Payment processed' });
        } else {
            res.status(400).json(result);
        }
        
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
