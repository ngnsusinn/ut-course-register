// ============================================
// SEPAY WEBHOOK (MongoDB)
// ============================================
import crypto from 'crypto';
import { getDb, nextId, vnWallClockToUTCDate } from './db.js';
// ============================================
// Helper functions
// ============================================

/**
 * Format a Date as a Vietnam wall-clock string (UTC+7), regardless of the process timezone.
 * All expiry computations produce these strings; they are converted to true UTC instants
 * (BSON Dates) at write time by vnWallClockToUTCDate(), so stored values carry the exact same
 * semantics the DATETIME columns had inside the old +07:00 MySQL session.
 */
function formatToVNWallClock(dt) {
    const pad = n => (n < 10 ? '0' + n : n);
    const vn = new Date(dt.getTime() + 7 * 3600 * 1000);
    return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}`;
}

/**
 * Compute VIP expiry wall-clock string in VN timezone (UTC+7)
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
 * @returns {string} wall-clock datetime string 'YYYY-MM-DD 23:59:59' in VN timezone
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
 * Process VIP payment after bank payment received.
 * The old SELECT ... FOR UPDATE + transaction is replaced by a single-document
 * compare-and-swap (Unpaid -> Paid): concurrent duplicate webhooks and the auto-cancel
 * sweep race the same order row, and exactly one of them wins.
 */
async function processVIPPayment(orderId, transactionData) {
    try {
        const db = await getDb();
        const orders = db.collection('orders');
        const subs = db.collection('vip_subscriptions');
        const plans = db.collection('vip_plans');
        const numericOrderId = Number(orderId);

        const order = await orders.findOne(
            { id: numericOrderId, payment_status: { $in: ['Unpaid', 'Cancelled'] } },
            { projection: { _id: 0, id: 1, user_id: 1, plan_type: 1, plan_id: 1, plan_name: 1, amount: 1, payment_status: 1 } }
        );
        if (!order) {
            return { success: false, message: 'Order not found or already paid' };
        }

        // Verify amount matches (with small tolerance for float errors)
        const txAmount = parseFloat(transactionData.amount_in || 0);
        const orderAmount = parseFloat(order.amount || 0);
        if (Math.abs(txAmount - orderAmount) > 0.01) {
            return { success: false, message: `Amount mismatch: received ${txAmount}, expected ${orderAmount}` };
        }

        // Check if order was already cancelled
        if (order.payment_status === 'Cancelled') {
            // Record transaction ref but DO NOT activate VIP
            await orders.updateOne(
                { id: numericOrderId },
                { $set: { transaction_ref: transactionData.reference_number, updated_at: new Date() } }
            );
            console.log(`⚠️  Payment received for cancelled order #${orderId}, VIP not activated`);

            return {
                success: true,
                message: 'Payment recorded but order was already cancelled. VIP not activated.',
                orderCancelled: true
            };
        }

        // Order is Unpaid - resolve the plan BEFORE claiming the order, so an unresolvable
        // plan leaves the order untouched (the old rollback behaviour).
        let daysToAdd = 1;
        let resolvedPlanId = order.plan_id;
        if (order.plan_id) {
            // Use plan_id reference
            const plan = await plans.findOne(
                { id: Number(order.plan_id), is_active: 1 },
                { projection: { _id: 0, id: 1, duration_days: 1 } }
            );
            if (plan) {
                daysToAdd = plan.duration_days;
                resolvedPlanId = plan.id;
            }
        } else {
            // Fallback to plan_key lookup (also resolve plan_id)
            const plan = await plans.findOne(
                { plan_key: order.plan_type, is_active: 1 },
                { projection: { _id: 0, id: 1, duration_days: 1 } }
            );
            if (plan) {
                daysToAdd = plan.duration_days;
                resolvedPlanId = plan.id;
            }
        }
        if (!resolvedPlanId) {
            return { success: false, message: `Cannot resolve plan_id for order #${orderId} (plan_type: ${order.plan_type})` };
        }

        // Claim the order: exactly one concurrent webhook can flip Unpaid -> Paid.
        const now = new Date();
        const claimed = await orders.findOneAndUpdate(
            { id: numericOrderId, payment_status: 'Unpaid' },
            { $set: { payment_status: 'Paid', paid_at: now, transaction_ref: transactionData.reference_number, updated_at: now } },
            { projection: { _id: 0, id: 1 } }
        );
        if (!claimed) {
            return { success: false, message: 'Order not found or already paid' };
        }

        // Idempotency: check if this order already has a VIP subscription
        // (a duplicate webhook racing us, or a replay after the order was already paid once)
        const existingSub = await subs.findOne({ order_id: numericOrderId }, { projection: { _id: 0, id: 1 } });
        if (existingSub) {
            console.log(`⚠️ Order #${orderId} already has VIP subscription #${existingSub.id}, skipping duplicate`);
            return { success: true, message: 'Payment already processed (idempotent)', duplicate: true };
        }

        const existingVIP = await subs.findOne(
            { user_id: order.user_id, expiry_date: { $gt: new Date() } },
            { projection: { _id: 0, expiry_date: 1 }, sort: { expiry_date: -1 } }
        );

        let expiryString;
        if (existingVIP) {
            // User already has active VIP - extend from existing expiry date
            // Rule: existing expiry DATE + daysToAdd → 23:59:59
            expiryString = computeVIPExpiry(daysToAdd, existingVIP.expiry_date);
            await subs.insertOne({
                id: await nextId('vip_subscriptions'),
                user_id: order.user_id,
                plan_id: resolvedPlanId,
                plan_type: order.plan_type,
                expiry_date: vnWallClockToUTCDate(expiryString),
                order_id: numericOrderId,
                created_by_admin: null,
                created_at: now,
                updated_at: now,
            });
            console.log(`✅ Extended VIP: ${order.user_id}, +${daysToAdd} days → ${expiryString}`);
        } else {
            // New subscription: today (VN timezone) + daysToAdd → 23:59:59
            expiryString = computeVIPExpiry(daysToAdd);
            await subs.insertOne({
                id: await nextId('vip_subscriptions'),
                user_id: order.user_id,
                plan_id: resolvedPlanId,
                plan_type: order.plan_type,
                expiry_date: vnWallClockToUTCDate(expiryString),
                order_id: numericOrderId,
                created_by_admin: null,
                created_at: now,
                updated_at: now,
            });
            console.log(`✅ Created new VIP: ${order.user_id}, expires ${expiryString}`);
        }

        return {
            success: true,
            message: 'Payment processed successfully',
            expiryDate: expiryString,
            orderCancelled: false
        };
    } catch (error) {
        console.error('❌ Error in processVIPPayment:', error.message);
        return { success: false, message: error.message || 'Unknown error' };
    }
}

