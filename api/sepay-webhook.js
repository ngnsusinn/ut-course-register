// ============================================
// IMPROVED SEPAY WEBHOOK WITH FK & CONSTRAINTS
// ============================================
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

// Validate environment variables
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    console.warn('⚠️  Missing database environment variables - using defaults');
}

// Create connection pool
let pool;
const getPool = () => {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
        console.log('✅ Webhook database pool created');
    }
    return pool;
};

// ============================================
// Helper functions
// ============================================

/**
 * Format Date to MySQL format: YYYY-MM-DD HH:mm:ss
 */
function formatToMySQL(dt) {
    const pad = n => (n < 10 ? '0' + n : n);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

/**
 * Process VIP payment after bank payment received
 * NOW: Uses order_id FK, validates amounts, handles cancelled orders
 */
async function processVIPPayment(orderId, transactionData) {
    let connection;
    try {
        connection = await getPool().getConnection();
        await connection.beginTransaction();

        // Query for Unpaid OR Cancelled orders (with row lock to prevent race conditions)
        const [orders] = await connection.execute(
            `SELECT 
                id,
                user_id,
                plan_type,
                plan_id,
                plan_name,
                amount,
                payment_status
             FROM orders 
             WHERE id = ? 
             AND payment_status IN ('Unpaid', 'Cancelled')
             FOR UPDATE`,
            [orderId]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Order not found or already paid' };
        }

        const order = orders[0];

        // Verify amount matches (with small tolerance for float errors)
        const txAmount = parseFloat(transactionData.amount_in || 0);
        const orderAmount = parseFloat(order.amount || 0);

        if (Math.abs(txAmount - orderAmount) > 0.01) {
            await connection.rollback();
            return { success: false, message: `Amount mismatch: received ${txAmount}, expected ${orderAmount}` };
        }

        // Check if order was already cancelled
        if (order.payment_status === 'Cancelled') {
            // Record transaction ref but DO NOT activate VIP
            await connection.execute(
                `UPDATE orders 
                 SET transaction_ref = ?, updated_at = NOW() 
                 WHERE id = ?`,
                [transactionData.reference_number, orderId]
            );
            
            // Log activity for late payment on cancelled order
            await connection.execute(
                `INSERT INTO activity_logs (user_id, action, details, created_at) 
                 VALUES (?, 'PAYMENT_ON_CANCELLED_ORDER', ?, NOW())`,
                [order.user_id, `User paid for cancelled order #${orderId} (VIP not activated)`]
            );
            
            await connection.commit();
            console.log(`⚠️  Payment received for cancelled order #${orderId}, VIP not activated`);
            
            return {
                success: true,
                message: 'Payment recorded but order was already cancelled. VIP not activated.',
                orderCancelled: true
            };
        }

        // Order is Unpaid - proceed with normal VIP activation
        // Update order status to Paid
        await connection.execute(
            `UPDATE orders 
             SET payment_status = 'Paid', paid_at = NOW(), transaction_ref = ?, updated_at = NOW() 
             WHERE id = ?`,
            [transactionData.reference_number, orderId]
        );

        // Get plan duration from database (using plan_id FK if available)
        let daysToAdd = 1;
        let planName = order.plan_name;
        // Resolve plan_id (vip_subscriptions.plan_id is NOT NULL)
        let resolvedPlanId = order.plan_id;

        if (order.plan_id) {
            // Use plan_id FK reference
            const [planData] = await connection.execute(
                `SELECT id, duration_days, plan_name 
                 FROM vip_plans 
                 WHERE id = ? AND is_active = 1`,
                [order.plan_id]
            );
            
            if (planData.length > 0) {
                daysToAdd = planData[0].duration_days;
                planName = planData[0].plan_name;
                resolvedPlanId = planData[0].id;
            }
        } else {
            // Fallback to plan_key lookup (also resolve plan_id)
            const [planData] = await connection.execute(
                `SELECT id, duration_days, plan_name 
                 FROM vip_plans 
                 WHERE plan_key = ? AND is_active = 1`,
                [order.plan_type]
            );
            
            if (planData.length > 0) {
                daysToAdd = planData[0].duration_days;
                planName = planData[0].plan_name;
                resolvedPlanId = planData[0].id;
            }
        }

        // Ensure plan_id is resolved (vip_subscriptions.plan_id is NOT NULL + FK)
        if (!resolvedPlanId) {
            await connection.rollback();
            return { success: false, message: `Cannot resolve plan_id for order #${orderId} (plan_type: ${order.plan_type})` };
        }

        // Check existing VIP subscription (use row lock)
        const [existingVIP] = await connection.execute(
            `SELECT id, expiry_date, plan_id 
             FROM vip_subscriptions 
             WHERE user_id = ? AND expiry_date > NOW() 
             ORDER BY expiry_date DESC 
             LIMIT 1 
             FOR UPDATE`,
            [order.user_id]
        );

        // Idempotency: check if this order already has a VIP subscription
        // (vip_subscriptions.order_id has UNIQUE constraint)
        const [existingSub] = await connection.execute(
            'SELECT id FROM vip_subscriptions WHERE order_id = ?',
            [orderId]
        );
        if (existingSub.length > 0) {
            // Already processed - commit the order status update and return
            await connection.commit();
            console.log(`⚠️ Order #${orderId} already has VIP subscription #${existingSub[0].id}, skipping duplicate`);
            return { success: true, message: 'Payment already processed (idempotent)', duplicate: true };
        }

        let expiryDate;

        if (existingVIP.length > 0) {
            // User already has active VIP - create NEW subscription with cumulative expiry
            expiryDate = new Date(existingVIP[0].expiry_date);
            // Round to end of current expiry day
            expiryDate.setHours(23, 59, 59, 999);
            // Add the number of days
            expiryDate.setDate(expiryDate.getDate() + daysToAdd);
            
            // Format to MySQL datetime string to preserve timezone
            const expiryString = expiryDate.getFullYear() + '-' + 
                String(expiryDate.getMonth() + 1).padStart(2, '0') + '-' + 
                String(expiryDate.getDate()).padStart(2, '0') + ' ' + 
                String(expiryDate.getHours()).padStart(2, '0') + ':' + 
                String(expiryDate.getMinutes()).padStart(2, '0') + ':' + 
                String(expiryDate.getSeconds()).padStart(2, '0');
            
            // INSERT new subscription instead of UPDATE (to preserve purchase history)
            await connection.execute(
                `INSERT INTO vip_subscriptions (
                    user_id, plan_id, plan_type, expiry_date, order_id, created_at
                ) VALUES (?, ?, ?, ?, ?, NOW())`,
                [order.user_id, resolvedPlanId, order.plan_type, expiryString, orderId]
            );
            
            console.log(`✅ Extended VIP: ${order.user_id}, +${daysToAdd} days to ${expiryDate.toLocaleString('vi-VN')}`);
        } else {
            // Create new VIP subscription (start from tomorrow midnight)
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 1);
            expiryDate.setHours(0, 0, 0, 0);
            expiryDate.setDate(expiryDate.getDate() + daysToAdd);
            // Set to end of the final day
            expiryDate.setHours(23, 59, 59, 999);
            
            // Format to MySQL datetime string to preserve timezone
            const expiryString = expiryDate.getFullYear() + '-' + 
                String(expiryDate.getMonth() + 1).padStart(2, '0') + '-' + 
                String(expiryDate.getDate()).padStart(2, '0') + ' ' + 
                String(expiryDate.getHours()).padStart(2, '0') + ':' + 
                String(expiryDate.getMinutes()).padStart(2, '0') + ':' + 
                String(expiryDate.getSeconds()).padStart(2, '0');
            
            await connection.execute(
                `INSERT INTO vip_subscriptions (
                    user_id, plan_id, plan_type, expiry_date, order_id, created_at
                ) VALUES (?, ?, ?, ?, ?, NOW())`,
                [order.user_id, resolvedPlanId, order.plan_type, expiryString, orderId]
            );
            
            console.log(`✅ Created new VIP: ${order.user_id}, expires ${expiryDate.toLocaleString('vi-VN')}`);
        }

        // Log activity
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, created_at) 
             VALUES (?, 'VIP_PURCHASE', ?, NOW())`,
            [order.user_id, `Purchased ${planName} - Order #${orderId}`]
        );

        await connection.commit();

        return {
            success: true,
            message: 'Payment processed successfully',
            expiryDate: expiryDate.toISOString(),
            orderCancelled: false
        };

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackErr) {
                console.error('❌ Rollback error:', rollbackErr.message);
            }
        }
        console.error('❌ Error in processVIPPayment:', error.message);
        return { success: false, message: error.message || 'Unknown error' };
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (releaseErr) {
                console.error('❌ Release error:', releaseErr.message);
            }
        }
    }
}

