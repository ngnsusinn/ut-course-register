import fetch from 'node-fetch';
import mysql from 'mysql2/promise';

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

// Validate environment variables
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    console.error('Missing required database environment variables');
    throw new Error('Database configuration is incomplete');
}

// Create connection pool
let pool;
const getPool = () => {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
};

// NEW: Helper function to save/update user info in database
async function saveUserInfo(profile) {
    try {
        const connection = await getPool().getConnection();
        
        const username = profile.maSinhVien || profile.username;
        const email = profile.email || null;
        const fullName = `${profile.hoDem || ''} ${profile.ten || ''}`.trim();
        
        // Check if user exists
        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );
        
        if (existingUsers.length === 0) {
            // Insert new user
            await connection.execute(
                'INSERT INTO users (username, email, full_name, created_at) VALUES (?, ?, ?, NOW())',
                [username, email, fullName]
            );
            console.log(`✅ Created new user in database: ${username}`);
        } else {
            // Update existing user
            await connection.execute(
                'UPDATE users SET email = ?, full_name = ?, updated_at = NOW() WHERE username = ?',
                [email, fullName, username]
            );
            console.log(`✅ Updated existing user: ${username}`);
        }
        
        // Log login activity
        await connection.execute(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, ?, ?, NOW())',
            [username, 'USER_LOGIN', `User logged in from web interface`]
        );
        
        connection.release();
        return true;
    } catch (error) {
        console.error('Error saving user info:', error);
        return false;
    }
}

// Utility: Call internal university API
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
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers, body: body ? JSON.stringify(body) : null, timeout: 30000 };

    try {
        const response = await fetch(targetUrl, options);
        if (!response.ok) {
            return { success: false, message: `API Error: Status ${response.status}`, status: response.status };
        }
        return await response.json();
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Utility: Get schedule details for a class
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    return (result && result.success) ? result.body : { error: true, message: result.message };
}

// VIP Plans Configuration
const VIP_PLANS = {
    '1day': { price: 24000, duration: 1, name: '1 Ngày VIP' },
    '3days': { price: 72000, duration: 3, name: '3 Ngày VIP' },
    '7days': { price: 126000, duration: 7, name: '7 Ngày VIP' },
    '30days': { price: 432000, duration: 30, name: '30 Ngày VIP' }
};

// SePay Configuration
const SEPAY_CONFIG = {
    bankName: process.env.SEPAY_BANK_NAME || 'MBBank',
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER || '01006022006',
    accountName: process.env.SEPAY_ACCOUNT_NAME || 'NGUYỄN SUN SIN'
};

// Helper: Check if user has active VIP
async function checkVIPStatus(userId) {
    try {
        const connection = await getPool().getConnection();
        
        const [rows] = await connection.execute(
            'SELECT * FROM vip_subscriptions WHERE user_id = ? AND expiry_date > NOW() ORDER BY expiry_date DESC LIMIT 1',
            [userId]
        );
        
        connection.release();
        
        if (rows.length === 0) {
            return { hasVIP: false };
        }
        
        const vipData = rows[0];
        const expiryDate = new Date(vipData.expiry_date);
        const now = new Date();
        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        
        return { 
            hasVIP: true, 
            expiryDate: vipData.expiry_date,
            plan: vipData.plan_type,
            daysLeft: daysLeft
        };
    } catch (error) {
        console.error('Error checking VIP status:', error);
        return { hasVIP: false };
    }
}

async function getOrderStatus(orderId) {
    try {
        const connection = await getPool().getConnection();
        
        const [rows] = await connection.execute(
            'SELECT * FROM orders WHERE id = ?',
            [orderId]
        );
        
        if (rows.length === 0) {
            return null;
        }
        
        const order = rows[0];

        // Check for auto-cancellation after 15 minutes
        if (order.payment_status === 'Unpaid') {
            const orderTime = new Date(order.created_at);
            const now = new Date();
            const diffMinutes = (now - orderTime) / 1000 / 60;
            
            if (diffMinutes > 15) {
                await connection.execute(
                    'UPDATE orders SET payment_status = "Cancelled", updated_at = NOW() WHERE id = ?',
                    [orderId]
                );
                
                await connection.execute(
                    'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, "ORDER_CANCELLED", ?, NOW())',
                    [order.user_id, `Order #${orderId} auto-cancelled due to timeout`]
                );
                
                order.payment_status = 'Cancelled';
            }
        }
        
        connection.release();
        
        return {
            id: order.id,
            userId: order.user_id,
            amount: parseFloat(order.amount),
            status: order.payment_status,
            plan: order.plan_type,
            planName: order.plan_name,
            createdAt: order.created_at,
            paidAt: order.paid_at,
            transactionRef: order.transaction_ref
        };
    } catch (error) {
        console.error('Error getting order status:', error);
        return null;
    }
}

