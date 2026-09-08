// ============================================
// IMPROVED SEPAY WEBHOOK WITH FK & CONSTRAINTS
// ============================================
import mysql from 'mysql2/promise';
import crypto from 'crypto';

// ============================================
// Database configuration
// ============================================
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'your_db_user',
    password: process.env.DB_PASSWORD || 'your_db_password',
    database: process.env.DB_NAME || 'uth_registration',
    waitForConnections: true,
    connectionLimit: Number(process.env.WEBHOOK_DB_POOL_SIZE || 3),
    maxIdle: 1,
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    queueLimit: 0,
    timezone: '+07:00',
    // The webhook holds a transaction open across several statements, so it is the worst place
    // to inherit mysql2's 10s connect default or an unbounded wait for a free socket.
    sessionVariables: { max_execution_time: 8000, time_zone: '+07:00' },
    charset: 'utf8mb4_unicode_ci',
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
        pool.on('error', (err) => console.error('❌ Webhook pool connection error:', err.code || err.message));
        console.log('✅ Webhook database pool created');
    }
    return pool;
};

/** Acquire a connection with a hard ceiling so an exhausted pool cannot hang a payment callback. */
async function acquire(timeoutMs = 6000) {
    const wait = getPool().getConnection();
    let timer;
    const guard = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('DB pool acquire timeout'), { code: 'ETIMEDPOOL' })), timeoutMs);
    });
    try {
        return await Promise.race([wait, guard]);
    } catch (e) {
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
 * Format a Date as a MySQL datetime in VIETNAM wall-clock (UTC+7), regardless of the process
 * timezone. All stored timestamps must agree with the DB session clock (pinned to +07:00) and
 * with the wall-clock expiry strings computed elsewhere; reading process-local getters would
 * silently shift rows by the Vercel region's UTC offset.
 */
function formatToMySQL(dt) {
    const pad = n => (n < 10 ? '0' + n : n);
    const vn = new Date(dt.getTime() + 7 * 3600 * 1000);
    return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}`;
}

/**
 * Compute VIP expiry datetime string in VN timezone (UTC+7)
 * Rule: baseDate + daysToAdd → 23:59:59 of that day
 * 
 * Examples (1-day plan):
 *   Buy 1/1 at 18:00 → expires 2/1 23:59:59
 *   Buy 1/1 at 00:00 → expires 2/1 23:59:59
 * 
 * Extending (existing expiry 2/1 23:59:59, buy 3-day):
 *   2/1 + 3 = 5/1 23:59:59
 * 
 * @param {number} daysToAdd - Number of days to add
 * @param {Date|string|null} fromExpiryDate - Existing expiry to extend from (null = new subscription from today)
 * @returns {string} MySQL datetime string 'YYYY-MM-DD 23:59:59' in VN timezone
 */
function computeVIPExpiry(daysToAdd, fromExpiryDate = null) {
    let baseYear, baseMonth, baseDay;

    if (fromExpiryDate) {
        // Extending: extract VN date from existing expiry datetime
        // Shift to VN timezone to get correct date components
        const d = new Date(fromExpiryDate);
        const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        baseYear = vnTime.getUTCFullYear();
        baseMonth = vnTime.getUTCMonth();
        baseDay = vnTime.getUTCDate();
    } else {
        // New subscription: use today in VN timezone (UTC+7)
        const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        baseYear = vnNow.getUTCFullYear();
        baseMonth = vnNow.getUTCMonth();
        baseDay = vnNow.getUTCDate();
    }

    // Add days (Date.UTC handles month/year overflow automatically)
    const result = new Date(Date.UTC(baseYear, baseMonth, baseDay + daysToAdd));

    return result.getUTCFullYear() + '-' +
        String(result.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(result.getUTCDate()).padStart(2, '0') + ' 23:59:59';
}

/**
 * Process VIP payment after bank payment received
 * NOW: Uses order_id FK, validates amounts, handles cancelled orders
 */
async function processVIPPayment(orderId, transactionData) {
    let connection;
    try {
        connection = await acquire();
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

        let expiryString;

        if (existingVIP.length > 0) {
            // User already has active VIP - extend from existing expiry date
            // Rule: existing expiry DATE + daysToAdd → 23:59:59
            expiryString = computeVIPExpiry(daysToAdd, existingVIP[0].expiry_date);
            
            await connection.execute(
                `INSERT INTO vip_subscriptions (
                    user_id, plan_id, plan_type, expiry_date, order_id, created_at
                ) VALUES (?, ?, ?, ?, ?, NOW())`,
                [order.user_id, resolvedPlanId, order.plan_type, expiryString, orderId]
            );
            
            console.log(`✅ Extended VIP: ${order.user_id}, +${daysToAdd} days → ${expiryString}`);
        } else {
            // New subscription: today (VN timezone) + daysToAdd → 23:59:59
            expiryString = computeVIPExpiry(daysToAdd);
            
            await connection.execute(
                `INSERT INTO vip_subscriptions (
                    user_id, plan_id, plan_type, expiry_date, order_id, created_at
                ) VALUES (?, ?, ?, ?, ?, NOW())`,
                [order.user_id, resolvedPlanId, order.plan_type, expiryString, orderId]
            );
            
            console.log(`✅ Created new VIP: ${order.user_id}, expires ${expiryString}`);
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
            expiryDate: expiryString,
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
        connection = await acquire();
        
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
        connection = await acquire();
        
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

/**
 * SePay request authentication (https://developer.sepay.vn/en/sepay-webhooks/xac-thuc).
 * This endpoint previously accepted ANY request that knew the URL, so an attacker who could
 * guess/observe an order code (DKHP + 12 chars) could self-activate VIP for free.
 *
 * Implemented here: the API-Key method (`Authorization: Apikey <key>`), which does not depend
 * on the raw request body. Vercel's runtime parses JSON bodies before our handler runs, so the
 * HMAC-SHA256 method (which signs `{timestamp}.{raw_body}`) cannot be verified from parsed JSON —
 * use the API-Key method in the SePay webhook wizard and store the key in SEPA_API_KEY.
 *
 * When SEPA_API_KEY is NOT configured we log a loud warning on every call and still accept the
 * request so a misconfigured deploy cannot silently stop real payments. Configure the key to
 * actually lock the endpoint down.
 */
let warnedAboutMissingSecret = false;
function authorizeSePay(req) {
    const expectedKey = process.env.SEPAY_API_KEY || process.env.SEPAY_WEBHOOK_SECRET;
    if (!expectedKey) {
        if (!warnedAboutMissingSecret) {
            warnedAboutMissingSecret = true;
            console.warn('⚠️⚠️ SEPAY_API_KEY is not set — webhook accepts UNSIGNED requests (VIP can be granted for free). Set SEPAY_API_KEY and switch the SePay webhook to API-Key auth.');
        }
        return { ok: true, mode: 'unprotected' };
    }

    const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
    const apiKey = String(auth).startsWith('Apikey ') ? String(auth).slice('Apikey '.length).trim() : null;

    const a = Buffer.from(String(apiKey || ''));
    const b = Buffer.from(String(expectedKey));
    const validApiKey = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (validApiKey) return { ok: true, mode: 'apikey' };

    // API-Key header is also acceptable in the classic `token` body field some SePay gateways send.
    return { ok: false, mode: 'invalid' };
}

export default async (req, res) => {
    // CORS Headers
    const allowedOrigin = process.env.FRONTEND_URL || 'https://dkhputh.vercel.app';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-SePay-Signature, X-SePay-Timestamp');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    // Authenticate the caller BEFORE touching the database.
    const auth = authorizeSePay(req);
    if (!auth.ok) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

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

        // Parse and convert transaction date.
        // SePay sends transactionDate as Vietnamese wall-clock "YYYY-MM-DD HH:mm:ss".
        // The old code treated it as UTC and then ADDED 7h, storing the transaction 7 hours
        // in the future (formatToMySQL then read it back with UTC getters, compounding the error).
        // We parse the wall-clock components as-is and round-trip them unchanged: the DB session
        // clock is pinned to +07:00 (see sessionVariables), so the stored value now means the
        // same moment the bank reported.
        let transactionDateStr = formatToMySQL(new Date());
        if (transactionDate && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(String(transactionDate).trim())) {
            const m = String(transactionDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
            const Y = Number(m[1]), Mo = Number(m[2]), D = Number(m[3]);
            const H = Number(m[4]), Mi = Number(m[5]), S = Number(m[6]);
            // Interpret the wall-clock as VN time: build the instant = UTC(Y,Mo,D,H-7,...) so that
            // formatToMySQL (which renders +7h) reproduces the exact string SePay reported.
            transactionDateStr = formatToMySQL(new Date(Date.UTC(Y, Mo - 1, D, H - 7, Mi, S)));
        }

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
            connection = await acquire();
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