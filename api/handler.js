import fetch from 'node-fetch';
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
    queueLimit: 0,
    timezone: '+07:00',
    connectionLimit: 100
};

// Validate environment variables
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    console.warn('Missing database environment variables - using defaults');
}

// ============================================
// Connection pool management
// ============================================
let pool;
const getPool = () => {
    try {
        if (!pool) {
            pool = mysql.createPool(dbConfig);
            console.log('✅ Database pool created');
        }
        return pool;
    } catch (error) {
        console.error('❌ Error creating pool:', error);
        throw new Error('Database connection failed');
    }
};

// ============================================
// Helper functions
// ============================================

/**
 * Generate random order code: DKHP + 12 random alphanumeric characters
 */
function generateOrderCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'DKHP';
    for (let i = 0; i < 12; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Save or update user info in database
 * NOW: Links to users.user_id (unique key)
 */
async function saveUserInfo(profile) {
    let connection;
    try {
        connection = await getPool().getConnection();
        
        const userId = profile.maSinhVien || profile.username;
        if (!userId) {
            throw new Error('Missing user_id in profile');
        }
        
        const email = profile.email || null;
        const fullName = `${profile.hoDem || ''} ${profile.ten || ''}`.trim();
        
        // Check if user exists (using user_id as primary unique identifier)
        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE user_id = ?',
            [userId]
        );
        
        if (existingUsers.length === 0) {
            // Insert new user
            await connection.execute(
                'INSERT INTO users (user_id, email, full_name, is_active, created_at) VALUES (?, ?, ?, 1, NOW())',
                [userId, email, fullName]
            );
            console.log(`✅ Created new user: ${userId}`);
        } else {
            // Update existing user
            await connection.execute(
                'UPDATE users SET email = ?, full_name = ?, updated_at = NOW() WHERE user_id = ?',
                [email, fullName, userId]
            );
            console.log(`✅ Updated user: ${userId}`);
        }
        
        // Log login activity
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, created_at) 
             VALUES (?, 'USER_LOGIN', 'User logged in from web interface', NOW())`,
            [userId]
        );
        
        return true;
    } catch (error) {
        console.error('❌ Error saving user info:', error.message);
        return false;
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Error releasing connection:', err);
            }
        }
    }
}

/**
 * Call internal university API with proper error handling
 */
async function callApi(endpoint, method, token, body = null, source = 'dkhp') {
    let baseApiUrl;
    if (endpoint.startsWith('/user/')) {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1';
    } else if (source === 'dkhpdk') {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhpdk';
    } else {
        baseApiUrl = 'https://portal.ut.edu.vn/api/v1/dkhp';
    }
    
    const targetUrl = baseApiUrl + endpoint;
    const headers = { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { 
        method, 
        headers, 
        body: body ? JSON.stringify(body) : null, 
        timeout: 30000 
    };

    try {
        const response = await fetch(targetUrl, options);
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Response is not JSON');
        }

        const data = await response.json();
        
        if (!response.ok) {
            return { 
                success: false, 
                message: data.message || `API Error: Status ${response.status}`, 
                status: response.status,
                error: data.error || null
            };
        }
        
        return data;
    } catch (error) {
        console.error('❌ API call failed:', {
            url: targetUrl,
            method,
            error: error.message
        });
        return { 
            success: false, 
            message: error.message,
            status: error.status || 500
        };
    }
}

/**
 * Get schedule details for a class
 */
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    return (result && result.success) ? result.body : { error: true, message: result?.message };
}

// ============================================
// VIP Plans Management
// ============================================

const VIP_PLANS_FALLBACK = {
    '1day': { price: 24000, duration: 1, name: '1 Ngày VIP' },
    '3days': { price: 72000, duration: 3, name: '3 Ngày VIP' },
    '7days': { price: 126000, duration: 7, name: '7 Ngày VIP' },
    '30days': { price: 432000, duration: 30, name: '30 Ngày VIP' }
};

/**
 * Get active VIP plans from database
 * NOW: Uses vip_plans.plan_id for FK references
 */
async function getVIPPlansFromDB() {
    try {
        const connection = await getPool().getConnection();
        const [plans] = await connection.execute(
            `SELECT id, plan_key, plan_name, duration_days, price, description, sort_order 
             FROM vip_plans 
             WHERE is_active = 1 
             ORDER BY sort_order ASC`
        );
        connection.release();
        
        // Convert to object format for backward compatibility
        const plansObj = {};
        plans.forEach(plan => {
            plansObj[plan.plan_key] = {
                id: plan.id, // NOW: Include plan_id for FK reference
                price: parseFloat(plan.price),
                duration: plan.duration_days,
                name: plan.plan_name,
                description: plan.description || ''
            };
        });
        
        return Object.keys(plansObj).length > 0 ? plansObj : VIP_PLANS_FALLBACK;
    } catch (error) {
        console.error('❌ Error loading VIP plans:', error.message);
        return VIP_PLANS_FALLBACK;
    }
}

// SePay Configuration
const SEPAY_CONFIG = {
    bankName: process.env.SEPAY_BANK_NAME || 'MBBank',
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER || '01006022006',
    accountName: process.env.SEPAY_ACCOUNT_NAME || 'NGUYỄN SUN SIN'
};

// ============================================
// VIP Status & Subscriptions
// ============================================

/**
 * Check if user has active VIP subscription
 */
async function checkVIPStatus(userId) {
    try {
        const connection = await getPool().getConnection();
        
        const [rows] = await connection.execute(
            `SELECT 
                id,
                plan_id,
                plan_type,
                expiry_date,
                TIMESTAMPDIFF(DAY, NOW(), expiry_date) as days_left
             FROM vip_subscriptions 
             WHERE user_id = ? AND expiry_date > NOW() 
             ORDER BY expiry_date DESC 
             LIMIT 1`,
            [userId]
        );
        
        connection.release();
        
        if (rows.length === 0) {
            return { hasVIP: false };
        }
        
        const vipData = rows[0];
        const daysLeft = vipData.days_left + 1;
        
        return { 
            hasVIP: true, 
            subscriptionId: vipData.id,
            planId: vipData.plan_id,
            expiryDate: vipData.expiry_date,
            plan: vipData.plan_type,
            daysLeft: daysLeft
        };
    } catch (error) {
        console.error('❌ Error checking VIP status:', error.message);
        return { hasVIP: false };
    }
}

// ============================================
// Order Management
// ============================================

/**
 * Create a new VIP order
 * NOW: Includes plan_id FK reference and validates user exists
 */
async function createOrder(userId, plan) {
    let connection;
    try {
        connection = await getPool().getConnection();
        
        // VALIDATION: Check user exists (FK constraint)
        const [users] = await connection.execute(
            'SELECT id FROM users WHERE user_id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            return { error: `User ${userId} does not exist. Create user account first.` };
        }
        
        // Get VIP plan details
        const vipPlans = await getVIPPlansFromDB();
        const planConfig = vipPlans[plan];
        
        if (!planConfig) {
            return { error: `Invalid plan: ${plan}` };
        }
        
        // Generate unique order code
        let orderCode;
        let isUnique = false;
        let attempts = 0;
        
        while (!isUnique && attempts < 10) {
            orderCode = generateOrderCode();
            const [existing] = await connection.execute(
                'SELECT id FROM orders WHERE order_code = ?',
                [orderCode]
            );
            if (existing.length === 0) {
                isUnique = true;
            }
            attempts++;
        }
        
        if (!isUnique) {
            return { error: 'Failed to generate unique order code' };
        }
        
        // Insert order with plan_id FK
        const [result] = await connection.execute(
            `INSERT INTO orders (
                order_code, 
                user_id, 
                plan_id,
                plan_type, 
                plan_name, 
                amount, 
                payment_status, 
                gateway, 
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'Unpaid', 'SePay', NOW())`,
            [
                orderCode,
                userId,
                planConfig.id, // NOW: Include plan_id
                plan,
                planConfig.name,
                planConfig.price
            ]
        );
        
        const orderId = result.insertId;
        
        // Log activity
        await connection.execute(
            `INSERT INTO activity_logs (
                user_id, 
                action, 
                details, 
                created_at
            ) VALUES (?, 'ORDER_CREATED', ?, NOW())`,
            [userId, `Order #${orderId} created for plan: ${planConfig.name}`]
        );
        
        return {
            id: orderId,
            orderCode: orderCode,
            userId,
            amount: planConfig.price,
            status: 'Unpaid',
            plan,
            planId: planConfig.id, // Return plan_id
            planName: planConfig.name,
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('❌ Error creating order:', error.message);
        return { error: error.message };
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Error releasing connection:', err);
            }
        }
    }
}

