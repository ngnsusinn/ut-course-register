import mysql from 'mysql2/promise';
import MoMoPayment from './momo-payment.js';

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+07:00'
};

let pool;
const getPool = () => {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
};

/**
 * MoMo Webhook Handler for IPN (Instant Payment Notification)
 */
export default async function handler(req, res) {
    // Only accept POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }

    try {
        const ipnData = req.body;
        console.log('📩 MoMo IPN Received:', JSON.stringify(ipnData, null, 2));

        // Get MoMo configuration from database
        const pool = getPool();
        const [settings] = await pool.execute(
            'SELECT * FROM payment_settings WHERE payment_method = ? AND is_active = 1 LIMIT 1',
            ['momo']
        );

        if (!settings || settings.length === 0) {
            console.error('❌ MoMo payment method not configured');
            return res.status(400).json({
                success: false,
                message: 'MoMo payment method not configured'
            });
        }

        const momoConfig = settings[0];
        const momo = new MoMoPayment({
            partnerCode: momoConfig.momo_partner_code,
            accessKey: momoConfig.momo_access_key,
            secretKey: momoConfig.momo_secret_key,
            redirectUrl: process.env.MOMO_REDIRECT_URL || 'https://yourdomain.com/payment/return',
            ipnUrl: process.env.MOMO_IPN_URL || 'https://yourdomain.com/api/momo-webhook',
            isProduction: process.env.NODE_ENV === 'production'
        });

        // Verify IPN signature
        const verification = momo.verifyIPN(ipnData);

        if (!verification.valid) {
            console.error('❌ Invalid MoMo signature');
            return res.status(400).json({
                success: false,
                message: 'Invalid signature'
            });
        }

        const { orderId, transId, resultCode, amount } = verification;

        // Check if order exists
        const [orders] = await pool.execute(
            'SELECT * FROM orders WHERE momo_order_id = ? LIMIT 1',
            [orderId]
        );

        if (!orders || orders.length === 0) {
            console.error('❌ Order not found:', orderId);
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        // Check if already processed
        if (order.payment_status === 'Paid') {
            console.log('⚠️ Order already processed:', orderId);
            return res.status(200).json({
                success: true,
                message: 'Order already processed'
            });
        }

        // Process payment based on result code
        if (resultCode === 0) {
            // Payment successful
            console.log('✅ MoMo Payment successful:', orderId);

            // Update order status
            await pool.execute(
                `UPDATE orders 
                SET payment_status = 'Paid', 
                    momo_trans_id = ?,
                    paid_at = NOW(),
                    updated_at = NOW()
                WHERE id = ?`,
                [transId, order.id]
            );

            // Get user info
            const [users] = await pool.execute(
                'SELECT * FROM users WHERE username = ? LIMIT 1',
                [order.user_id]
            );

            let userId = order.user_id;
            if (!users || users.length === 0) {
                // Create new user if not exists
                await pool.execute(
                    'INSERT INTO users (username, created_at) VALUES (?, NOW())',
                    [order.user_id]
                );
            }

            // Check existing VIP subscription
            const [existingSubs] = await pool.execute(
                'SELECT * FROM vip_subscriptions WHERE user_id = ? ORDER BY expiry_date DESC LIMIT 1',
                [userId]
            );

            let expiryDate;
            const now = new Date();

            if (existingSubs && existingSubs.length > 0) {
                const existingExpiry = new Date(existingSubs[0].expiry_date);
                const startDate = existingExpiry > now ? existingExpiry : now;
                expiryDate = calculateExpiryDate(startDate, order.plan_type);
            } else {
                expiryDate = calculateExpiryDate(now, order.plan_type);
            }

            // Create VIP subscription
            await pool.execute(
                'INSERT INTO vip_subscriptions (user_id, plan_type, expiry_date, created_at) VALUES (?, ?, ?, NOW())',
                [userId, order.plan_type, expiryDate]
            );

            // Log activity
            await pool.execute(
                'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
                [userId, 'VIP_PURCHASE', `Purchased ${order.plan_name} - Order #${order.id} via MoMo`]
            );

            console.log('✅ VIP subscription created successfully');

        } else {
            // Payment failed
            console.log('❌ MoMo Payment failed:', orderId, 'Result code:', resultCode);
            
            await pool.execute(
                `UPDATE orders 
                SET payment_status = 'Cancelled',
                    momo_trans_id = ?,
                    updated_at = NOW()
                WHERE id = ?`,
                [transId, order.id]
            );
        }

        // Return success response to MoMo
        return res.status(200).json({
            success: true,
            message: 'IPN processed successfully'
        });

    } catch (error) {
        console.error('❌ MoMo Webhook Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
}

/**
 * Calculate expiry date based on plan type
 */
function calculateExpiryDate(startDate, planType) {
    const date = new Date(startDate);
    
    switch(planType) {
        case '1day':
            date.setDate(date.getDate() + 1);
            break;
        case '3days':
            date.setDate(date.getDate() + 3);
            break;
        case '7days':
            date.setDate(date.getDate() + 7);
            break;
        case '30days':
            date.setDate(date.getDate() + 30);
            break;
        case 'infinite':
            date.setFullYear(date.getFullYear() + 100);
            break;
        default:
            date.setDate(date.getDate() + 1);
    }
    
    return date;
}
