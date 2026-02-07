// ============================================
// IMPROVED ADMIN HANDLER WITH FK SUPPORT
// ============================================
import mysql from 'mysql2/promise';

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

let pool;
try {
    pool = mysql.createPool(dbConfig);
    console.log('✅ Admin database pool created');
} catch (error) {
    console.error('❌ Failed to create admin database pool:', error);
}

export default async function handler(req, res) {
    // Helper to extract IP and User-Agent
    const getClientInfo = (r) => ({
        ip: r?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || r?.headers?.['x-real-ip'] || r?.socket?.remoteAddress || null,
        ua: r?.headers?.['user-agent'] || null
    });
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
            case 'getUserActivity': result = await getUserActivity(payload); break;
            case 'getActiveUsers': result = await getActiveUsers(); break;
            case 'addVIPSubscription': result = await addVIPSubscription(payload, req); break;
            case 'deleteSubscription': result = await deleteSubscription(payload, req); break;
            case 'deleteUser': result = await deleteUser(payload, req); break;
            case 'getDashboardStats': result = await getDashboardStats(); break;
            case 'getAllVIPPlans': result = await getAllVIPPlans(); break;
            case 'createVIPPlan': result = await createVIPPlan(payload, req); break;
            case 'updateVIPPlan': result = await updateVIPPlan(payload, req); break;
            case 'deleteVIPPlan': result = await deleteVIPPlan(payload, req); break;
            case 'toggleVIPPlanStatus': result = await toggleVIPPlanStatus(payload, req); break;
            default: return res.status(400).json({ success: false, message: 'Unknown action' });
        }
        return res.status(200).json(result);
    } catch (error) {
        console.error(`❌ Error: ${action}`, error.message);
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
}

// ============================================
// Authentication
// ============================================

async function adminLogin(payload) {
    const { username, password } = payload;
    if (!username || !password) {
        return { success: false, message: 'Username and password required' };
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [admins] = await connection.execute(
            'SELECT id, username, full_name, role FROM admins WHERE username = ? AND password_hash = ? AND is_active = 1',
            [username, password]
        );

        if (admins.length === 0) {
            return { success: false, message: 'Invalid credentials' };
        }

        // Update last login timestamp
        await connection.execute(
            'UPDATE admins SET last_login = NOW() WHERE id = ?',
            [admins[0].id]
        );

        return { success: true, admin: admins[0] };
    } finally {
        if (connection) connection.release();
    }
}

// ============================================
// User Management
// ============================================

async function getAllUsers() {
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Use improved schema with user_id as primary identifier
        const [users] = await connection.execute(`
            SELECT 
                u.user_id,
                u.full_name,
                u.email,
                u.is_active,
                MAX(vs.expiry_date) as expiry_date,
                CASE WHEN MAX(vs.expiry_date) > NOW() THEN 1 ELSE 0 END as is_vip
            FROM users u
            LEFT JOIN vip_subscriptions vs ON u.user_id = vs.user_id
            GROUP BY u.user_id, u.full_name, u.email, u.is_active
            ORDER BY u.user_id ASC
        `);
        return { success: true, users };
    } finally {
        if (connection) connection.release();
    }
}

// ============================================
// VIP Subscriptions Management
// ============================================

async function getAllSubscriptions() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [subscriptions] = await connection.execute(`
            SELECT 
                vs.id,
                vs.user_id,
                vs.plan_id,
                vs.order_id,
                o.order_code,
                vs.plan_type,
                vp.plan_name,
                vs.expiry_date,
                vs.created_by_admin,
                vs.created_at
            FROM vip_subscriptions vs
            LEFT JOIN vip_plans vp ON vs.plan_id = vp.id
            LEFT JOIN orders o ON vs.order_id = o.id
            ORDER BY vs.created_at DESC
        `);
        return { success: true, subscriptions };
    } finally {
        if (connection) connection.release();
    }
}