/**
 * Get order status
 */
async function getOrderStatus(orderId) {
    let connection;
    try {
        connection = await getPool().getConnection();
        
        const [rows] = await connection.execute(
            `SELECT 
                id,
                order_code,
                user_id,
                plan_id,
                amount,
                payment_status,
                plan_type,
                plan_name,
                created_at,
                paid_at,
                transaction_ref
             FROM orders 
             WHERE id = ?`,
            [orderId]
        );
        
        if (rows.length === 0) {
            return null;
        }
        
        const order = rows[0];
        return {
            id: order.id,
            orderCode: order.order_code,
            userId: order.user_id,
            planId: order.plan_id,
            amount: parseFloat(order.amount),
            status: order.payment_status,
            plan: order.plan_type,
            planName: order.plan_name,
            createdAt: order.created_at,
            paidAt: order.paid_at,
            transactionRef: order.transaction_ref
        };
    } catch (error) {
        console.error('❌ Error getting order status:', error.message);
        return null;
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Error releasing connection:', err);
            }
        }
    }
}

/**
 * Cancel an unpaid order
 * NOW: Sets cancelled_at timestamp
 */
async function cancelOrder(orderId) {
    let connection;
    try {
        connection = await getPool().getConnection();
        
        // Check if order exists and is Unpaid
        const [rows] = await connection.execute(
            'SELECT user_id FROM orders WHERE id = ? AND payment_status = "Unpaid"',
            [orderId]
        );
        
        if (rows.length === 0) {
            return null;
        }
        
        const userId = rows[0].user_id;
        
        // Update order status with cancelled_at
        await connection.execute(
            `UPDATE orders 
             SET payment_status = "Cancelled", cancelled_at = NOW(), updated_at = NOW() 
             WHERE id = ?`,
            [orderId]
        );
        
        // Log activity
        await connection.execute(
            `INSERT INTO activity_logs (
                user_id, 
                action, 
                details, 
                created_at
            ) VALUES (?, 'ORDER_CANCELLED', ?, NOW())`,
            [userId, `User cancelled order #${orderId}`]
        );
        
        return true;
    } catch (error) {
        console.error('❌ Error cancelling order:', error.message);
        return null;
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Error releasing connection:', err);
            }
        }
    }
}