/**
 * Record transaction in database with order_id link.
 * NOTE: the old schema had order_id NOT NULL + FK, so unmatched payments were deliberately
 * NOT persisted (log only). The contract is kept: skipping stays until that business rule
 * changes. transactionDateStr is a VN wall-clock string and is stored as a true UTC instant.
 */
async function recordTransaction(transactionData) {
    if (!transactionData.orderId) {
        console.warn('⚠️ Skipping transaction record: no order_id (legacy NOT NULL + FK contract).',
            'Content:', transactionData.content || 'N/A',
            'Ref:', transactionData.referenceCode || 'N/A');
        return { success: false, skipped: true, message: 'No order_id - cannot record transaction (NOT NULL constraint)' };
    }

    try {
        const db = await getDb();
        const id = await nextId('transactions');
        const now = new Date();
        await db.collection('transactions').insertOne({
            id,
            order_id: transactionData.orderId,
            gateway: transactionData.gateway || '',
            transaction_date: transactionData.transactionDateStr
                ? vnWallClockToUTCDate(transactionData.transactionDateStr)
                : now,
            account_number: transactionData.accountNumber || '',
            sub_account: transactionData.subAccount || null,
            amount_in: Number(transactionData.amountIn) || 0,
            amount_out: Number(transactionData.amountOut) || 0,
            accumulated: transactionData.accumulated != null ? Number(transactionData.accumulated) : 0,
            code: transactionData.code || null,
            transaction_content: transactionData.content || null,
            reference_number: transactionData.referenceCode || null,
            body: transactionData.description || null,
            received_at: now,
        });

        return { success: true, transactionId: id };
    } catch (error) {
        console.error('❌ Error recording transaction:', error.message);
        return { success: false, message: error.message };
    }
}

/**
 * Auto-cancel unpaid orders after 15 minutes.
 */
async function autoCancelExpiredOrders() {
    try {
        const db = await getDb();
        const cutoff = new Date(Date.now() - 15 * 60 * 1000);

        const ordersToCancel = await db.collection('orders')
            .find({ payment_status: 'Unpaid', created_at: { $lt: cutoff } }, { projection: { _id: 0, id: 1 } })
            .sort({ id: 1 })
            .limit(500)
            .toArray();

        if (ordersToCancel.length === 0) return;

        const ids = ordersToCancel.map((o) => o.id);
        const result = await db.collection('orders').updateMany(
            { id: { $in: ids }, payment_status: 'Unpaid' },
            { $set: { payment_status: 'Cancelled', cancelled_at: new Date(), updated_at: new Date() } }
        );

        if (result.modifiedCount > 0) {
            console.log(`✅ Auto-cancelled ${result.modifiedCount} orders`);
        }
    } catch (error) {
        console.error('❌ Error auto-cancelling orders:', error.message);
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
        // in the future (formatToVNWallClock then read it back with UTC getters, compounding the error).
        // We parse the wall-clock components as-is and round-trip them unchanged: the DB session
        // clock is pinned to +07:00 (see sessionVariables), so the stored value now means the
        // same moment the bank reported.
        let transactionDateStr = formatToVNWallClock(new Date());
        if (transactionDate && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(String(transactionDate).trim())) {
            const m = String(transactionDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
            const Y = Number(m[1]), Mo = Number(m[2]), D = Number(m[3]);
            const H = Number(m[4]), Mi = Number(m[5]), S = Number(m[6]);
            // Interpret the wall-clock as VN time: build the instant = UTC(Y,Mo,D,H-7,...) so that
            // formatToVNWallClock (which renders +7h) reproduces the exact string SePay reported.
            transactionDateStr = formatToVNWallClock(new Date(Date.UTC(Y, Mo - 1, D, H - 7, Mi, S)));
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
        const orderRow = await (await getDb()).collection('orders')
            .findOne({ order_code: orderCode }, { projection: { _id: 0, id: 1 } });
        const orderId = orderRow ? orderRow.id : null;

        if (orderId === null) {
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