async function addVIPSubscription(payload, req = null) {
    const { userId, planType } = payload;
    if (!userId || !planType) {
        return { success: false, message: 'userId and planType required' };
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Get plan info from database
        const [planData] = await connection.execute(
            'SELECT id, duration_days, plan_name FROM vip_plans WHERE plan_key = ?',
            [planType]
        );
        
        if (planData.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Invalid plan type' };
        }
        
        const planId = planData[0].id;
        const days = planData[0].duration_days;
        const planName = planData[0].plan_name;

        // VALIDATION: Check user exists (FK constraint)
        const [existingUser] = await connection.execute(
            'SELECT id FROM users WHERE user_id = ?',
            [userId]
        );
        
        if (existingUser.length === 0) {
            // Create user if doesn't exist
            await connection.execute(
                'INSERT INTO users (user_id, is_active, created_at) VALUES (?, 1, NOW())',
                [userId]
            );
            console.log(`ℹ️  Created new user: ${userId}`);
        }

        // Check for active VIP subscription
        const [activeVIP] = await connection.execute(
            `SELECT expiry_date FROM vip_subscriptions 
             WHERE user_id = ? AND expiry_date > NOW() 
             ORDER BY expiry_date DESC LIMIT 1`,
            [userId]
        );

        let expiryDate;
        let addType = 'new';

        if (activeVIP.length > 0) {
            // Extend from existing expiry date (round to end of day, then add days)
            expiryDate = new Date(activeVIP[0].expiry_date);
            // Round to end of current expiry day
            expiryDate.setHours(23, 59, 59, 999);
            // Add the number of days
            expiryDate.setDate(expiryDate.getDate() + days);
            
            // Format to MySQL datetime string (YYYY-MM-DD HH:mm:ss) to preserve timezone
            const expiryString = expiryDate.getFullYear() + '-' + 
                String(expiryDate.getMonth() + 1).padStart(2, '0') + '-' + 
                String(expiryDate.getDate()).padStart(2, '0') + ' ' + 
                String(expiryDate.getHours()).padStart(2, '0') + ':' + 
                String(expiryDate.getMinutes()).padStart(2, '0') + ':' + 
                String(expiryDate.getSeconds()).padStart(2, '0');
            
            await connection.execute(
                `INSERT INTO vip_subscriptions (
                    user_id, plan_id, plan_type, expiry_date, created_by_admin, created_at
                ) VALUES (?, ?, ?, ?, 'admin', NOW())`,
                [userId, planId, planType, expiryString]
            );
            addType = 'cumulative';
        } else {
            // Start from tomorrow midnight, then add days (end of day)
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 1);
            expiryDate.setHours(0, 0, 0, 0);
            expiryDate.setDate(expiryDate.getDate() + days);
            // Set to end of the final day
            expiryDate.setHours(23, 59, 59, 999);
            
            // Format to MySQL datetime string (YYYY-MM-DD HH:mm:ss) to preserve timezone
            const expiryString = expiryDate.getFullYear() + '-' + 
                String(expiryDate.getMonth() + 1).padStart(2, '0') + '-' + 
                String(expiryDate.getDate()).padStart(2, '0') + ' ' + 
                String(expiryDate.getHours()).padStart(2, '0') + ':' + 
                String(expiryDate.getMinutes()).padStart(2, '0') + ':' + 
                String(expiryDate.getSeconds()).padStart(2, '0');
            
            await connection.execute(
                `INSERT INTO vip_subscriptions (
                    user_id, plan_id, plan_type, expiry_date, created_by_admin, created_at
                ) VALUES (?, ?, ?, ?, 'admin', NOW())`,
                [userId, planId, planType, expiryString]
            );
            addType = 'new';
        }

        // Log activity
        const logDetails = addType === 'cumulative' 
            ? `Admin added ${planName} (${planType}) VIP (cộng dồn) - New expiry: ${expiryDate.toLocaleString('vi-VN')}`
            : `Admin added ${planName} (${planType}) VIP (mới) - Expiry: ${expiryDate.toLocaleString('vi-VN')}`;

        const _ci = req ? { ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || null, ua: req.headers?.['user-agent'] || null } : { ip: null, ua: null };
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES (?, 'ADMIN_ADD_VIP', ?, ?, ?, NOW())`,
            [userId, logDetails, _ci.ip, _ci.ua]
        );

        await connection.commit();

        return { 
            success: true, 
            message: addType === 'cumulative' 
                ? `Đã cộng thêm ${days} ngày VIP` 
                : `Đã thêm VIP ${days} ngày mới`,
            expiryDate: expiryDate.toISOString(),
            addType
        };
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error adding VIP:', error.message);
        return { success: false, message: 'Failed to add VIP', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}

async function deleteSubscription(payload, req = null) {
    const { subscriptionId } = payload;
    if (!subscriptionId) {
        return { success: false, message: 'subscriptionId required' };
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [subscription] = await connection.execute(
            'SELECT user_id FROM vip_subscriptions WHERE id = ?',
            [subscriptionId]
        );
        
        if (subscription.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Subscription not found' };
        }

        const userId = subscription[0].user_id;
        
        await connection.execute(
            'DELETE FROM vip_subscriptions WHERE id = ?',
            [subscriptionId]
        );

        const _ci = req ? { ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || null, ua: req.headers?.['user-agent'] || null } : { ip: null, ua: null };
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES (?, 'ADMIN_DELETE_VIP', ?, ?, ?, NOW())`,
            [userId, `Admin deleted VIP subscription #${subscriptionId}`, _ci.ip, _ci.ua]
        );

        await connection.commit();
        return { success: true, message: 'Subscription deleted' };
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error deleting subscription:', error.message);
        return { success: false, message: 'Failed to delete', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}

