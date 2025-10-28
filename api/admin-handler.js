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
            case 'getDashboardStats': result = await getDashboardStats(); break;
            // VIP Plans Management
            case 'getAllVIPPlans': result = await getAllVIPPlans(); break;
            case 'createVIPPlan': result = await createVIPPlan(payload); break;
            case 'updateVIPPlan': result = await updateVIPPlan(payload); break;
            case 'deleteVIPPlan': result = await deleteVIPPlan(payload); break;
            case 'toggleVIPPlanStatus': result = await toggleVIPPlanStatus(payload); break;
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

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Get plan duration from database
        // ADMIN can add ANY plan (active or inactive), is_active only affects user purchases
        let days;
        let planName;
        
        const [planData] = await connection.query(
            'SELECT duration_days, plan_name FROM vip_plans WHERE plan_key = ?',
            [planType]
        );
        
        if (planData.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Invalid plan type. Plan does not exist in database.' };
        }
        
        days = planData[0].duration_days;
        planName = planData[0].plan_name;

        // Check if user exists
        const [existingUser] = await connection.query('SELECT id FROM users WHERE username = ?', [userId]);
        if (existingUser.length === 0) {
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
            // Extend from existing expiry date - add days to existing expiry
            await connection.query(
                'INSERT INTO vip_subscriptions (user_id, plan_type, expiry_date, created_at) VALUES (?, ?, DATE_ADD(?, INTERVAL ? DAY), NOW())',
                [userId, planType, activeVIP[0].expiry_date, days]
            );
            
            // Get the calculated expiry for logging
            const [result] = await connection.query(
                'SELECT DATE_FORMAT(DATE_ADD(?, INTERVAL ? DAY), "%Y-%m-%d %H:%i:%s") as new_expiry',
                [activeVIP[0].expiry_date, days]
            );
            expiryDate = result[0].new_expiry;
            addType = 'cumulative';
        } else {
            // Start from now - round up to next day 00:00:00, then add days
            // Formula: DATE_ADD(DATE_ADD(CURDATE(), INTERVAL 1 DAY), INTERVAL ? DAY)
            // Example: Add at 9AM 28/10 with 1-day plan → 00:00:00 29/10 + 1 day → 00:00:00 30/10
            await connection.query(
                'INSERT INTO vip_subscriptions (user_id, plan_type, expiry_date, created_at) VALUES (?, ?, DATE_ADD(DATE_ADD(CURDATE(), INTERVAL 1 DAY), INTERVAL ? DAY), NOW())',
                [userId, planType, days]
            );
            
            // Get the calculated expiry for logging
            const [result] = await connection.query(
                'SELECT DATE_FORMAT(DATE_ADD(DATE_ADD(CURDATE(), INTERVAL 1 DAY), INTERVAL ? DAY), "%Y-%m-%d %H:%i:%s") as new_expiry',
                [days]
            );
            expiryDate = result[0].new_expiry;
            addType = 'new';
        }

        console.log(`[DEBUG] Inserted VIP with expiry date: ${expiryDate} for ${days} days`);

        const logDetails = addType === 'cumulative' 
            ? `Admin added ${planName} (${planType}) VIP (cộng dồn) - New expiry: ${new Date(expiryDate).toLocaleString('vi-VN')}`
            : `Admin added ${planName} (${planType}) VIP (mới) - Expiry: ${new Date(expiryDate).toLocaleString('vi-VN')}`;

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