/**
 * Auto-cancel unpaid orders after 15 minutes
 * NOW: Uses stored procedure if available, falls back to direct update
 * FIX: Only log orders that were JUST cancelled, not all cancelled orders
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
                throw err; // Re-throw if it's not "procedure not found"
            }
            // Fall back to direct SQL
        }
        
        // FIX: Get list of orders to cancel BEFORE updating
        const [ordersToCancel] = await connection.execute(
            `SELECT id, user_id FROM orders 
             WHERE payment_status = "Unpaid" 
             AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= 15`
        );
        
        if (ordersToCancel.length === 0) {
            return; // No orders to cancel
        }
        
        // Update orders to Cancelled
        const [result] = await connection.execute(
            `UPDATE orders 
             SET payment_status = "Cancelled", cancelled_at = NOW(), updated_at = NOW() 
             WHERE payment_status = "Unpaid" 
             AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= 15`
        );
        
        if (result.affectedRows > 0) {
            console.log(`✅ Auto-cancelled ${result.affectedRows} orders`);
            
            // Log cancellations - ONLY for orders that were just cancelled
            for (const order of ordersToCancel) {
                await connection.execute(
                    `INSERT INTO activity_logs (user_id, action, details, created_at)
                     VALUES (?, 'ORDER_AUTO_CANCELLED', ?, NOW())`,
                    [order.user_id, `Auto-cancelled order #${order.id} (timeout)`]
                );
            }
            
            console.log(`✅ Logged ${ordersToCancel.length} auto-cancellations`);
        }
    } catch (error) {
        console.error('❌ Error auto-cancelling orders:', error.message);
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Error releasing connection:', err);
            }
        }
    }
}

// ============================================
// MAIN HANDLER
// ============================================
export default async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    // Run auto-cancel on every request (serverless-friendly)
    autoCancelExpiredOrders().catch(err => console.error('❌ Auto-cancel error:', err.message));

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        switch (action) {
            // --- AUTHENTICATION ---
            case 'login': {
                const { username, password } = payload;
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApi(`/getDot`, 'GET', token);
                const latestDot = (dotsRes.success && dotsRes.body?.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                
                // Save user info to database
                if (profileRes.success && profileRes.body) {
                    await saveUserInfo(profileRes.body);
                }
                
                // Check VIP status
                const userId = profileRes.body?.maSinhVien || profileRes.body?.username;
                const vipStatus = await checkVIPStatus(userId);
                
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot,
                    vip: vipStatus
                };
                break;
            }

            case 'validateToken': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                try {
                    const validateRes = await callApi('/user/getCredit', 'GET', token);
                    result = {
                        success: validateRes.success && validateRes.status === 200,
                        valid: validateRes.success && validateRes.status === 200
                    };
                } catch (error) {
                    result = { success: false, valid: false, message: 'Token validation failed' };
                }
                break;
            }

            // --- VIP ACTIONS ---
            case 'checkVIPStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { userId } = payload;
                result = { success: true, vip: await checkVIPStatus(userId) };
                break;
            }

            case 'createVIPOrder': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { userId, plan } = payload;
                
                // Validate plan exists
                const vipPlans = await getVIPPlansFromDB();
                if (!vipPlans[plan]) {
                    return res.status(400).json({ success: false, message: 'Invalid plan' });
                }
                
                const order = await createOrder(userId, plan);
                
                if (order.error) {
                    return res.status(400).json({ success: false, message: order.error });
                }
                
                result = { success: true, order };
                break;
            }

            case 'checkOrderStatus': {
                const { orderId } = payload;
                const order = await getOrderStatus(parseInt(orderId));
                
                if (!order) {
                    return res.status(404).json({ success: false, message: 'Order not found' });
                }
                
                result = { success: true, order };
                break;
            }

            case 'cancelOrder': {
                const { orderId } = payload;
                const cancelResult = await cancelOrder(parseInt(orderId));
                
                if (!cancelResult) {
                    return res.status(404).json({ success: false, message: 'Order not found or already processed' });
                }
                
                result = { success: true, message: 'Order cancelled successfully' };
                break;
            }

            case 'getVIPPlans': {
                const vipPlans = await getVIPPlansFromDB();
                result = { 
                    success: true, 
                    plans: vipPlans,
                    sepayConfig: SEPAY_CONFIG
                };
                break;
            }

            // --- DATA RETRIEVAL ---
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites, userId } = payload;
                
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let allClassData = [];
                let subjectTypeMap = {};

                for (const source of sources) {
                    const subjectsRes = await callApi(`/getHocPhanHocMoi?idDot=${dotId}`, 'GET', token, null, source);
                    if (!subjectsRes.success || !Array.isArray(subjectsRes.body)) continue;

                    if (source === 'dkhp') {
                        subjectsRes.body.forEach(s => subjectTypeMap[s.maHocPhan] = s.isBatBuoc);
                    }

                    const classPromises = subjectsRes.body.map(async (subject) => {
                        const classEndpoint = source === 'dkhpdk'
                            ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                            : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${subject.maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                        const classRes = await callApi(classEndpoint, 'GET', token, null, source);

                        if (classRes.success && Array.isArray(classRes.body)) {
                            return classRes.body.map(cls => ({ ...subject, ...cls, source }));
                        }
                        return [];
                    });

                    const subjectClassesArray = await Promise.all(classPromises);
                    const sourceClasses = subjectClassesArray.flat();
                    
                    const detailedClasses = await Promise.all(sourceClasses.map(async (cls) => {
                        const scheduleDetails = await getScheduleDetails(cls.id, token, source);
                        return { ...cls, scheduleDetails };
                    }));

                    allClassData.push(...detailedClasses);
                }
                result = { success: true, schedule: allClassData, subjectTypes: subjectTypeMap };
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites, userId } = payload;
                const sources = fetchPrerequisites ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];

                for (const source of sources) {
                    const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                    if (regRes.success && Array.isArray(regRes.body)) {
                        await Promise.all(regRes.body.map(async (reg) => {
                            const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                            const scheduleDetails = (detailRes?.success) ? detailRes.body : { error: true, message: detailRes?.message };
                            registeredData.push({ ...reg, source, scheduleDetails });
                        }));
                    }
                }
                result = { success: true, body: registeredData };
                break;
            }
            
            case 'checkClassStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, maHocPhan, source } = payload;
                const classEndpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                result = await callApi(classEndpoint, 'GET', token, null, source);
                break;
            }

            case 'getScheduleDetails': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                const scheduleDetails = await getScheduleDetails(classId, token, source);
                result = { 
                    success: !scheduleDetails.error, 
                    body: scheduleDetails 
                };
                break;
            }

            case 'checkClassAvailability': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, dotId, maHocPhan, source } = payload;
                
                // Use getLopHocPhan (same as checkClassStatus) to get accurate phanTramDangKy
                const classEndpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                
                const classListRes = await callApi(classEndpoint, 'GET', token, null, source);
                
                if (!classListRes || !classListRes.success || !Array.isArray(classListRes.body)) {
                    return res.status(200).json({ 
                        success: true, 
                        canRegister: false, 
                        isFull: true,
                        phanTramDangKy: 0,
                        tenTrangThai: 'Unknown',
                        message: 'Không thể lấy thông tin lớp học'
                    });
                }
                
                // Find the specific class by ID
                const classData = classListRes.body.find(cls => cls.id.toString() === classId.toString());
                
                if (!classData) {
                    return res.status(200).json({ 
                        success: true, 
                        canRegister: false, 
                        isFull: true,
                        phanTramDangKy: 0,
                        tenTrangThai: 'Not Found',
                        message: 'Không tìm thấy lớp học'
                    });
                }
                
                // Check class status
                const tenTrangThai = classData.tenTrangThai || '';
                const phanTramDangKy = classData.phanTramDangKy || 0;
                const choDangKy = classData.choDangKy !== false;
                
                // Determine if class can be registered based on status rules:
                // - "Đang chờ đăng ký": Có thể đăng ký và hủy
                // - "Đang lên kế hoạch": Lớp bị khóa, không thể đăng ký/hủy
                // - "Đã mở chính thức": Chỉ có thể đăng ký, không thể hủy
                // - "Đã khóa lớp": Không thể đăng ký/hủy, chốt lớp
                
                let canRegister = true;
                let isFull = false;
                let message = 'Lớp có thể đăng ký';
                
                if (tenTrangThai === 'Đã khóa lớp') {
                    // Đã khóa lớp: Không thể đăng ký/hủy
                    canRegister = false;
                    message = 'Lớp đã bị khóa (chốt lớp)';
                } else if (tenTrangThai === 'Đang lên kế hoạch') {
                    // Đang lên kế hoạch: Không thể đăng ký/hủy
                    canRegister = false;
                    message = 'Lớp đang lên kế hoạch (bị khóa)';
                } else if (tenTrangThai === 'Đang chờ đăng ký' || tenTrangThai === 'Đã mở chính thức') {
                    // Đang chờ đăng ký hoặc Đã mở chính thức: Có thể đăng ký
                    // Check if class is full
                    if (phanTramDangKy >= 100) {
                        canRegister = false;
                        isFull = true;
                        message = 'Lớp đã đầy';
                    } else if (!choDangKy) {
                        canRegister = false;
                        message = 'Lớp không cho phép đăng ký';
                    } else {
                        canRegister = true;
                        message = tenTrangThai === 'Đang chờ đăng ký' 
                            ? 'Lớp có thể đăng ký (giai đoạn chờ)' 
                            : 'Lớp có thể đăng ký (mở chính thức)';
                    }
                } else {
                    // Unknown status - default to check percentage
                    if (phanTramDangKy >= 100) {
                        canRegister = false;
                        isFull = true;
                        message = 'Lớp đã đầy';
                    } else if (!choDangKy) {
                        canRegister = false;
                        message = 'Lớp không cho phép đăng ký';
                    }
                }
                
                result = { 
                    success: true, 
                    canRegister,
                    isFull,
                    phanTramDangKy,
                    tenTrangThai,
                    choDangKy,
                    message
                };
                break;
            }

            // --- WRITE ACTIONS ---
            case 'register': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload;
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source } = payload;
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                break;
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action.' });
        }
        res.status(200).json(result);

    } catch (error) {
        console.error('❌ Handler error:', error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};
