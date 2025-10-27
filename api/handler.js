import fetch from 'node-fetch';
import mysql from 'mysql2/promise';

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'your_db_user',
    password: process.env.DB_PASSWORD || 'your_db_password',
    database: process.env.DB_NAME || 'uth_registration',
    waitForConnections: true,
    queueLimit: 0,
    timezone: '+07:00'
};

// Validate environment variables
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    console.error('Missing required database environment variables');
    throw new Error('Database configuration is incomplete');
}

// Create connection pool
let pool;
const getPool = () => {
    try {
        if (!pool) {
            pool = mysql.createPool(dbConfig);
            // Test connection
            pool.getConnection().then(conn => {
                console.log('Database connection established');
                conn.release();
            }).catch(err => {
                console.error('Database connection failed:', err);
                pool = null;
                throw err;
            });
        }
        return pool;
    } catch (error) {
        console.error('Error creating pool:', error);
        throw new Error('Database connection failed');
    }
};

// NEW: Helper function to save/update user info in database
async function saveUserInfo(profile) {
    let connection;
    try {
        connection = await getPool().getConnection();
        
        const username = profile.maSinhVien || profile.username;
        if (!username) {
            throw new Error('Missing username in profile');
        }
        
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
        
        return true;
    } catch (error) {
        console.error('Error saving user info:', error);
        return false;
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
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
        console.error('API call failed:', {
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

// Utility: Get schedule details for a class
async function getScheduleDetails(classId, token, source) {
    const result = await callApi(`/getLopHocPhanDetail?idLopHocPhan=${classId}`, 'GET', token, null, source);
    return (result && result.success) ? result.body : { error: true, message: result.message };
}

// VIP Plans - Now loaded from database dynamically
// Fallback for backward compatibility
const VIP_PLANS = {
    '1day': { price: 24000, duration: 1, name: '1 Ngày VIP' },
    '3days': { price: 72000, duration: 3, name: '3 Ngày VIP' },
    '7days': { price: 126000, duration: 7, name: '7 Ngày VIP' },
    '30days': { price: 432000, duration: 30, name: '30 Ngày VIP' }
};

// Helper: Get VIP plans from database
async function getVIPPlansFromDB() {
    try {
        const connection = await getPool().getConnection();
        const [plans] = await connection.execute(
            'SELECT plan_key, plan_name, duration_days, price, description, sort_order FROM vip_plans WHERE is_active = 1 ORDER BY sort_order ASC'
        );
        connection.release();
        
        // Convert to object format for backward compatibility
        const plansObj = {};
        plans.forEach(plan => {
            plansObj[plan.plan_key] = {
                price: parseFloat(plan.price),
                duration: plan.duration_days,
                name: plan.plan_name,
                description: plan.description || ''
            };
        });
        
        return Object.keys(plansObj).length > 0 ? plansObj : VIP_PLANS;
    } catch (error) {
        console.error('Error loading VIP plans from DB, using fallback:', error);
        return VIP_PLANS;
    }
}

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
            'SELECT *, TIMESTAMPDIFF(DAY, NOW(), expiry_date) as days_left FROM vip_subscriptions WHERE user_id = ? AND expiry_date > NOW() ORDER BY expiry_date DESC LIMIT 1',
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
            expiryDate: vipData.expiry_date,
            plan: vipData.plan_type,
            daysLeft: daysLeft
        };
    } catch (error) {
        console.error('Error checking VIP status:', error);
        return { hasVIP: false };
    }
}

// Helper: Create order (SePay only)
async function createOrder(userId, plan) {
    try {
        // Get current VIP plans from database
        const vipPlans = await getVIPPlansFromDB();
        const planConfig = vipPlans[plan];
        
        if (!planConfig) {
            console.error(`Invalid plan: ${plan}`);
            return null;
        }
        
        const connection = await getPool().getConnection();
        
        const [result] = await connection.execute(
            'INSERT INTO orders (user_id, plan_type, plan_name, amount, payment_status, gateway, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [userId, plan, planConfig.name, planConfig.price, 'Unpaid', 'SePay']
        );
        
        const orderId = result.insertId;
        connection.release();
        
        return {
            id: orderId,
            userId,
            amount: planConfig.price,
            status: 'Unpaid',
            plan,
            planName: planConfig.name,
            createdAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error creating order:', error);
        return { error: error.message };
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


// Helper: Cancel order
// Helper: Cancel order
async function cancelOrder(orderId) {
    try {
        const connection = await getPool().getConnection();
        
        // Check if order exists and is Unpaid
        const [rows] = await connection.execute(
            'SELECT * FROM orders WHERE id = ? AND payment_status = "Unpaid"',
            [orderId]
        );
        
        if (rows.length === 0) {
            connection.release();
            return null;
        }
        
        // Update order status to Cancelled
        await connection.execute(
            'UPDATE orders SET payment_status = "Cancelled", updated_at = NOW() WHERE id = ?',
            [orderId]
        );
        
        // Log activity
        await connection.execute(
            'INSERT INTO activity_logs (user_id, action, details, created_at) VALUES (?, "ORDER_CANCELLED", ?, NOW())',
            [rows[0].user_id, `User cancelled order ${orderId}`]
        );
        
        connection.release();
        return true;
    } catch (error) {
        console.error('Error cancelling order:', error);
        return null;
    }
}

// Helper: Auto-cancel expired orders (call this periodically)
async function autoCancelExpiredOrders() {
    try {
        const connection = await getPool().getConnection();
        
        // Cancel orders that are Unpaid for more than 15 minutes
        const [result] = await connection.execute(
            `UPDATE orders 
             SET payment_status = "Cancelled", updated_at = NOW() 
             WHERE payment_status = "Unpaid" 
             AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) > 15`
        );
        
        if (result.affectedRows > 0) {
            console.log(`Auto-cancelled ${result.affectedRows} expired orders`);
            
            // Log activity for cancelled orders
            await connection.execute(
                `INSERT INTO activity_logs (user_id, action, details, created_at)
                 SELECT user_id, "ORDER_AUTO_CANCELLED", CONCAT("Auto-cancelled order ", id, " (timeout)"), NOW()
                 FROM orders 
                 WHERE payment_status = "Cancelled" 
                 AND updated_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)`
            );
        }
        
        connection.release();
        return result.affectedRows;
    } catch (error) {
        console.error('Error auto-cancelling orders:', error);
        return 0;
    }
}

// Run auto-cancel every 5 minutes
setInterval(async () => {
    await autoCancelExpiredOrders();
}, 5 * 60 * 1000); // 5 minutes

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
                
                if (!order || order.error) {
                    return res.status(500).json({ success: false, message: order?.error || 'Failed to create order' });
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
