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

        if (!plan.length) {
            throw new Error('Invalid plan ID');
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