/**
 * Record transaction in database with order_id FK
 * NOTE: transactions.order_id is NOT NULL + FK constraint,
 *       so we SKIP recording if orderId is missing.
 */
async function recordTransaction(transactionData) {
    // DB constraint: order_id is NOT NULL + FK to orders.id
    // Cannot insert transaction without a valid order_id
    if (!transactionData.orderId) {
        console.warn('⚠️ Skipping transaction record: no order_id (DB NOT NULL + FK constraint).',
            'Content:', transactionData.content || 'N/A',
            'Ref:', transactionData.referenceCode || 'N/A');
        return { success: false, skipped: true, message: 'No order_id - cannot record transaction (NOT NULL constraint)' };
    }

    let connection;
    try {
        connection = await getPool().getConnection();
        
        const [result] = await connection.execute(
            `INSERT INTO transactions (
                gateway,
                transaction_date,
                account_number,
                sub_account,
                amount_in,
                amount_out,
                accumulated,
                code,
                transaction_content,
                reference_number,
                body,
                order_id,
                received_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                transactionData.gateway || '',
                transactionData.transactionDateStr,
                transactionData.accountNumber || '',
                transactionData.subAccount || '',
                transactionData.amountIn,
                transactionData.amountOut,
                transactionData.accumulated || 0,
                transactionData.code || '',
                transactionData.content || '',
                transactionData.referenceCode || '',
                transactionData.description || '',
                transactionData.orderId
            ]
        );
        
        return { success: true, transactionId: result.insertId };
    } catch (error) {
        console.error('❌ Error recording transaction:', error.message);
        return { success: false, message: error.message };
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Release error:', err);
            }
        }
    }
}

/**
 * Auto-cancel unpaid orders after 15 minutes
 * NOW: Uses stored procedure if available
 */
async function autoCancelExpiredOrders() {
    let connection;
    try {
        connection = await getPool().getConnection();
        
        // Try to use stored procedure first
        try {
            await connection.execute('CALL sp_auto_cancel_unpaid_orders()');
            console.log('✅ Auto-cancel executed via stored procedure');
            return;
        } catch (err) {
            if (err.code !== 'ER_SP_DOES_NOT_EXIST') {
                throw err;
            }
            // Fall back to direct SQL
        }
        
        // Fallback: Direct SQL update
        const [result] = await connection.execute(
            `UPDATE orders 
             SET payment_status = 'Cancelled', cancelled_at = NOW(), updated_at = NOW() 
             WHERE payment_status = 'Unpaid' 
             AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= 15`
        );
        
        if (result.affectedRows > 0) {
            console.log(`✅ Auto-cancelled ${result.affectedRows} orders`);
        }
    } catch (error) {
        console.error('❌ Error auto-cancelling orders:', error.message);
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Release error:', err);
            }
        }
    }
}

// ============================================
// MAIN WEBHOOK HANDLER
// ============================================
export default async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    // Run auto-cancel on every webhook request
    autoCancelExpiredOrders().catch(err => console.error('❌ Auto-cancel error:', err.message));

    try {
        const webhookData = req.body;

        if (!webhookData || !webhookData.content) {
            return res.status(400).json({ success: false, message: 'Invalid webhook data' });
        }

        // Destructure webhook fields
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

        // Parse and convert transaction date
        let dtObj;
        if (!transactionDate) {
            dtObj = new Date();
        } else {
            // Parse "YYYY-MM-DD HH:mm:ss" string
            const t = transactionDate.trim().replace(' ', 'T');
            dtObj = new Date(t + 'Z'); // Treat as UTC
            dtObj = new Date(dtObj.getTime() + 7 * 60 * 60 * 1000); // Convert to UTC+7
        }

        const transactionDateStr = formatToMySQL(dtObj);

        // Compute amount_in/out based on transfer type
        const amountIn = transferType === 'in' ? parseFloat(transferAmount || 0) : 0;
        const amountOut = transferType === 'out' ? parseFloat(transferAmount || 0) : 0;

        // Extract order code from transaction content
        // Pattern: DKHP + 12 alphanumeric characters
        const orderCodeRegex = /DKHP[A-Z0-9]{12}/i;
        const orderCodeMatch = (content || '').match(orderCodeRegex);

        if (!orderCodeMatch) {
            // Record transaction even if order code not found
            await recordTransaction({
                gateway,
                transactionDateStr,
                accountNumber,
                subAccount,
                amountIn,
                amountOut,
                accumulated,
                code,
                content,
                referenceCode,
                description,
                orderId: null
            });

            return res.status(200).json({
                success: false,
                message: 'Order code not found in transaction content',
                transactionRecorded: true
            });
        }

        const orderCode = orderCodeMatch[0].toUpperCase();
        
        // Find order by order_code
        let connection;
        let orderId;
        try {
            connection = await getPool().getConnection();
            const [orderRows] = await connection.execute(
                'SELECT id FROM orders WHERE order_code = ?',
                [orderCode]
            );
            
            if (orderRows.length === 0) {
                // Record transaction even if order not found
                await recordTransaction({
                    gateway,
                    transactionDateStr,
                    accountNumber,
                    subAccount,
                    amountIn,
                    amountOut,
                    accumulated,
                    code,
                    content,
                    referenceCode,
                    description,
                    orderId: null
                });

                return res.status(200).json({
                    success: false,
                    message: `Order not found for code: ${orderCode}`,
                    transactionRecorded: true
                });
            }
            
            orderId = orderRows[0].id;
        } finally {
            if (connection) connection.release();
        }

        // Record transaction with order_id FK
        const txResult = await recordTransaction({
            gateway,
            transactionDateStr,
            accountNumber,
            subAccount,
            amountIn,
            amountOut,
            accumulated,
            code,
            content,
            referenceCode,
            description,
            orderId
        });

        if (!txResult.success) {
            console.error('❌ Failed to record transaction:', txResult.message);
        }

        // Process the payment
        const paymentResult = await processVIPPayment(orderId, {
            amount_in: amountIn,
            reference_number: referenceCode
        });

        return res.status(200).json(paymentResult);

    } catch (error) {
        console.error('❌ Webhook error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error: ' + (error?.message || String(error))
        });
    }
};