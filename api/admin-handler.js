// File: New folder/api/admin-handler.js
import mysql from 'mysql2/promise';

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+07:00' // phiên DB ở UTC+7
};

let pool;
try {
    pool = mysql.createPool(dbConfig);
} catch (error) {
    console.error('Failed to create admin database pool:', error);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

    const { action, payload } = req.body;
    if (!action) return res.status(400).json({ success: false, message: 'Action required' });

    try {
        let result;
        switch (action) {
            case 'login': result = await adminLogin(payload); break;
            case 'getAllUsers': result = await getAllUsers(); break;
            case 'getAllSubscriptions': result = await getAllSubscriptions(); break;
            case 'getAllOrders': result = await getAllOrders(); break;
            case 'getAllTransactions': result = await getAllTransactions(); break;
            case 'getAllLogs': result = await getAllLogs(); break;
            case 'addVIPSubscription': result = await addVIPSubscription(payload); break;
            case 'deleteSubscription': result = await deleteSubscription(payload); break;
            case 'deleteUser': result = await deleteUser(payload); break;
            default: return res.status(400).json({ success: false, message: 'Unknown action' });
        }
        return res.status(200).json(result);
    } catch (error) {
        console.error(`Error: ${action}`, error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

async function adminLogin(payload) {
    const { username, password } = payload;
    if (!username || !password) return { success: false, message: 'Username and password required' };

    const connection = await pool.getConnection();
    try {
        const [admins] = await connection.query(
            'SELECT id, username, full_name, role FROM admins WHERE username = ? AND password_hash = ? AND is_active = 1',
            [username, password]
        );

        if (admins.length === 0) return { success: false, message: 'Invalid credentials' };

        // FIX: dùng NOW() theo session UTC+7
        await connection.query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admins[0].id]);

        return { success: true, admin: admins[0] };
    } finally {
        connection.release();
    }
}

async function getAllUsers() {
    const connection = await pool.getConnection();
    try {
        const [users] = await connection.query(`
            SELECT 
                u.username as user_id,
                u.full_name,
                u.email,
                MAX(vs.expiry_date) as expiry_date,
                CASE WHEN MAX(vs.expiry_date) > NOW() THEN 1 ELSE 0 END as is_vip
            FROM users u
            LEFT JOIN vip_subscriptions vs ON u.username = vs.user_id
            GROUP BY u.username, u.full_name, u.email
            ORDER BY u.username ASC
        `);
        return { success: true, users };
    } finally {
        connection.release();
    }
}

async function getAllSubscriptions() {
    const connection = await pool.getConnection();
    try {
        const [subscriptions] = await connection.query(`
            SELECT id, user_id, plan_type, expiry_date, created_at
            FROM vip_subscriptions ORDER BY created_at DESC
        `);
        return { success: true, subscriptions };
    } finally {
        connection.release();
    }
}

async function getAllOrders() {
    const connection = await pool.getConnection();
    try {
        const [orders] = await connection.query(`
            SELECT id, user_id, plan_name, amount, payment_status, created_at
            FROM orders ORDER BY created_at DESC
        `);
        return { success: true, orders };
    } finally {
        connection.release();
    }
}

async function getAllTransactions() {
    const connection = await pool.getConnection();
    try {
        const [transactions] = await connection.query(`
            SELECT id, gateway, amount_in, transaction_content, reference_number, received_at
            FROM transactions ORDER BY received_at DESC
        `);
        return { success: true, transactions };
    } finally {
        connection.release();
    }
}

async function getAllLogs() {
    const connection = await pool.getConnection();
    try {
        const [logs] = await connection.query(`
            SELECT id, user_id, action, details, created_at
            FROM activity_logs ORDER BY created_at DESC LIMIT 500
        `);
        return { success: true, logs };
    } finally {
        connection.release();
    }
}

async function addVIPSubscription(payload) {
    const { userId, planType } = payload;
    if (!userId || !planType) return { success: false, message: 'userId and planType required' };

    const planDurations = { '1day': 1, '3days': 3, '7days': 7, '30days': 30 };
    const days = planDurations[planType];
    if (!days) return { success: false, message: 'Invalid plan type' };

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Check if user exists
        const [existingUser] = await connection.query('SELECT id FROM users WHERE username = ?', [userId]);
        if (existingUser.length === 0) {
            // FIX: NOW() theo phiên
            await connection.query('INSERT INTO users (username, created_at) VALUES (?, NOW())', [userId]);
        }

        // Check for active VIP subscription
        const [activeVIP] = await connection.query(
            'SELECT expiry_date FROM vip_subscriptions WHERE user_id = ? AND expiry_date > NOW() ORDER BY expiry_date DESC LIMIT 1',
            [userId]
        );

        let expiryDate;
        let addType = 'new';

        if (activeVIP.length > 0) {
            // extend
            expiryDate = new Date(activeVIP[0].expiry_date);
            expiryDate.setDate(expiryDate.getDate() + days);
            addType = 'cumulative';
        } else {
            // start from now
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + days);
            addType = 'new';
        }

        // Insert new VIP subscription
        // FIX: created_at = NOW()
        await connection.query(
            'INSERT INTO vip_subscriptions (user_id, plan_type, expiry_date, created_at) VALUES (?, ?, ?, NOW())',
            [userId, planType, expiryDate]
        );

        const logDetails = addType === 'cumulative' 
            ? `Admin added ${planType} VIP (cộng dồn) - New expiry: ${expiryDate.toLocaleString('vi-VN')}`
            : `Admin added ${planType} VIP (mới) - Expiry: ${expiryDate.toLocaleString('vi-VN')}`;

        // FIX: created_at = NOW()
        await connection.query(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, "ADMIN_ADD_VIP", ?, NOW())',
            [userId, logDetails]
        );

        await connection.commit();

        return { 
            success: true, 
            message: addType === 'cumulative' 
                ? `Đã cộng thêm ${days} ngày VIP (cộng dồn)` 
                : `Đã thêm VIP ${days} ngày mới`,
            expiryDate,
            addType
        };
    } catch (error) {
        await connection.rollback();
        console.error('Error adding VIP:', error);
        return { success: false, message: 'Failed to add VIP', error: error.message };
    } finally {
        connection.release();
    }
}

