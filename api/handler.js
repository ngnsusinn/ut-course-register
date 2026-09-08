import fetch from 'node-fetch';
import mysql from 'mysql2/promise';
import https from 'https';
import crypto from 'crypto';

// ============================================
// Database configuration
// ============================================
// Tuned for a serverless (Vercel) runtime talking to ONE shared MySQL host:
//  - connectionLimit is deliberately small. Every warm lambda instance opens its own pool,
//    and the shared server caps ALL tenants at max_connections=200. A limit of 100 here
//    previously let a handful of concurrent logins take the whole server down.
//  - connectTimeout makes an unreachable DB fail in 5s instead of mysql2's 10s default.
//  - enableKeepAlive stops the pool handing back sockets that a load balancer already reaped
//    while the instance was frozen — the "first login after a pause is very slow" symptom.
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'your_db_user',
    password: process.env.DB_PASSWORD || 'your_db_password',
    database: process.env.DB_NAME || 'uth_registration',
    waitForConnections: true,
    queueLimit: 0,
    timezone: '+07:00',
    connectionLimit: Number(process.env.DB_POOL_SIZE || 5),
    maxIdle: 2,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    // Belt and braces: MySQL aborts a runaway read after 4s rather than hanging the lambda, and the
    // session clock is pinned to VN so `expiry_date > NOW()` means what the code thinks it means
    // (the shared host runs SYSTEM = +07 but the LAN target is UTC — this makes both correct).
    sessionVariables: { max_execution_time: 4000, time_zone: '+07:00' },
    charset: 'utf8mb4_unicode_ci',
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
            // A pooled connection that dies in the background must not become an unhandled
            // rejection (which on Vercel kills the instance mid-request for the next user).
            pool.on('error', (err) => console.error('❌ Pool connection error:', err.code || err.message));
            console.log('✅ Database pool created');
        }
        return pool;
    } catch (error) {
        console.error('❌ Error creating pool:', error);
        throw new Error('Database connection failed');
    }
};

/**
 * Acquire a connection with a hard ceiling so an exhausted pool can never hang the request.
 * On the shared MySQL host, brand-new TCP connections from cloud IPs are frequently dropped or
 * delayed several seconds (connect ETIMEDOUT). We retry a few times with a small backoff; each
 * attempt has an equal share of the overall budget so the request can never exceed timeoutMs.
 */
/**
 * Acquire a connection with a hard ceiling (never queue forever), while allowing enough time
 * for the shared MySQL host's notoriously slow new-connection handshake (~4-6s from cloud IPs).
 * A genuinely dead DB surfaces here as ETIMEDPOOL instead of hanging the request.
 */
async function acquire(timeoutMs = 9000) {
    const wait = getPool().getConnection();
    let timer;
    const guard = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`DB pool acquire timeout after ${timeoutMs}ms`), { code: 'ETIMEDPOOL' })), timeoutMs);
    });
    try {
        return await Promise.race([wait, guard]);
    } catch (e) {
        // If the connection arrived just after we gave up, do not leak it.
        wait.then((c) => c.release()).catch(() => {});
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

// ============================================
// Helper functions
// ============================================

/**
 * Log user activity to database
 * @param {string} userId - User identifier
 * @param {string} action - Action type (e.g. 'FETCH_SCHEDULE', 'REGISTER_CLASS')
 * @param {string} details - Human-readable details
 * @param {object} [req] - Express request object (to extract IP + User-Agent)
 */
async function logActivity(userId, action, details, req = null) {
    let connection;
    try {
        const ip = req ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || null) : null;
        const ua = req ? (req.headers['user-agent'] || null) : null;
        connection = await acquire();
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [String(userId || 'anonymous').slice(0, 64), String(action).slice(0, 64),
             details == null ? null : String(details).slice(0, 500),
             ip ? String(ip).slice(0, 64) : null, ua ? String(ua).slice(0, 255) : null]
        );
    } catch (error) {
        console.error('⚠️ Failed to log activity:', error.message);
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
}

/**
 * Generate random order code: DKHP + 12 random alphanumeric characters
 * Uses a CSPRNG: the code is the only thing tying an inbound bank transfer to an order,
 * and Math.random() output is predictable from a couple of observed codes.
 */
function generateOrderCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(12);
    let code = 'DKHP';
    for (let i = 0; i < 12; i++) {
        code += chars.charAt(bytes[i] % chars.length);
    }
    return code;
}

/**
 * Save or update user info in database, and record the login.
 * One upsert + one log INSERT (2 round trips) instead of SELECT + INSERT/UPDATE + log (3),
 * and the read-modify-write race that let two concurrent logins collide on uk_user_id is gone.
 */
async function saveUserInfo(profile, req = null) {
    let connection;
    try {
        const userId = profile.maSinhVien || profile.username;
        if (!userId) {
            throw new Error('Missing user_id in profile');
        }

        const email = profile.email || null;
        const fullName = `${profile.hoDem || ''} ${profile.ten || ''}`.trim();
        const ip = req ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.socket?.remoteAddress || null) : null;
        const ua = req ? (req.headers['user-agent'] || null) : null;

        connection = await acquire();

        // Atomic upsert on the uk_user_id unique key. affectedRows: 1 = inserted, 0 = unchanged, 2 = updated.
        await connection.execute(
            `INSERT INTO users (user_id, email, full_name, is_active, created_at, updated_at)
             VALUES (?, ?, ?, 1, NOW(), NOW())
             ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), updated_at = NOW()`,
            [userId, email, fullName]
        );

        // Log login activity — truncated so an oversized User-Agent cannot fail the whole insert.
        await connection.execute(
            `INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent, created_at) 
             VALUES (?, 'USER_LOGIN', ?, ?, ?, NOW())`,
            [userId, `Đăng nhập hệ thống - ${(fullName || userId)}`.slice(0, 500),
             ip ? String(ip).slice(0, 64) : null, ua ? String(ua).slice(0, 255) : null]
        );

        return userId;
    } catch (error) {
        console.error('❌ Error saving user info:', error.message);
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
 * Shared keep-alive agent for the portal.
 * node-fetch v2 defaults to a non keep-alive global agent, so every callApi paid a fresh
 * TCP + TLS handshake to portal.ut.edu.vn. A single login makes 2-3 of them, and
 * getFullSchedule makes hundreds.
 */
const portalAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    maxSockets: 32,
    maxFreeSockets: 8,
    timeout: 30000,
});