// Helper: Create order
async function createOrder(userId, plan) {
    const planConfig = VIP_PLANS[plan];
    if (!planConfig) return null;
    
    try {
        const connection = await getPool().getConnection();
        
        const [result] = await connection.execute(
            'INSERT INTO orders (user_id, plan_type, plan_name, amount, payment_status) VALUES (?, ?, ?, ?, ?)',
            [userId, plan, planConfig.name, planConfig.price, 'Unpaid']
        );
        
        connection.release();
        
        return {
            id: result.insertId,
            userId,
            amount: planConfig.price,
            status: 'Unpaid',
            plan,
            planName: planConfig.name,
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error creating order:', error);
        return null;
    }
}

// Helper: Check order status
async function getOrderStatus(orderId) {
    try {
        const connection = await getPool().getConnection();
        
        const [rows] = await connection.execute(
            'SELECT * FROM orders WHERE id = ?',
            [orderId]
        );
        
        connection.release();
        
        if (rows.length === 0) {
            return null;
        }
        
        const order = rows[0];
        return {
            id: order.id,
            userId: order.user_id,
            amount: parseFloat(order.amount),
            status: order.payment_status,
            plan: order.plan_type,
            planName: order.plan_name,
            createdAt: order.created_at,
            paidAt: order.paid_at,
            transactionRef: order.transaction_ref
        };
    } catch (error) {
        console.error('Error getting order status:', error);
        return null;
    }
}

// === MAIN HANDLER ===
export default async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://your-domain.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    // Regular API handler
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

    const { action, payload } = req.body;
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    try {
        let result;
        switch (action) {
            // --- AUTHENTICATION ACTIONS ---
            case 'login': {
                const { username, password } = payload;
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
                const dotsRes = await callApi(`/getDot`, 'GET', token);
                const latestDot = (dotsRes.success && dotsRes.body.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                
                // NEW: Save user info to database
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
                
                if (!VIP_PLANS[plan]) {
                    return res.status(400).json({ success: false, message: 'Invalid plan' });
                }
                
                const order = await createOrder(userId, plan);
                
                if (!order) {
                    return res.status(500).json({ success: false, message: 'Failed to create order' });
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

            case 'getVIPPlans': {
                result = { 
                    success: true, 
                    plans: VIP_PLANS,
                    sepayConfig: SEPAY_CONFIG
                };
                break;
            }

            case 'cancelOrder': {
    const { orderId, reason } = payload;
    if (!orderId) return { success: false, message: 'Order ID required' };

    const connection = await getPool().getConnection();
    try {
        await connection.beginTransaction();

        const [orders] = await connection.execute(
            'SELECT * FROM orders WHERE id = ? AND payment_status = "Unpaid"',
            [orderId]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return { success: false, message: 'Order not found or cannot be cancelled' };
        }

        const order = orders[0];

        await connection.execute(
            'UPDATE orders SET payment_status = "Cancelled", updated_at = NOW() WHERE id = ?',
            [orderId]
        );

        await connection.execute(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, "ORDER_CANCELLED", ?, NOW())',
            [order.user_id, `Order #${orderId} cancelled by user${reason ? ` (${reason})` : ''}`]
        );

        await connection.commit();
        return { success: true, message: 'Order cancelled successfully' };
    } catch (error) {
        await connection.rollback();
        console.error('Error cancelling order:', error);
        return { success: false, message: error.message };
    } finally {
        connection.release();
    }
}

            // --- DATA RETRIEVAL ACTIONS ---
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                // Check VIP status for prerequisite courses
                const { dotId, fetchPrerequisites, userId } = payload;
                const vipStatus = await checkVIPStatus(userId);
                
                // Only allow prerequisite courses for VIP users
                const sources = (fetchPrerequisites && vipStatus.hasVIP) ? ['dkhp', 'dkhpdk'] : ['dkhp'];
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
                const vipStatus = await checkVIPStatus(userId);
                const sources = (fetchPrerequisites && vipStatus.hasVIP) ? ['dkhp', 'dkhpdk'] : ['dkhp'];
                let registeredData = [];

                for (const source of sources) {
                    const regRes = await callApi(`/getLHPDaDangKy?idDot=${dotId}`, 'GET', token, null, source);
                    if (regRes.success && Array.isArray(regRes.body)) {
                        await Promise.all(regRes.body.map(async (reg) => {
                            const detailRes = await callApi(`/getLichHoc?idDangKy=${reg.id}`, 'GET', token, null, 'dkhp');
                            const scheduleDetails = (detailRes && detailRes.success) ? detailRes.body : { error: true, message: detailRes.message };
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

            // --- WRITE ACTIONS (REGISTER/CANCEL) ---
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
        console.error('Handler error:', error);
        res.status(500).json({ success: false, message: 'Handler Error: ' + error.message });
    }
};