// ===== DASHBOARD STATISTICS =====
async function getDashboardStats() {
    const connection = await pool.getConnection();
    try {
        // Total users
        const [totalUsers] = await connection.query('SELECT COUNT(*) as count FROM users');
        
        // VIP users (active)
        const [vipUsers] = await connection.query(
            'SELECT COUNT(DISTINCT user_id) as count FROM vip_subscriptions WHERE expiry_date > NOW()'
        );
        
        // Total revenue
        const [revenue] = await connection.query(
            'SELECT SUM(amount) as total FROM orders WHERE payment_status = "Paid"'
        );
        
        // Orders count
        const [orders] = await connection.query('SELECT COUNT(*) as count FROM orders');
        const [paidOrders] = await connection.query('SELECT COUNT(*) as count FROM orders WHERE payment_status = "Paid"');
        const [unpaidOrders] = await connection.query('SELECT COUNT(*) as count FROM orders WHERE payment_status = "Unpaid"');
        const [cancelledOrders] = await connection.query('SELECT COUNT(*) as count FROM orders WHERE payment_status = "Cancelled"');
        
        // Revenue by date (last 30 days)
        const [revenueByDate] = await connection.query(`
            SELECT DATE(paid_at) as date, SUM(amount) as revenue
            FROM orders 
            WHERE payment_status = 'Paid' AND paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(paid_at)
            ORDER BY date ASC
        `);
        
        // User growth (last 30 days)
        const [userGrowth] = await connection.query(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM users
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `);
        
        // VIP plan distribution
        const [vipDistribution] = await connection.query(`
            SELECT plan_type, COUNT(*) as count
            FROM vip_subscriptions
            WHERE expiry_date > NOW()
            GROUP BY plan_type
        `);
        
        // Recent activities
        const [recentActivities] = await connection.query(`
            SELECT * FROM activity_logs
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        return {
            success: true,
            stats: {
                totalUsers: totalUsers[0].count,
                vipUsers: vipUsers[0].count,
                totalRevenue: revenue[0].total || 0,
                orders: {
                    total: orders[0].count,
                    paid: paidOrders[0].count,
                    unpaid: unpaidOrders[0].count,
                    cancelled: cancelledOrders[0].count
                },
                revenueByDate,
                userGrowth,
                vipDistribution,
                recentActivities
            }
        };
    } finally {
        connection.release();
    }
}

// ===== END DASHBOARD =====

// ===== VIP PLANS MANAGEMENT =====

async function getAllVIPPlans() {
    const connection = await pool.getConnection();
    try {
        const [plans] = await connection.query(`
            SELECT id, plan_key, plan_name, duration_days, price, is_active, sort_order, description, created_at, updated_at
            FROM vip_plans
            ORDER BY sort_order ASC, id ASC
        `);
        return { success: true, plans };
    } finally {
        connection.release();
    }
}

async function createVIPPlan(payload) {
    const { planKey, planName, durationDays, price, sortOrder, description } = payload;
    
    if (!planKey || !planName || !durationDays || !price) {
        return { success: false, message: 'planKey, planName, durationDays, and price are required' };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Check if plan_key already exists
        const [existing] = await connection.query('SELECT id FROM vip_plans WHERE plan_key = ?', [planKey]);
        if (existing.length > 0) {
            await connection.rollback();
            return { success: false, message: 'Plan key already exists' };
        }

        await connection.query(
            `INSERT INTO vip_plans (plan_key, plan_name, duration_days, price, sort_order, description, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [planKey, planName, durationDays, price, sortOrder || 0, description || null]
        );

        await connection.query(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
            ['admin', 'ADMIN_CREATE_PLAN', `Admin created VIP plan: ${planName} (${planKey})`]
        );

        await connection.commit();
        return { success: true, message: 'VIP plan created successfully' };
    } catch (error) {
        await connection.rollback();
        console.error('Error creating VIP plan:', error);
        return { success: false, message: 'Failed to create VIP plan', error: error.message };
    } finally {
        connection.release();
    }
}

async function updateVIPPlan(payload) {
    const { id, planKey, planName, durationDays, price, sortOrder, description } = payload;
    
    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Check if plan exists
        const [existing] = await connection.query('SELECT plan_key FROM vip_plans WHERE id = ?', [id]);
        if (existing.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Plan not found' };
        }

        // If plan_key is being changed, check for duplicates
        if (planKey && planKey !== existing[0].plan_key) {
            const [duplicate] = await connection.query('SELECT id FROM vip_plans WHERE plan_key = ? AND id != ?', [planKey, id]);
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
        
        updates.push('updated_at = NOW()');

        if (updates.length > 0) {
            values.push(id);
            await connection.query(
                `UPDATE vip_plans SET ${updates.join(', ')} WHERE id = ?`,
                values
            );
        }

        await connection.query(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
            ['admin', 'ADMIN_UPDATE_PLAN', `Admin updated VIP plan ID: ${id}`]
        );

        await connection.commit();
        return { success: true, message: 'VIP plan updated successfully' };
    } catch (error) {
        await connection.rollback();
        console.error('Error updating VIP plan:', error);
        return { success: false, message: 'Failed to update VIP plan', error: error.message };
    } finally {
        connection.release();
    }
}

async function deleteVIPPlan(payload) {
    const { id } = payload;
    
    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [plan] = await connection.query('SELECT plan_key, plan_name FROM vip_plans WHERE id = ?', [id]);
        if (plan.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Plan not found' };
        }

        // Check if plan is being used in active orders
        const [activeOrders] = await connection.query(
            'SELECT COUNT(*) as count FROM orders WHERE plan_type = ? AND payment_status = "Unpaid"',
            [plan[0].plan_key]
        );

        if (activeOrders[0].count > 0) {
            await connection.rollback();
            return { 
                success: false, 
                message: `Cannot delete plan. ${activeOrders[0].count} unpaid orders are using this plan.` 
            };
        }

        await connection.query('DELETE FROM vip_plans WHERE id = ?', [id]);

        await connection.query(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
            ['admin', 'ADMIN_DELETE_PLAN', `Admin deleted VIP plan: ${plan[0].plan_name} (${plan[0].plan_key})`]
        );

        await connection.commit();
        return { success: true, message: 'VIP plan deleted successfully' };
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting VIP plan:', error);
        return { success: false, message: 'Failed to delete VIP plan', error: error.message };
    } finally {
        connection.release();
    }
}

async function toggleVIPPlanStatus(payload) {
    const { id } = payload;
    
    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [plan] = await connection.query('SELECT plan_key, plan_name, is_active FROM vip_plans WHERE id = ?', [id]);
        if (plan.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Plan not found' };
        }

        const newStatus = plan[0].is_active ? 0 : 1;
        await connection.query('UPDATE vip_plans SET is_active = ?, updated_at = NOW() WHERE id = ?', [newStatus, id]);

        await connection.query(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
            ['admin', 'ADMIN_TOGGLE_PLAN', `Admin ${newStatus ? 'enabled' : 'disabled'} VIP plan: ${plan[0].plan_name}`]
        );

        await connection.commit();
        return { success: true, message: `Plan ${newStatus ? 'enabled' : 'disabled'} successfully`, isActive: newStatus };
    } catch (error) {
        await connection.rollback();
        console.error('Error toggling VIP plan status:', error);
        return { success: false, message: 'Failed to toggle plan status', error: error.message };
    } finally {
        connection.release();
    }
}

// ===== END VIP PLANS MANAGEMENT =====