async function deleteUser(payload, req = null) {
    const { userId } = payload;
    if (!userId) {
        return { success: false, message: 'userId required' };
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // DELETE cascades due to FK constraints
        await connection.execute(
            'DELETE FROM users WHERE user_id = ?',
            [userId]
        );

        const _ci = req ? { ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || null, ua: req.headers?.['user-agent'] || null } : { ip: null, ua: null };
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES (?, 'ADMIN_DELETE_USER', ?, ?, ?, NOW())`,
            [userId, `Admin deleted user ${userId} and all related data`, _ci.ip, _ci.ua]
        );

        await connection.commit();
        return { success: true, message: 'User deleted successfully' };
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error deleting user:', error.message);
        return { success: false, message: 'Failed to delete user', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}

// ============================================
// Order Management
// ============================================

async function getAllOrders() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [orders] = await connection.execute(`
            SELECT 
                o.id,
                o.order_code,
                o.user_id,
                o.plan_id,
                o.plan_name,
                o.amount,
                o.payment_status,
                o.gateway,
                o.created_at,
                o.paid_at,
                o.cancelled_at
            FROM orders o
            ORDER BY o.created_at DESC
        `);
        return { success: true, orders };
    } finally {
        if (connection) connection.release();
    }
}

// ============================================
// Transactions
// ============================================

async function getAllTransactions() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [transactions] = await connection.execute(`
            SELECT 
                t.id,
                t.order_id,
                o.order_code,
                t.gateway,
                t.amount_in,
                t.transaction_content,
                t.reference_number,
                t.received_at
            FROM transactions t
            LEFT JOIN orders o ON t.order_id = o.id
            ORDER BY t.received_at DESC
        `);
        return { success: true, transactions };
    } finally {
        if (connection) connection.release();
    }
}

// ============================================
// Activity Logs
// ============================================

async function getAllLogs() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [logs] = await connection.execute(`
            SELECT 
                id,
                user_id,
                admin_id,
                action,
                details,
                ip_address,
                created_at
            FROM activity_logs
            ORDER BY created_at DESC
            LIMIT 1000
        `);
        return { success: true, logs };
    } finally {
        if (connection) connection.release();
    }
}

/**
 * Get detailed user activity with filtering, search, and user-centric view
 */
async function getUserActivity(payload) {
    const { userId, action, dateFrom, dateTo, page = 1, limit = 50 } = payload || {};
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Build dynamic WHERE clause
        const conditions = [];
        const params = [];
        
        if (userId) {
            conditions.push('al.user_id LIKE ?');
            params.push(`%${userId}%`);
        }
        if (action) {
            conditions.push('al.action = ?');
            params.push(action);
        }
        if (dateFrom) {
            conditions.push('al.created_at >= ?');
            params.push(dateFrom);
        }
        if (dateTo) {
            conditions.push('al.created_at <= ?');
            params.push(dateTo + ' 23:59:59');
        }
        
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        
        // Get total count for pagination
        const [countResult] = await connection.execute(
            `SELECT COUNT(*) as total FROM activity_logs al ${whereClause}`,
            params
        );
        const total = countResult[0].total;
        
        // Get paginated logs
        const offset = (page - 1) * limit;
        const [logs] = await connection.execute(
            `SELECT 
                al.id,
                al.user_id,
                al.admin_id,
                al.action,
                al.details,
                al.ip_address,
                al.created_at,
                u.full_name,
                u.email
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.user_id
            ${whereClause}
            ORDER BY al.created_at DESC
            LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        
        // Get user activity summary (top active users)
        const [userSummary] = await connection.execute(`
            SELECT 
                al.user_id,
                u.full_name,
                COUNT(*) as total_actions,
                MAX(al.created_at) as last_activity,
                SUM(CASE WHEN al.action = 'USER_LOGIN' THEN 1 ELSE 0 END) as login_count,
                SUM(CASE WHEN al.action IN ('REGISTER_CLASS', 'REGISTER_SUCCESS') THEN 1 ELSE 0 END) as register_count,
                SUM(CASE WHEN al.action IN ('START_AUTO_REGISTER', 'START_AUTO_INSERT') THEN 1 ELSE 0 END) as auto_register_count,
                SUM(CASE WHEN al.action = 'FETCH_SCHEDULE' THEN 1 ELSE 0 END) as fetch_count
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.user_id
            WHERE al.user_id != 'admin' AND al.user_id != 'anonymous' AND al.user_id != 'system'
            GROUP BY al.user_id, u.full_name
            ORDER BY last_activity DESC
            LIMIT 50
        `);
        
        // Get action type distribution
        const [actionStats] = await connection.execute(`
            SELECT action, COUNT(*) as count
            FROM activity_logs
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            GROUP BY action
            ORDER BY count DESC
        `);
        
        // Get currently active users (activity in last 15 minutes)
        const [activeNow] = await connection.execute(`
            SELECT DISTINCT 
                al.user_id,
                u.full_name,
                MAX(al.created_at) as last_activity,
                (SELECT al2.action FROM activity_logs al2 
                 WHERE al2.user_id = al.user_id 
                 ORDER BY al2.created_at DESC LIMIT 1) as last_action,
                (SELECT al3.details FROM activity_logs al3 
                 WHERE al3.user_id = al.user_id 
                 ORDER BY al3.created_at DESC LIMIT 1) as last_details
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.user_id
            WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
            AND al.user_id != 'admin' AND al.user_id != 'anonymous' AND al.user_id != 'system'
            GROUP BY al.user_id, u.full_name
            ORDER BY last_activity DESC
        `);
        
        return { 
            success: true, 
            logs,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            userSummary,
            actionStats,
            activeNow
        };
    } catch (error) {
        console.error('❌ Error getting user activity:', error.message);
        return { success: false, message: 'Failed to get user activity', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}

/**
 * Get real-time active users (activity in last 15 minutes)
 */
async function getActiveUsers() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [activeUsers] = await connection.execute(`
            SELECT DISTINCT 
                al.user_id,
                u.full_name,
                u.email,
                MAX(al.created_at) as last_activity,
                COUNT(*) as action_count_15min,
                (SELECT al2.action FROM activity_logs al2 
                 WHERE al2.user_id = al.user_id 
                 ORDER BY al2.created_at DESC LIMIT 1) as last_action,
                (SELECT al3.details FROM activity_logs al3 
                 WHERE al3.user_id = al.user_id 
                 ORDER BY al3.created_at DESC LIMIT 1) as last_details
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.user_id
            WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
            AND al.user_id != 'admin' AND al.user_id != 'anonymous' AND al.user_id != 'system'
            GROUP BY al.user_id, u.full_name, u.email
            ORDER BY last_activity DESC
        `);
        return { success: true, activeUsers };
    } catch (error) {
        console.error('❌ Error getting active users:', error.message);
        return { success: false, message: 'Failed to get active users', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}

// ============================================
// Dashboard Statistics (using improved views)
// ============================================

async function getDashboardStats() {
    let connection;
    try {
        connection = await pool.getConnection();

        // Use improved views for better performance
        const [totalUsers] = await connection.execute('SELECT COUNT(*) as count FROM users');
        
        // Count DISTINCT users with active VIP (not total subscriptions)
        const [vipUsers] = await connection.execute(
            'SELECT COUNT(DISTINCT user_id) as count FROM vip_subscriptions WHERE expiry_date > NOW()'
        );
        
        let revenue = [{ total: 0 }];
        try {
            [revenue] = await connection.execute(
                'SELECT COALESCE(SUM(daily_revenue), 0) as total FROM v_revenue_by_day'
            );
        } catch (e) {
            // View may not exist, fallback to orders table
            [revenue] = await connection.execute(
                "SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE payment_status = 'Paid'"
            );
        }
        
        // Order summary
        const [orderStats] = await connection.execute(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) as paid,
                SUM(CASE WHEN payment_status = 'Unpaid' THEN 1 ELSE 0 END) as unpaid,
                SUM(CASE WHEN payment_status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled
            FROM orders
        `);
        
        // Revenue by date (last 7 days)
        let revenueByDate = [];
        try {
            [revenueByDate] = await connection.execute(`
                SELECT 
                    DATE(payment_date) as date, 
                    CAST(daily_revenue as DECIMAL(10,2)) as revenue 
                FROM v_revenue_by_day
                ORDER BY payment_date DESC
                LIMIT 7
            `);
        } catch (e) {
            // Fallback
            [revenueByDate] = await connection.execute(`
                SELECT 
                    DATE(paid_at) as date, 
                    SUM(amount) as revenue 
                FROM orders 
                WHERE payment_status = 'Paid' AND paid_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(paid_at)
                ORDER BY date DESC
                LIMIT 7
            `);
        }
        
        // Normalize data format to ensure consistency
        const normalizedRevenueData = revenueByDate.map(row => ({
            date: row.date,
            revenue: parseFloat(row.revenue || 0)
        }));
        
        // User growth (last 7 days)
        const [userGrowth] = await connection.execute(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM users
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);
        
        // VIP plan distribution
        const [vipDistribution] = await connection.execute(`
            SELECT plan_type, COUNT(*) as count
            FROM vip_subscriptions
            WHERE expiry_date > NOW()
            GROUP BY plan_type
        `);
        
        // Recent activities
        const [recentActivities] = await connection.execute(`
            SELECT id, user_id, action, details, created_at
            FROM activity_logs
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        return {
            success: true,
            stats: {
                totalUsers: totalUsers[0].count,
                vipUsers: vipUsers[0].count,
                totalRevenue: parseFloat(revenue[0].total || 0),
                orders: {
                    total: orderStats[0].total,
                    paid: orderStats[0].paid || 0,
                    unpaid: orderStats[0].unpaid || 0,
                    cancelled: orderStats[0].cancelled || 0
                },
                revenueByDate: normalizedRevenueData,
                userGrowth,
                vipDistribution,
                recentActivities
            }
        };
    } catch (error) {
        console.warn('⚠️  Dashboard stats error:', error.message);
        // Fallback to basic stats if views don't exist
        try {
            const [totalUsers] = await connection.execute('SELECT COUNT(*) as count FROM users');
            const [vipUsers] = await connection.execute(
                'SELECT COUNT(DISTINCT user_id) as count FROM vip_subscriptions WHERE expiry_date > NOW()'
            );
            
            return {
                success: true,
                stats: {
                    totalUsers: totalUsers[0].count,
                    vipUsers: vipUsers[0].count,
                    totalRevenue: 0,
                    orders: { total: 0, paid: 0, unpaid: 0, cancelled: 0 },
                    revenueByDate: [],
                    userGrowth: [],
                    vipDistribution: [],
                    recentActivities: []
                }
            };
        } catch (fallbackError) {
            return {
                success: true,
                stats: {
                    totalUsers: 0,
                    vipUsers: 0,
                    totalRevenue: 0,
                    orders: { total: 0, paid: 0, unpaid: 0, cancelled: 0 },
                    revenueByDate: [],
                    userGrowth: [],
                    vipDistribution: [],
                    recentActivities: []
                }
            };
        }
    } finally {
        if (connection) connection.release();
    }
}

// ============================================
// VIP Plans Management
// ============================================

async function getAllVIPPlans() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [plans] = await connection.execute(`
            SELECT 
                id,
                plan_key,
                plan_name,
                duration_days,
                price,
                is_active,
                sort_order,
                description,
                created_at,
                updated_at
            FROM vip_plans
            ORDER BY sort_order ASC, id ASC
        `);
        return { success: true, plans };
    } finally {
        if (connection) connection.release();
    }
}

async function createVIPPlan(payload, req = null) {
    const { planKey, planName, durationDays, price, sortOrder, description } = payload;
    
    if (!planKey || !planName || !durationDays || !price) {
        return { success: false, message: 'planKey, planName, durationDays, and price are required' };
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if plan_key already exists (UNIQUE constraint)
        const [existing] = await connection.execute(
            'SELECT id FROM vip_plans WHERE plan_key = ?',
            [planKey]
        );
        
        if (existing.length > 0) {
            await connection.rollback();
            return { success: false, message: 'Plan key already exists' };
        }

        await connection.execute(
            `INSERT INTO vip_plans (
                plan_key, plan_name, duration_days, price, is_active, sort_order, description, created_at
            ) VALUES (?, ?, ?, ?, 1, ?, ?, NOW())`,
            [planKey, planName, durationDays, price, sortOrder || 0, description || null]
        );

        const _ci = req ? { ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || null, ua: req.headers?.['user-agent'] || null } : { ip: null, ua: null };
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES ('admin', 'ADMIN_CREATE_PLAN', ?, ?, ?, NOW())`,
            [`Admin created VIP plan: ${planName} (${planKey})`, _ci.ip, _ci.ua]
        );

        await connection.commit();
        return { success: true, message: 'VIP plan created successfully' };
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error creating VIP plan:', error.message);
        return { success: false, message: 'Failed to create VIP plan', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}

async function updateVIPPlan(payload, req = null) {
    const { id, planKey, planName, durationDays, price, sortOrder, description, isActive } = payload;
    
    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [existing] = await connection.execute(
            'SELECT plan_key FROM vip_plans WHERE id = ?',
            [id]
        );
        
        if (existing.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Plan not found' };
        }

        // If plan_key is being changed, check for duplicates
        if (planKey && planKey !== existing[0].plan_key) {
            const [duplicate] = await connection.execute(
                'SELECT id FROM vip_plans WHERE plan_key = ? AND id != ?',
                [planKey, id]
            );
            if (duplicate.length > 0) {
                await connection.rollback();
                return { success: false, message: 'Plan key already exists' };
            }
        }

        const updates = [];
        const values = [];

        if (planKey !== undefined) { updates.push('plan_key = ?'); values.push(planKey); }
        if (planName !== undefined) { updates.push('plan_name = ?'); values.push(planName); }
        if (durationDays !== undefined) { updates.push('duration_days = ?'); values.push(durationDays); }
        if (price !== undefined) { updates.push('price = ?'); values.push(price); }
        if (sortOrder !== undefined) { updates.push('sort_order = ?'); values.push(sortOrder); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (isActive !== undefined) { updates.push('is_active = ?'); values.push(isActive ? 1 : 0); }
        
        updates.push('updated_at = NOW()');
        values.push(id);

        if (updates.length > 1) {
            await connection.execute(
                `UPDATE vip_plans SET ${updates.join(', ')} WHERE id = ?`,
                values
            );
        }

        const _ci = req ? { ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || null, ua: req.headers?.['user-agent'] || null } : { ip: null, ua: null };
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES ('admin', 'ADMIN_UPDATE_PLAN', ?, ?, ?, NOW())`,
            [`Admin updated VIP plan ID: ${id}`, _ci.ip, _ci.ua]
        );

        await connection.commit();
        return { success: true, message: 'VIP plan updated successfully' };
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error updating VIP plan:', error.message);
        return { success: false, message: 'Failed to update VIP plan', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}

async function deleteVIPPlan(payload, req = null) {
    const { id } = payload;
    
    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [plan] = await connection.execute(
            'SELECT plan_key, plan_name FROM vip_plans WHERE id = ?',
            [id]
        );
        
        if (plan.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Plan not found' };
        }

        // Check if plan is being used
        const [activeOrders] = await connection.execute(
            'SELECT COUNT(*) as count FROM orders WHERE plan_id = ? AND payment_status = "Unpaid"',
            [id]
        );

        if (activeOrders[0].count > 0) {
            await connection.rollback();
            return { 
                success: false, 
                message: `Cannot delete plan. ${activeOrders[0].count} unpaid orders are using this plan.` 
            };
        }

        await connection.execute(
            'DELETE FROM vip_plans WHERE id = ?',
            [id]
        );

        const _ci = req ? { ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || null, ua: req.headers?.['user-agent'] || null } : { ip: null, ua: null };
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES ('admin', 'ADMIN_DELETE_PLAN', ?, ?, ?, NOW())`,
            [`Admin deleted VIP plan: ${plan[0].plan_name} (${plan[0].plan_key})`, _ci.ip, _ci.ua]
        );

        await connection.commit();
        return { success: true, message: 'VIP plan deleted successfully' };
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error deleting VIP plan:', error.message);
        return { success: false, message: 'Failed to delete VIP plan', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}

async function toggleVIPPlanStatus(payload, req = null) {
    const { id } = payload;
    
    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [plan] = await connection.execute(
            'SELECT plan_name, is_active FROM vip_plans WHERE id = ?',
            [id]
        );
        
        if (plan.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Plan not found' };
        }

        const newStatus = plan[0].is_active ? 0 : 1;
        await connection.execute(
            'UPDATE vip_plans SET is_active = ?, updated_at = NOW() WHERE id = ?',
            [newStatus, id]
        );

        const _ci = req ? { ip: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || null, ua: req.headers?.['user-agent'] || null } : { ip: null, ua: null };
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES ('admin', 'ADMIN_TOGGLE_PLAN', ?, ?, ?, NOW())`,
            [`Admin ${newStatus ? 'enabled' : 'disabled'} VIP plan: ${plan[0].plan_name}`, _ci.ip, _ci.ua]
        );

        await connection.commit();
        return { success: true, message: `Plan ${newStatus ? 'enabled' : 'disabled'} successfully`, isActive: newStatus };
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('❌ Error toggling VIP plan status:', error.message);
        return { success: false, message: 'Failed to toggle plan status', error: error.message };
    } finally {
        if (connection) connection.release();
    }
}