const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

/**
 * Call internal university API with proper error handling.
 * Failures are classified: `upstreamUnavailable` means "we do not know" (timeout, HTML error
 * page, DNS) and must never be treated by callers as "the user's session is invalid".
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
        agent: portalAgent,
        timeout: UPSTREAM_TIMEOUT_MS,
    };

    // Explicit deadline as well, so a socket that accepts but never answers cannot
    // outlive the function's own budget. (AbortController rather than AbortSignal.timeout
    // for compatibility with the runtime's declared Node >= 14 engines range.)
    const controller = new AbortController();
    options.signal = controller.signal;
    const deadline = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS + 500);

    try {
        const response = await fetch(targetUrl, options);
        const text = await response.text();
        clearTimeout(deadline);

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const err = new Error('Response is not JSON');
            err.upstreamUnavailable = true;
            throw err;
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            const err = new Error('Invalid JSON from portal');
            err.upstreamUnavailable = true;
            throw err;
        }
        
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
        clearTimeout(deadline);
        console.error('❌ API call failed:', {
            url: targetUrl,
            method,
            error: error.message
        });
        return {
            success: false,
            message: error.message,
            status: error.status || 500,
            upstreamUnavailable: true,
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
// Shared Class Data Functions
// ============================================

/**
 * Sync class data to shared database
 * @param {number} dotId - ID đợt đăng ký
 * @param {string} userId - User ID contributor
 * @param {string} source - Source (dkhp/dkhpdk)
 * @param {Array} classData - Array of class data to sync
 * @returns {Object} - Sync result with counts
 */
