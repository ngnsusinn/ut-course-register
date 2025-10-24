const mysql = require('mysql2/promise');

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

// Create connection pool
let pool;
const getPool = () => {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
};

// Helper: Process VIP payment
async function processVIPPayment(orderId, transactionData) {
    const connection = await getPool().getConnection();
    
    try {
        await connection.beginTransaction();
        
        // Get order details
        const [orders] = await connection.execute(
            'SELECT * FROM orders WHERE id = ? AND payment_status = "Unpaid"',
            [orderId]
        );
        
        if (orders.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Order not found or already paid' };
        }
        
        const order = orders[0];
        
        // Verify amount matches
        if (parseFloat(transactionData.amount_in) !== parseFloat(order.amount)) {
            await connection.rollback();
            return { success: false, message: 'Amount mismatch' };
        }
        
        // Update order status
        await connection.execute(
            'UPDATE orders SET payment_status = "Paid", paid_at = NOW(), transaction_ref = ? WHERE id = ?',
            [transactionData.reference_number, orderId]
        );
        
        // Calculate VIP expiry date
        const planDurations = {
            '1day': 1,
            '3days': 3,
            '7days': 7
        };
        
        const daysToAdd = planDurations[order.plan_type] || 1;
        
        // Check if user already has VIP
        const [existingVIP] = await connection.execute(
            'SELECT * FROM vip_subscriptions WHERE user_id = ? AND expiry_date > NOW() ORDER BY expiry_date DESC LIMIT 1',
            [order.user_id]
        );
        
        let expiryDate;
        if (existingVIP.length > 0) {
            // Extend existing VIP
            expiryDate = new Date(existingVIP[0].expiry_date);
            expiryDate.setDate(expiryDate.getDate() + daysToAdd);
            
            await connection.execute(
                'UPDATE vip_subscriptions SET expiry_date = ?, plan_type = ?, updated_at = NOW() WHERE user_id = ? AND expiry_date > NOW()',
                [expiryDate, order.plan_type, order.user_id]
            );
        } else {
            // Create new VIP subscription
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + daysToAdd);
            
            await connection.execute(
                'INSERT INTO vip_subscriptions (user_id, plan_type, expiry_date) VALUES (?, ?, ?)',
                [order.user_id, order.plan_type, expiryDate]
            );
        }
        
        // Log activity
        await connection.execute(
            'INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)',
            [order.user_id, 'VIP_PURCHASE', `Purchased ${order.plan_name} - Order #${orderId}`]
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
module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
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
        
        // Validate webhook data
        if (!webhookData || !webhookData.content) {
            return res.status(400).json({ success: false, message: 'Invalid webhook data' });
        }
        
        const connection = await getPool().getConnection();
        
        try {
            // Save transaction to database
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
            const amountOut = transferType === 'out' ? transferAmount : 0;
            
            await connection.execute(
                `INSERT INTO transactions 
                (gateway, transaction_date, account_number, sub_account, amount_in, amount_out, 
                accumulated, code, transaction_content, reference_number, body) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [gateway, transactionDate, accountNumber, subAccount || '', amountIn, amountOut,
                 accumulated, code, content, referenceCode, description || '']
            );
            
            connection.release();
            
            // Extract order ID from transaction content
            const regex = /DH(\d+)/i;
            const match = content.match(regex);
            
            if (!match || !match[1]) {
                return res.status(200).json({
                    success: false,
                    message: 'Order ID not found in transaction content'
                });
            }
            
            const orderId = parseInt(match[1]);
            
            // Process the payment
            const result = await processVIPPayment(orderId, {
                amount_in: amountIn,
                reference_number: referenceCode
            });
            
            // Update transaction with order_id
            const conn = await getPool().getConnection();
            await conn.execute(
                'UPDATE transactions SET order_id = ? WHERE reference_number = ?',
                [orderId, referenceCode]
            );
            conn.release();
            
            return res.status(200).json(result);
            
        } catch (error) {
            connection.release();
            throw error;
        }
        
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error: ' + error.message
        });
    }
};