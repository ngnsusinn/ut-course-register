import { executeQuery, getPool } from './db_connect.js';

/**
 * Execute a transaction with multiple queries
 * @param {function} callback - Callback function that receives transaction object
 * @returns {Promise<any>}
 */
export async function executeTransaction(callback) {
    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Insert activity log
 * @param {string} userId - User ID
 * @param {string} action - Action performed
 * @param {string} entityType - Type of entity (order, subscription, etc)
 * @param {string} entityId - ID of the entity
 * @param {string} details - Additional details
 * @param {string} ipAddress - IP address of the user
 */
export async function logActivity(userId, action, entityType, entityId, details, ipAddress) {
    const query = `
        INSERT INTO activity_logs 
        (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    await executeQuery(query, [userId, action, entityType, entityId, details, ipAddress]);
}

/**
 * Get active subscription for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>}
 */
export async function getActiveSubscription(userId) {
    const query = `
        SELECT vs.*, sp.name as plan_name, sp.duration_days
        FROM vip_subscriptions vs
        JOIN subscription_plans sp ON vs.plan_id = sp.id
        WHERE vs.user_id = ? 
        AND vs.status = 'Active'
        AND vs.expiry_date > NOW()
        ORDER BY vs.expiry_date DESC
        LIMIT 1
    `;
    const results = await executeQuery(query, [userId]);
    return results.length > 0 ? results[0] : null;
}

/**
 * Create a new order
 * @param {string} userId - User ID
 * @param {string} planId - Subscription plan ID
 * @returns {Promise<Object>}
 */
export async function createOrder(userId, planId) {
    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();

        // Get plan details
        const [plan] = await connection.execute(
            'SELECT * FROM subscription_plans WHERE id = ?',
            [planId]
        );

        // If plan not present in DB, try to create it from a default mapping (fallback)
        const DEFAULT_PLANS = {
            '1day': { name: '1 Ngày VIP', duration_days: 1, price: 24000.00 },
            '3days': { name: '3 Ngày VIP', duration_days: 3, price: 72000.00 },
            '7days': { name: '7 Ngày VIP', duration_days: 7, price: 126000.00 },
            '30days': { name: '30 Ngày VIP', duration_days: 30, price: 432000.00 }
        };

        if (!plan.length) {
            // try fallback
            const fallback = DEFAULT_PLANS[planId];
            if (!fallback) {
                throw new Error('Invalid plan ID: ' + planId);
            }

            // insert fallback plan into subscription_plans so DB is consistent
            await connection.execute(
                `INSERT INTO subscription_plans (id, name, duration_days, price, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
                [planId, fallback.name, fallback.duration_days, fallback.price]
            );

            // re-query plan
            const [newPlanRows] = await connection.execute('SELECT * FROM subscription_plans WHERE id = ?', [planId]);
            if (!newPlanRows.length) throw new Error('Failed to create fallback plan record for ' + planId);
            plan[0] = newPlanRows[0];
        }

        // Ensure user exists (to satisfy FK). If not, create a minimal user record.
        const [userRows] = await connection.execute('SELECT id FROM users WHERE id = ?', [userId]);
        if (!userRows || userRows.length === 0) {
            await connection.execute(
                `INSERT INTO users (id, username, status, created_at, updated_at) VALUES (?, ?, 'active', NOW(), NOW())`,
                [userId, userId]
            );
        }

        // Create order
        const [result] = await connection.execute(
            `INSERT INTO orders (user_id, plan_id, amount) 
             VALUES (?, ?, ?)`,
            [userId, planId, plan[0].price]
        );

        await connection.commit();
        return { orderId: result.insertId, amount: plan[0].price };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Process payment for an order
 * @param {number} orderId - Order ID
 * @param {string} transactionRef - Transaction reference
 * @param {Object} paymentDetails - Payment details
 */
export async function processPayment(orderId, transactionRef, paymentDetails) {
    return executeTransaction(async (connection) => {
        // Get order details
        const [orders] = await connection.execute(
            'SELECT * FROM orders WHERE id = ?',
            [orderId]
        );

        if (!orders.length) {
            throw new Error('Order not found');
        }

        const order = orders[0];

        // Update order status
        await connection.execute(
            `UPDATE orders 
             SET payment_status = 'Paid', 
                 transaction_ref = ?,
                 paid_at = NOW()
             WHERE id = ?`,
            [transactionRef, orderId]
        );

        // Create transaction record
        await connection.execute(
            `INSERT INTO transactions 
             (order_id, gateway, transaction_date, account_number, amount,
              status, reference_number, transaction_content)
             VALUES (?, ?, NOW(), ?, ?, 'Success', ?, ?)`,
            [
                orderId,
                paymentDetails.gateway,
                paymentDetails.accountNumber,
                order.amount,
                transactionRef,
                paymentDetails.content
            ]
        );

        // Create subscription
        const [plans] = await connection.execute(
            'SELECT * FROM subscription_plans WHERE id = ?',
            [order.plan_id]
        );

        await connection.execute(
            `INSERT INTO vip_subscriptions 
             (user_id, plan_id, order_id, expiry_date)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
            [order.user_id, order.plan_id, orderId, plans[0].duration_days]
        );

        return { success: true };
    });
}