async function syncClassDataToDB(dotId, userId, source, classData) {
    let connection;
    try {
        // Validate inputs
        if (!dotId || !userId || !source) {
            return {
                success: false,
                error: 'Missing required parameters: dotId, userId, or source',
                inserted: 0,
                updated: 0,
                total: 0
            };
        }
        
        if (!Array.isArray(classData) || classData.length === 0) {
            return {
                success: true,
                inserted: 0,
                updated: 0,
                total: 0,
                message: 'No data to sync'
            };
        }
        
        connection = await acquire();
        
        let insertedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        
        // Prepare batch data
        const validClasses = [];
        for (const cls of classData) {
            // Validate required fields
            if (!cls.maLopHocPhan || !cls.maHocPhan || !cls.tenMonHoc) {
                console.warn('⚠️ Skipping class with missing required fields:', cls.maLopHocPhan || 'unknown');
                skippedCount++;
                continue;
            }
            
            // Safely stringify schedule details
            let scheduleJson = null;
            try {
                if (cls.scheduleDetails && Array.isArray(cls.scheduleDetails)) {
                    scheduleJson = JSON.stringify(cls.scheduleDetails);
                }
            } catch (jsonError) {
                console.warn('Failed to stringify scheduleDetails for:', cls.maLopHocPhan);
            }
            
            validClasses.push({
                dotId,
                maLopHocPhan: cls.maLopHocPhan,
                maHocPhan: cls.maHocPhan,
                tenMonHoc: cls.tenMonHoc,
                soTinChi: cls.soTinChi || 0,
                classId: cls.id || 0,
                tenTrangThai: cls.tenTrangThai || null,
                phanTramDangKy: cls.phanTramDangKy || 0,
                choDangKy: cls.choDangKy !== false ? 1 : 0,
                scheduleJson,
                source,
                isBatBuoc: cls.isBatBuoc !== undefined ? (cls.isBatBuoc ? 1 : 0) : null,
                userId
            });
        }
        
        if (validClasses.length === 0) {
            return {
                success: true,
                inserted: 0,
                updated: 0,
                total: 0,
                skipped: skippedCount,
                message: 'No valid data to sync'
            };
        }
        
        // Batch insert in chunks of 50 for better performance
        const BATCH_SIZE = 50;
        
        for (let i = 0; i < validClasses.length; i += BATCH_SIZE) {
            const batch = validClasses.slice(i, i + BATCH_SIZE);
            
            try {
                // Build batch INSERT query
                const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').join(', ');
                const values = batch.flatMap(cls => [
                    cls.dotId,
                    cls.maLopHocPhan,
                    cls.maHocPhan,
                    cls.tenMonHoc,
                    cls.soTinChi,
                    cls.classId,
                    cls.tenTrangThai,
                    cls.phanTramDangKy,
                    cls.choDangKy,
                    cls.scheduleJson,
                    cls.source,
                    cls.isBatBuoc,
                    cls.userId,
                    cls.userId
                ]);
                
                const query = `
                    INSERT INTO shared_class_data (
                        dot_id, ma_lop_hoc_phan, ma_hoc_phan, ten_mon_hoc, so_tin_chi,
                        class_id, ten_trang_thai, phan_tram_dang_ky, cho_dang_ky,
                        schedule_details, source, is_bat_buoc,
                        contributed_by, last_updated_by, contributor_count
                    ) VALUES ${placeholders}
                    ON DUPLICATE KEY UPDATE
                        ten_mon_hoc = VALUES(ten_mon_hoc),
                        so_tin_chi = VALUES(so_tin_chi),
                        class_id = VALUES(class_id),
                        ten_trang_thai = VALUES(ten_trang_thai),
                        phan_tram_dang_ky = VALUES(phan_tram_dang_ky),
                        cho_dang_ky = VALUES(cho_dang_ky),
                        schedule_details = VALUES(schedule_details),
                        is_bat_buoc = COALESCE(VALUES(is_bat_buoc), is_bat_buoc),
                        last_updated_by = VALUES(last_updated_by),
                        contributor_count = contributor_count + 1
                `;
                
                const [result] = await connection.execute(query, values);
                
                // With ON DUPLICATE KEY UPDATE:
                // - Insert new row = 1 affectedRow
                // - Update existing = 2 affectedRows
                // So we count batch.length as synced (either inserted or updated)
                const batchAffected = result.affectedRows || 0;
                const batchUpdates = batchAffected - batch.length; // Extra rows = updates (each counts as 2)
                const batchInserts = batch.length - batchUpdates;
                
                insertedCount += Math.max(0, batchInserts);
                updatedCount += Math.max(0, batchUpdates);
            } catch (batchError) {
                console.warn(`⚠️ Batch insert failed, falling back to individual inserts:`, batchError.message);
                // Fallback: try individual inserts for this batch
                for (const cls of batch) {
                    try {
                        const [result] = await connection.execute(`
                            INSERT INTO shared_class_data (
                                dot_id, ma_lop_hoc_phan, ma_hoc_phan, ten_mon_hoc, so_tin_chi,
                                class_id, ten_trang_thai, phan_tram_dang_ky, cho_dang_ky,
                                schedule_details, source, is_bat_buoc,
                                contributed_by, last_updated_by, contributor_count
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                            ON DUPLICATE KEY UPDATE
                                ten_mon_hoc = VALUES(ten_mon_hoc),
                                so_tin_chi = VALUES(so_tin_chi),
                                class_id = VALUES(class_id),
                                ten_trang_thai = VALUES(ten_trang_thai),
                                phan_tram_dang_ky = VALUES(phan_tram_dang_ky),
                                cho_dang_ky = VALUES(cho_dang_ky),
                                schedule_details = VALUES(schedule_details),
                                is_bat_buoc = COALESCE(VALUES(is_bat_buoc), is_bat_buoc),
                                last_updated_by = VALUES(last_updated_by),
                                contributor_count = contributor_count + 1
                        `, [
                            cls.dotId, cls.maLopHocPhan, cls.maHocPhan, cls.tenMonHoc, cls.soTinChi,
                            cls.classId, cls.tenTrangThai, cls.phanTramDangKy, cls.choDangKy,
                            cls.scheduleJson, cls.source, cls.isBatBuoc, cls.userId, cls.userId
                        ]);
                        
                        if (result.affectedRows === 1) insertedCount++;
                        else if (result.affectedRows === 2) updatedCount++;
                    } catch (singleError) {
                        console.warn(`⚠️ Failed to sync class ${cls.maLopHocPhan}:`, singleError.message);
                        skippedCount++;
                    }
                }
            }
        }
        
        // Update contribution stats
        const totalAffected = insertedCount + updatedCount;
        if (totalAffected > 0) {
            try {
                await connection.execute(`
                    INSERT INTO class_data_contributions (
                        user_id, dot_id, classes_contributed, sync_count,
                        first_contribution_at, last_contribution_at
                    ) VALUES (?, ?, ?, 1, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE
                        classes_contributed = classes_contributed + ?,
                        sync_count = sync_count + 1,
                        last_contribution_at = NOW()
                `, [userId, dotId, totalAffected, totalAffected]);
            } catch (statsError) {
                console.warn('Failed to update contribution stats:', statsError.message);
            }
        }
        
        console.log(`✅ Synced ${insertedCount} new, ${updatedCount} updated, ${skippedCount} skipped for dot ${dotId}`);
        
        return {
            success: true,
            inserted: insertedCount,
            updated: updatedCount,
            total: totalAffected
        };
    } catch (error) {
        console.error('❌ Error syncing class data:', error.message);
        return {
            success: false,
            error: error.message,
            inserted: 0,
            updated: 0,
            total: 0
        };
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
 * Get shared class data from database
 * @param {number} dotId - ID đợt đăng ký
 * @param {string} maHocPhan - Mã học phần (optional)
 * @param {string} source - Source filter (optional)
 * @returns {Array} - Array of class data
 */
async function getSharedClassDataFromDB(dotId, maHocPhan = null, source = null) {
    let connection;
    try {
        connection = await acquire();
        
        let query = `
            SELECT 
                class_id as id,
                ma_lop_hoc_phan as maLopHocPhan,
                ma_hoc_phan as maHocPhan,
                ten_mon_hoc as tenMonHoc,
                so_tin_chi as soTinChi,
                ten_trang_thai as tenTrangThai,
                phan_tram_dang_ky as phanTramDangKy,
                cho_dang_ky as choDangKy,
                schedule_details as scheduleDetails,
                source,
                is_bat_buoc as isBatBuoc,
                updated_at as lastUpdatedAt,
                contributor_count as contributorCount
            FROM shared_class_data
            WHERE dot_id = ?
        `;
        
        const params = [dotId];
        
        if (maHocPhan) {
            query += ' AND ma_hoc_phan = ?';
            params.push(maHocPhan);
        }
        
        if (source) {
            query += ' AND source = ?';
            params.push(source);
        }
        
        query += ' ORDER BY ma_hoc_phan, ma_lop_hoc_phan';
        
        const [rows] = await connection.execute(query, params);
        
        // Parse schedule_details JSON and convert boolean fields
        const classes = rows.map(row => {
            let scheduleDetails = [];
            try {
                if (row.scheduleDetails) {
                    scheduleDetails = typeof row.scheduleDetails === 'string' 
                        ? JSON.parse(row.scheduleDetails) 
                        : row.scheduleDetails;
                }
            } catch (parseError) {
                console.warn('Failed to parse scheduleDetails for class:', row.maLopHocPhan);
                scheduleDetails = [];
            }
            
            return {
                ...row,
                choDangKy: row.choDangKy === 1,
                isBatBuoc: row.isBatBuoc === null ? null : row.isBatBuoc === 1,
                scheduleDetails: scheduleDetails,
                fromSharedDB: true
            };
        });
        
        return classes;
    } catch (error) {
        console.error('❌ Error getting shared class data:', error.message);
        return [];
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
 * Get shared data statistics for a dot
 * @param {number} dotId - ID đợt đăng ký
 * @returns {Object} - Statistics
 */
async function getSharedDataStats(dotId) {
    let connection;
    try {
        connection = await acquire();
        
        // Get class counts
        const [classStats] = await connection.execute(`
            SELECT 
                COUNT(*) as totalClasses,
                COUNT(DISTINCT ma_hoc_phan) as totalSubjects,
                SUM(CASE WHEN source = 'dkhp' THEN 1 ELSE 0 END) as dkhpClasses,
                SUM(CASE WHEN source = 'dkhpdk' THEN 1 ELSE 0 END) as dkhpdkClasses,
                MAX(updated_at) as lastUpdatedAt
            FROM shared_class_data
            WHERE dot_id = ?
        `, [dotId]);
        
        // Get contributor count
        const [contribStats] = await connection.execute(`
            SELECT 
                COUNT(DISTINCT user_id) as totalContributors,
                SUM(sync_count) as totalSyncs
            FROM class_data_contributions
            WHERE dot_id = ?
        `, [dotId]);
        
        return {
            totalClasses: classStats[0]?.totalClasses || 0,
            totalSubjects: classStats[0]?.totalSubjects || 0,
            dkhpClasses: classStats[0]?.dkhpClasses || 0,
            dkhpdkClasses: classStats[0]?.dkhpdkClasses || 0,
            lastUpdatedAt: classStats[0]?.lastUpdatedAt || null,
            totalContributors: contribStats[0]?.totalContributors || 0,
            totalSyncs: contribStats[0]?.totalSyncs || 0
        };
    } catch (error) {
        console.error('❌ Error getting shared data stats:', error.message);
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

// ============================================
// VIP Plans Management
// ============================================

const VIP_PLANS_FALLBACK = {
    'free':   { price: 0,      duration: 1,  name: '1 Ngày Dùng Thử (Miễn Phí)' },
    '1day':   { price: 24000,  duration: 1,  name: '1 Ngày VIP' },
    '3days':  { price: 72000,  duration: 3,  name: '3 Ngày VIP' },
    '7days':  { price: 126000, duration: 7,  name: '7 Ngày VIP' },
    '30days': { price: 432000, duration: 30, name: '30 Ngày VIP' }
};

/**
 * Get active VIP plans from database
 * NOW: Uses vip_plans.plan_id for FK references
 */
async function getVIPPlansFromDB() {
    let connection;
    try {
        connection = await acquire();
        const [plans] = await connection.execute(
            `SELECT id, plan_key, plan_name, duration_days, price, description, sort_order 
             FROM vip_plans 
             WHERE is_active = 1 
             ORDER BY sort_order ASC`
        );
        
        // Convert to object format for backward compatibility
        const plansObj = {};
        plans.forEach(plan => {
            plansObj[plan.plan_key] = {
                id: plan.id, // NOW: Include plan_id for FK reference
                planKey: plan.plan_key,
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
    } finally {
        // Was missing: a failed query here used to remove a socket from the pool permanently.
        if (connection) { try { connection.release(); } catch (e) {} }
    }
}

// SePay Configuration
// Deliberately no fallback account: a deploy that forgets SEPAY_ACCOUNT_NUMBER used to silently
// show one hardcoded personal account number to every paying student, with no way to rotate it
// without shipping code. Missing config now means "payment is unavailable", not "send money here".
const SEPAY_CONFIG = {
    bankName: process.env.SEPAY_BANK_NAME || '',
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER || '',
    accountName: process.env.SEPAY_ACCOUNT_NAME || ''
};
const PAYMENT_CONFIGURED = Boolean(SEPAY_CONFIG.accountNumber && SEPAY_CONFIG.accountName);

// ============================================
// VIP Status & Subscriptions
// ============================================

/**
 * Check if user has active VIP subscription.
 * Runs on the login critical path (getInitialData), so it must be unable to leak a socket
 * or to block on a pool that has already been exhausted.
 */
async function checkVIPStatus(userId) {
    if (!userId) {
        // Previously this reached mysql2 as `undefined` in the bind list, which threw
        // "Bind parameters must not contain undefined" and leaked the connection.
        console.warn('⚠️ checkVIPStatus called without a userId');
        return { hasVIP: false };
    }
    let connection;
    try {
        connection = await acquire();
        const [rows] = await connection.execute(
            `SELECT 
                id,
                plan_id,
                plan_type,
                expiry_date,
                GREATEST(TIMESTAMPDIFF(DAY, NOW(), expiry_date), 0) as days_left
             FROM vip_subscriptions 
             WHERE user_id = ? AND expiry_date > NOW() 
             ORDER BY expiry_date DESC 
             LIMIT 1`,
            [userId]
        );
        
        if (rows.length === 0) {
            return { hasVIP: false };
        }
        
        const vipData = rows[0];
        const daysLeft = Number(vipData.days_left) + 1;
        
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
        // `unknown` lets the client keep showing its last known state instead of falsely
        // telling a paying member they have no VIP because our DB blipped.
        return { hasVIP: false, unknown: true };
    } finally {
        // Was missing: every failed query here permanently removed a socket from the pool.
        if (connection) { try { connection.release(); } catch (e) {} }
    }
}

// ============================================
// Caller identity
// ============================================
// The API has no session of its own: it forwards the student's portal JWT. That means an
// order id alone tells us nothing about who is asking, so order read/cancel used to be
// callable by anyone. We resolve the portal token to a student id here and cache it per warm
// instance so a polling client does not pay an upstream round trip every time.
const callerCache = new Map();
const CALLER_CACHE_TTL_MS = 10 * 60 * 1000;
const CALLER_CACHE_MAX = 500;

async function resolveCallerUserId(token) {
    if (!token) return null;
    const key = crypto.createHash('sha256').update(String(token)).digest('base64url').slice(0, 32);
    const hit = callerCache.get(key);
    if (hit && Date.now() - hit.at < CALLER_CACHE_TTL_MS) return hit.userId;

    const profileRes = await callApi('/user/getSummaryProfile', 'GET', token);
    const userId = (profileRes && profileRes.success && profileRes.body)
        ? (profileRes.body.maSinhVien || profileRes.body.username)
        : null;

    if (callerCache.size >= CALLER_CACHE_MAX) {
        // Drop the oldest entry rather than letting this grow without bound.
        const oldest = callerCache.keys().next().value;
        callerCache.delete(oldest);
    }
    if (userId) callerCache.set(key, { userId, at: Date.now() });
    return userId || null;
}

function orderBelongsToCaller(payload, order, callerUserId) {
    if (!callerUserId || !order?.userId) return false;
    return String(order.userId) === String(callerUserId);
}

// ============================================
// Order Management
// ============================================

/**
 * Activate free VIP plan directly (no payment needed)
 * Creates VIP subscription immediately without order/payment flow
 */
async function activateFreeVIP(userId, planConfig, connection) {
    let daysToAdd = planConfig.duration;
    let planId = planConfig.id;
    let planName = planConfig.name;

    // Check existing VIP subscription (use row lock)
    const [existingVIP] = await connection.execute(
        `SELECT id, expiry_date
         FROM vip_subscriptions
         WHERE user_id = ? AND expiry_date > NOW()
         ORDER BY expiry_date DESC
         LIMIT 1
         FOR UPDATE`,
        [userId]
    );

    let expiryString;

    if (existingVIP.length > 0) {
        // Extend from existing expiry date
        const d = new Date(existingVIP[0].expiry_date);
        const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        const baseYear = vnTime.getUTCFullYear();
        const baseMonth = vnTime.getUTCMonth();
        const baseDay = vnTime.getUTCDate();
        const result = new Date(Date.UTC(baseYear, baseMonth, baseDay + daysToAdd));
        expiryString = result.getUTCFullYear() + '-' +
            String(result.getUTCMonth() + 1).padStart(2, '0') + '-' +
            String(result.getUTCDate()).padStart(2, '0') + ' 23:59:59';
    } else {
        // New subscription: today + daysToAdd
        const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const baseYear = vnNow.getUTCFullYear();
        const baseMonth = vnNow.getUTCMonth();
        const baseDay = vnNow.getUTCDate();
        const result = new Date(Date.UTC(baseYear, baseMonth, baseDay + daysToAdd));
        expiryString = result.getUTCFullYear() + '-' +
            String(result.getUTCMonth() + 1).padStart(2, '0') + '-' +
            String(result.getUTCDate()).padStart(2, '0') + ' 23:59:59';
    }

    // Insert VIP subscription (no order_id since it's free)
    await connection.execute(
        `INSERT INTO vip_subscriptions (
            user_id, plan_id, plan_type, expiry_date, created_by_admin, created_at
        ) VALUES (?, ?, ?, ?, 'system_free', NOW())`,
        [userId, planId, planConfig.planKey || 'free', expiryString]
    );

    // Log activity
    await connection.execute(
        `INSERT INTO activity_logs (user_id, action, details, created_at)
         VALUES (?, 'FREE_VIP_ACTIVATED', ?, NOW())`,
        [userId, `Free VIP activated: ${planName} - Expiry: ${expiryString}`]
    );

    return {
        success: true,
        free: true,
        activated: true,
        planName: planName,
        daysAdded: daysToAdd,
        expiryDate: expiryString,
        isExtension: existingVIP.length > 0
    };
}

/**
 * Create a new VIP order
 * NOW: Includes plan_id FK reference and validates user exists
 */
async function createOrder(userId, plan) {
    let connection;
    try {
        connection = await acquire();
        
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

        // FREE PLAN: Activate directly without payment
        if (planConfig.price === 0) {
            await connection.beginTransaction();
            try {
                const freeResult = await activateFreeVIP(userId, { ...planConfig, planKey: plan }, connection);
                await connection.commit();
                return {
                    id: null, // No order for free plans
                    orderCode: null,
                    userId,
                    amount: 0,
                    status: 'Activated',
                    plan,
                    planId: planConfig.id,
                    planName: planConfig.name,
                    createdAt: new Date().toISOString(),
                    free: true,
                    activated: true,
                    expiryDate: freeResult.expiryDate,
                    daysAdded: freeResult.daysAdded,
                    isExtension: freeResult.isExtension
                };
            } catch (err) {
                await connection.rollback();
                console.error('❌ Error activating free VIP:', err.message);
                return { error: 'Failed to activate free VIP: ' + err.message };
            }
        }

        // PAID PLAN without payment config: refuse rather than issue an order whose transfer
        // instructions would be an unconfigured (or, as before, a hardcoded) bank account.
        if (!PAYMENT_CONFIGURED) {
            return { error: 'Thanh toán chưa được cấu hình. Vui lòng thử lại sau.' };
        }

        // PAID PLAN: Normal order creation flow
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
        connection = await acquire();
        
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
        connection = await acquire();
        
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
 * FIX: single-quote the string literals (double quotes become column references under
 *      ANSI_QUOTES, which some managed providers enable)
 * FIX: the expiry predicate is now sargable (`created_at < NOW() - INTERVAL 15 MINUTE`),
 *      so it rides the payment_status index instead of applying TIMESTAMPDIFF to every row
 * FIX: the SELECT and the UPDATE now share one transaction with row locks, so two warm
 *      lambdas cannot both see the same order and log the cancellation twice
 */
async function autoCancelExpiredOrders() {
    let connection;
    try {
        connection = await acquire();

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

        await connection.beginTransaction();

        // Get list of orders to cancel BEFORE updating, locking them so a concurrent
        // instance (or a payment webhook racing us) cannot interleave.
        const [ordersToCancel] = await connection.execute(
            `SELECT id, user_id FROM orders
             WHERE payment_status = 'Unpaid'
             AND created_at < (NOW() - INTERVAL 15 MINUTE)
             ORDER BY id LIMIT 500
             FOR UPDATE`
        );

        if (ordersToCancel.length === 0) {
            await connection.commit();
            return; // No orders to cancel
        }

        const ids = ordersToCancel.map((o) => o.id);
        // Update orders to Cancelled
        const [result] = await connection.execute(
            `UPDATE orders
             SET payment_status = 'Cancelled', cancelled_at = NOW(), updated_at = NOW()
             WHERE payment_status = 'Unpaid'
             AND id IN (${ids.map(() => '?').join(',')})`,
            ids
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

        await connection.commit();
    } catch (error) {
        if (connection) { try { await connection.rollback(); } catch (e) {} }
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

/**
 * Order-timeout sweeping used to run, fire-and-forget, on EVERY POST (including login).
 * That put a locking UPDATE on the login critical path and, worse, got truncated mid-statement
 * when the platform froze the instance right after the response — leaving InnoDB row locks
 * held on the shared server until the socket was reaped. Every later login then queued behind
 * those locks. It is now (a) never on the login path and (b) throttled per warm instance.
 */
const ORDER_SWEEP_INTERVAL_MS = Number(process.env.ORDER_SWEEP_INTERVAL_MS || 5 * 60 * 1000);
let lastOrderSweepAt = 0;
let sweepInFlight = null;
function sweepExpiredOrdersThrottled() {
    if (sweepInFlight) return sweepInFlight;
    if (Date.now() - lastOrderSweepAt < ORDER_SWEEP_INTERVAL_MS) return Promise.resolve(null);
    lastOrderSweepAt = Date.now();
    sweepInFlight = autoCancelExpiredOrders()
        .catch((err) => console.error('❌ Auto-cancel error:', err.message))
        .finally(() => { sweepInFlight = null; });
    return sweepInFlight;
}

/** Actions where an expired order must be reaped before we read/write order state. */
const ORDER_MAINTENANCE_ACTIONS = new Set(['createVIPOrder', 'checkOrderStatus', 'cancelOrder', 'getVIPPlans']);

export default async (req, res) => {
    // CORS Headers
    // Never fall back to '*': with Authorization allowed, a wildcard lets any site
    // drive the VIP/payment endpoints from a visitor's browser.
    const allowedOrigin = process.env.FRONTEND_URL || 'https://dkhputh.vercel.app';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Scheduled sweeper endpoint: `vercel.json` cron hits GET /api/handler with
    // `Authorization: Bearer $CRON_SECRET`. This replaces the per-request sweep.
    if (req.method === 'GET') {
        const secret = process.env.CRON_SECRET;
        const provided = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
        if (!secret || provided !== secret) {
            return res.status(405).json({ success: false, message: 'Method Not Allowed' });
        }
        await autoCancelExpiredOrders();
        lastOrderSweepAt = Date.now();
        return res.status(200).json({ success: true, swept: true });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { action, payload } = req.body || {};
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;

    if (!action || typeof action !== 'string') {
        return res.status(400).json({ success: false, message: 'Missing "action" in request body' });
    }
    if (payload !== undefined && (payload === null || typeof payload !== 'object')) {
        return res.status(400).json({ success: false, message: '"payload" must be an object' });
    }

    // Only reap expired orders for order-related actions, and at most once per instance
    // per interval — and always awaited, so the platform cannot freeze it mid-UPDATE.
    if (ORDER_MAINTENANCE_ACTIONS.has(action)) {
        await sweepExpiredOrdersThrottled();
    }

    try {
        let result;
        switch (action) {
            // --- AUTHENTICATION ---
            case 'login': {
                const { username, password } = payload || {};
                if (!username || !password) {
                    return res.status(400).json({ success: false, message: 'Thiếu tên đăng nhập hoặc mật khẩu' });
                }
                result = await callApi('/user/login', 'POST', null, { username, password });
                break;
            }

            case 'getInitialData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                // These two upstream calls are independent; awaiting them one after the other
                // added a full portal round trip (~200ms+) to every single login.
                const [profileRes, dotsRes] = await Promise.all([
                    callApi('/user/getSummaryProfile', 'GET', token),
                    callApi('/getDot', 'GET', token),
                ]);
                const latestDot = (dotsRes.success && dotsRes.body?.length) 
                    ? dotsRes.body.reduce((max, d) => d.id > max.id ? d : max)
                    : null;
                
                // Save user info to database (now returns userId)
                let savedUserId = null;
                if (profileRes.success && profileRes.body) {
                    savedUserId = await saveUserInfo(profileRes.body, req);
                }
                
                // Check VIP status
                const userId = savedUserId || profileRes.body?.maSinhVien || profileRes.body?.username;
                const vipStatus = await checkVIPStatus(userId);
                
                result = {
                    success: profileRes.success && !!latestDot,
                    profile: profileRes.body,
                    dot: latestDot,
                    vip: vipStatus,
                    // The portal was reachable and answered; a false here is a real rejection.
                    upstreamUnavailable: profileRes.upstreamUnavailable === true || dotsRes.upstreamUnavailable === true,
                };
                break;
            }

            case 'validateToken': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                try {
                    const validateRes = await callApi('/user/getCredit', 'GET', token);
                    // callApi only guarantees `status` on its own error envelope, and the portal
                    // does not reliably echo one on success. Deriving validity from
                    // `validateRes.status === 200` reported every live token as expired whenever the
                    // portal omitted the field, so app.js wiped the saved session and bounced
                    // users back to the login form.
                    const valid = validateRes.success === true;
                    result = {
                        success: true,
                        valid,
                        // Transient portal trouble must not be mistaken for an expired session:
                        // the client keeps the session and retries instead of logging the user out.
                        upstreamUnavailable: validateRes.upstreamUnavailable === true,
                        expired: valid ? false : validateRes.status === 401,
                    };
                } catch (error) {
                    result = { success: true, valid: false, upstreamUnavailable: true, expired: false, message: 'Token validation failed' };
                }
                break;
            }

            // --- VIP ACTIONS ---
            case 'checkVIPStatus': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { userId } = payload || {};
                result = { success: true, vip: await checkVIPStatus(userId) };
                break;
            }

            case 'createVIPOrder': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { userId, plan } = payload || {};
                if (!userId || !plan) {
                    return res.status(400).json({ success: false, message: 'Thiếu userId hoặc gói VIP' });
                }

                // Validate plan exists before we spend a DB write on logging it.
                const vipPlans = await getVIPPlansFromDB();
                if (!vipPlans[plan]) {
                    return res.status(400).json({ success: false, message: 'Invalid plan' });
                }

                // Log: user creating VIP order
                void logActivity(userId, 'CREATE_VIP_ORDER', `Tạo đơn mua VIP gói ${plan}`, req);

                
                const order = await createOrder(userId, plan);
                
                if (order.error) {
                    return res.status(400).json({ success: false, message: order.error });
                }
                
                result = { success: true, order };
                break;
            }

            case 'checkOrderStatus': {
                // These two actions used to run with no token at all, so any visitor could walk
                // `orderId` and read (or cancel) another student's payment.
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { orderId } = payload || {};
                if (!Number.isInteger(Number(orderId))) {
                    return res.status(400).json({ success: false, message: 'orderId is required' });
                }
                const order = await getOrderStatus(parseInt(orderId));
                
                if (!order) {
                    return res.status(404).json({ success: false, message: 'Order not found' });
                }
                const caller = await resolveCallerUserId(token);
                if (!orderBelongsToCaller(payload, order, caller)) {
                    return res.status(403).json({ success: false, message: 'Forbidden' });
                }

                result = { success: true, order };
                break;
            }

            case 'cancelOrder': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { orderId } = payload || {};
                if (!Number.isInteger(Number(orderId))) {
                    return res.status(400).json({ success: false, message: 'orderId is required' });
                }
                const order = await getOrderStatus(parseInt(orderId));
                if (!order) {
                    return res.status(404).json({ success: false, message: 'Order not found or already processed' });
                }
                const caller = await resolveCallerUserId(token);
                if (!orderBelongsToCaller(payload, order, caller)) {
                    return res.status(403).json({ success: false, message: 'Forbidden' });
                }
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
                    sepayConfig: SEPAY_CONFIG,
                    // False when the SEPAY_* env vars are absent: the client must then offer only
                    // the free plan instead of showing bank details that were never configured.
                    paymentAvailable: PAYMENT_CONFIGURED
                };
                break;
            }

            // --- DATA RETRIEVAL ---
            case 'getFullSchedule': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, fetchPrerequisites, userId } = payload || {};
                
                // Log: user fetching full schedule
                void logActivity(userId, 'FETCH_SCHEDULE', `Tải danh sách lớp học phần - Đợt ${dotId}${fetchPrerequisites ? ' (có ĐKHP điều kiện)' : ''}`, req);
                
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
                
                // Log result count
                await logActivity(userId, 'FETCH_SCHEDULE_DONE', `Đã tải ${allClassData.length} lớp học phần - Đợt ${dotId}`, req);
                
                result = { success: true, schedule: allClassData, subjectTypes: subjectTypeMap };
                break;
            }
            
            case 'getRegisteredClasses': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { dotId, fetchPrerequisites, userId } = payload || {};
                
                // Log: user fetching registered classes
                void logActivity(userId, 'FETCH_REGISTERED', `Tải lớp đã đăng ký - Đợt ${dotId}`, req);
                
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
                const { dotId, maHocPhan, source } = payload || {};
                const classEndpoint = source === 'dkhpdk'
                    ? `/getLopHocPhan?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`
                    : `/getLopHocPhanChoDangKy?idDot=${dotId}&maHocPhan=${maHocPhan}&isLocTrung=False&isLocTrungWithoutElearning=false`;
                
                result = await callApi(classEndpoint, 'GET', token, null, source);
                
                // Fallback to shared database if API returns empty/error
                if (!result.success || !Array.isArray(result.body) || result.body.length === 0) {
                    console.log(`⚠️ API returned empty for ${maHocPhan}, falling back to shared DB`);
                    
                    const sharedData = await getSharedClassDataFromDB(dotId, maHocPhan, source);
                    
                    if (sharedData && sharedData.length > 0) {
                        console.log(`✅ Found ${sharedData.length} classes in shared DB for ${maHocPhan}`);
                        result = {
                            success: true,
                            body: sharedData,
                            fromSharedDB: true,
                            message: 'Dữ liệu từ CSDL chia sẻ cộng đồng'
                        };
                    }
                }
                break;
            }

            case 'getScheduleDetails': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, source } = payload || {};
                const scheduleDetails = await getScheduleDetails(classId, token, source);
                result = { 
                    success: !scheduleDetails.error, 
                    body: scheduleDetails 
                };
                break;
            }

            case 'checkClassAvailability': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { classId, dotId, maHocPhan, source, userId: availUserId } = payload || {};
                
                // Log: checking class availability (auto-register cycle)
                void logActivity(availUserId, 'CHECK_AVAILABILITY', `Kiểm tra chỗ trống lớp ${maHocPhan} (${source})`, req);
                
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
                const { classId, source, userId, className } = payload || {};
                
                // Log: user registering a class
                void logActivity(userId, 'REGISTER_CLASS', `Đăng ký lớp ${className || classId} (${source})`, req);
                
                result = await callApi(`/dangKyLopHocPhan?idLopHocPhan=${classId}`, 'POST', token, null, source);
                
                // Log result
                if (result.success) {
                    await logActivity(userId, 'REGISTER_SUCCESS', `Đăng ký thành công lớp ${className || classId}`, req);
                } else {
                    await logActivity(userId, 'REGISTER_FAILED', `Đăng ký thất bại lớp ${className || classId}: ${result.message || 'Unknown error'}`, req);
                }
                break;
            }

            case 'cancel': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                const { registrationId, source, userId, className } = payload || {};
                
                // Log: user cancelling a registration
                void logActivity(userId, 'CANCEL_CLASS', `Hủy đăng ký lớp ${className || registrationId} (${source})`, req);
                
                result = await callApi(`/huyDangKy?idDangKy=${registrationId}`, 'DELETE', token, null, source);
                
                // Log result
                if (result.success) {
                    await logActivity(userId, 'CANCEL_SUCCESS', `Hủy thành công lớp ${className || registrationId}`, req);
                } else {
                    await logActivity(userId, 'CANCEL_FAILED', `Hủy thất bại lớp ${className || registrationId}: ${result.message || 'Unknown error'}`, req);
                }
                break;
            }

            // --- SHARED CLASS DATA ACTIONS ---
            case 'syncClassData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, userId, source, classData } = payload || {};
                
                if (!dotId || !userId || !source || !Array.isArray(classData)) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Missing required fields: dotId, userId, source, classData' 
                    });
                }
                
                if (classData.length === 0) {
                    return res.status(200).json({ 
                        success: true, 
                        message: 'No data to sync',
                        inserted: 0,
                        updated: 0,
                        total: 0
                    });
                }
                
                // Log: user syncing class data
                void logActivity(userId, 'SYNC_DATA', `Đồng bộ ${classData.length} lớp vào CSDL cộng đồng - Đợt ${dotId} (${source})`, req);
                
                const syncResult = await syncClassDataToDB(dotId, userId, source, classData);
                
                // Log sync result
                if (syncResult.success) {
                    await logActivity(userId, 'SYNC_DATA_DONE', `Đồng bộ hoàn tất: ${syncResult.inserted} mới, ${syncResult.updated} cập nhật`, req);
                }
                
                result = {
                    success: syncResult.success,
                    inserted: syncResult.inserted,
                    updated: syncResult.updated,
                    total: syncResult.total,
                    message: syncResult.success 
                        ? `Đã đồng bộ ${syncResult.total} lớp vào CSDL cộng đồng`
                        : syncResult.error
                };
                break;
            }

            case 'getSharedClassData': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId, maHocPhan, source } = payload || {};
                
                if (!dotId) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Missing required field: dotId' 
                    });
                }
                
                const sharedData = await getSharedClassDataFromDB(dotId, maHocPhan, source);
                
                result = {
                    success: true,
                    body: sharedData,
                    count: sharedData.length,
                    fromSharedDB: true
                };
                break;
            }

            case 'getSharedDataStats': {
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
                
                const { dotId } = payload || {};
                
                if (!dotId) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Missing required field: dotId' 
                    });
                }
                
                const stats = await getSharedDataStats(dotId);
                
                if (stats) {
                    result = {
                        success: true,
                        stats: stats
                    };
                } else {
                    result = {
                        success: false,
                        message: 'Không thể lấy thống kê'
                    };
                }
                break;
            }

            // --- LOGGING ACTION ---
            case 'logUserAction': {
                const { userId: logUserId, action: logAction, details: logDetails } = payload || {};

                // This endpoint used to accept anonymous writes under any student id, which is
                // both a log-forgery vector and unbounded INSERT amplification on a shared DB
                // (every UI click from every visitor). Requiring the portal token removes the
                // anonymous population entirely.
                if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

                // Whitelist of allowed frontend actions
                const allowedActions = [
                    'LOGIN_SUCCESS', 'LOGOUT',
                    'START_AUTO_REGISTER', 'STOP_AUTO_REGISTER',
                    'START_AUTO_INSERT', 'STOP_AUTO_INSERT',
                    'SELECT_CLASS', 'DESELECT_CLASS',
                    'REMOVE_SELECTED', 'REMOVE_SWAP',
                    'FETCH_SCHEDULE_BTN', 'REFRESH_REGISTERED',
                    'VIEW_TIMETABLE', 'EXPORT_TIMETABLE',
                    'CHECK_VIP_STATUS', 'OPEN_VIP_MODAL', 'OPEN_GUIDE',
                    'SWAP_CLASS', 'SWAP_CLASS_SETUP', 'SWAP_FROM_REGISTERED',
                    'SELECT_FROM_SWAP_MODAL', 'OPEN_SWAP_MODAL',
                    'BUY_VIP_PLAN', 'CANCEL_PAYMENT', 'CANCEL_CLASS_CONFIRM'
                ];
                
                if (!logUserId || !logAction) {
                    return res.status(400).json({ success: false, message: 'userId and action required' });
                }
                
                // Only allow whitelisted actions from frontend
                const safeAction = allowedActions.includes(logAction) ? logAction : 'USER_ACTION';
                // Fire-and-forget: an activity log must never add a DB round trip to the response
                // the student is waiting on.
                void logActivity(logUserId, safeAction, logDetails || logAction, req);

                result = { success: true };
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