async function deleteUser(payload) {
    const { userId } = payload;
    if (!userId) return { success: false, message: 'userId required' };

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await connection.query('DELETE FROM vip_subscriptions WHERE user_id = ?', [userId]);
        await connection.query('DELETE FROM users WHERE username = ?', [userId]);

        // FIX: created_at = NOW()
        await connection.query(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, "ADMIN_DELETE_USER", ?, NOW())',
            [userId, `Admin deleted user ${userId} and all related data`]
        );

        await connection.commit();
        return { success: true, message: 'User deleted successfully' };
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting user:', error);
        return { success: false, message: 'Failed to delete user', error: error.message };
    } finally {
        connection.release();
    }
}

async function deleteSubscription(payload) {
    const { subscriptionId } = payload;
    if (!subscriptionId) return { success: false, message: 'subscriptionId required' };

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [subscription] = await connection.query('SELECT user_id, plan_type FROM vip_subscriptions WHERE id = ?', [subscriptionId]);
        if (subscription.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Subscription not found' };
        }

        const userId = subscription[0].user_id;
        await connection.query('DELETE FROM vip_subscriptions WHERE id = ?', [subscriptionId]);

        // FIX: created_at = NOW()
        await connection.query(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, "ADMIN_DELETE_VIP", ?, NOW())',
            [userId, `Admin deleted VIP subscription #${subscriptionId}`]
        );

        await connection.commit();
        return { success: true, message: 'Subscription deleted' };
    } catch (error) {
        await connection.rollback();
        return { success: false, message: 'Failed to delete', error: error.message };
    } finally {
        connection.release();
    }
}
