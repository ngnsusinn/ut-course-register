// ============================================
// ADMIN HANDLER (MongoDB)
// ============================================
import crypto from 'crypto';
import { getDb, nextId, vnWallClockToUTCDate } from './db.js';
export default async function handler(req, res) {
    // The admin API must not be wildcard-open to any origin, and its state-changing actions
    // below are NOT yet individually authenticated (see dispatch) — restricting CORS is the
    // cheap half of the defence and removes the "drive it from a victim's browser" attack.
    const adminOrigin = process.env.ADMIN_FRONTEND_URL || process.env.FRONTEND_URL || 'https://dkhputh.vercel.app';
    res.setHeader('Access-Control-Allow-Origin', adminOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

    const { action, payload } = req.body || {};
    if (!action) return res.status(400).json({ success: false, message: 'Action required' });

    try {
        let result;
        switch (action) {
            case 'login': result = await adminLogin(payload); break;
            case 'getAllUsers': result = await getAllUsers(); break;
            case 'getAllSubscriptions': result = await getAllSubscriptions(); break;
            case 'getAllOrders': result = await getAllOrders(); break;
            case 'getAllTransactions': result = await getAllTransactions(); break;
            case 'addVIPSubscription': result = await addVIPSubscription(payload); break;
            case 'deleteSubscription': result = await deleteSubscription(payload); break;
            case 'deleteUser': result = await deleteUser(payload); break;
            case 'getDashboardStats': result = await getDashboardStats(); break;
            case 'getAllVIPPlans': result = await getAllVIPPlans(); break;
            case 'createVIPPlan': result = await createVIPPlan(payload); break;
            case 'updateVIPPlan': result = await updateVIPPlan(payload); break;
            case 'deleteVIPPlan': result = await deleteVIPPlan(payload); break;
            case 'toggleVIPPlanStatus': result = await toggleVIPPlanStatus(payload); break;
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

/**
 * Password verification that is transparent to the current database.
 *
 * The admins table has historically stored the password UNHASHED in the column named
 * `password_hash` (confirmed live: the stored value is 15 chars, i.e. a plaintext password),
 * and the login query compared it directly: `WHERE password_hash = ?`. Any read of that table
 * is therefore a complete credential dump.
 *
 * We keep existing admins able to log in, but on a successful login we immediately rewrite the
 * stored value to an scrypt hash (format: scrypt$N$r$p$saltB64$hashB64). New rows can only be
 * created with a hash. Nothing is compared in SQL anymore — no timing side channel via queries.
 */
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64;

function scryptHash(plaintext, salt) {
    const derived = crypto.scryptSync(String(plaintext), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function scryptVerify(stored, plaintext) {
    try {
        const parts = String(stored).split('$');
        if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
        const [, N, r, p, saltB64, hashB64] = parts;
        const derived = crypto.scryptSync(String(plaintext), Buffer.from(saltB64, 'base64'), SCRYPT_KEYLEN,
            { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
        const a = Buffer.from(derived);
        const b = Buffer.from(hashB64, 'base64');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

/** @returns {{ ok: boolean, needsUpgrade?: boolean }} */
function verifyAdminPassword(stored, plaintext) {
    if (!stored || !plaintext) return { ok: false };
    if (String(stored).startsWith('scrypt$')) {
        return { ok: scryptVerify(stored, plaintext) };
    }
    // Legacy plaintext column (or any old format we no longer trust) — compare directly,
    // and if it matches, the caller should rewrite the row to an scrypt hash.
    const a = Buffer.from(String(stored));
    const b = Buffer.from(String(plaintext));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { ok, needsUpgrade: ok };
}

async function adminLogin(payload) {
    const { username, password } = payload;
    if (!username || !password) {
        return { success: false, message: 'Username and password required' };
    }

    try {
        const db = await getDb();
        const admins = db.collection('admins');

        const admin = await admins.findOne(
            { username: String(username), is_active: 1 },
            { projection: { _id: 0, id: 1, username: 1, full_name: 1, role: 1, password_hash: 1 } }
        );

        if (!admin) {
            return { success: false, message: 'Invalid credentials' };
        }

        const verdict = verifyAdminPassword(admin.password_hash, password);
        if (!verdict.ok) {
            return { success: false, message: 'Invalid credentials' };
        }

        // Transparently upgrade a legacy plaintext row to an scrypt hash.
        const now = new Date();
        if (verdict.needsUpgrade || !String(admin.password_hash).startsWith('scrypt$')) {
            await admins.updateOne(
                { id: admin.id },
                { $set: { password_hash: scryptHash(password, crypto.randomBytes(16)), last_login: now, updated_at: now } }
            );
        } else {
            await admins.updateOne({ id: admin.id }, { $set: { last_login: now } });
        }

        // An admin session is still just this object — the real hardening (session tokens +
        // auth on the other actions) is intentionally left as a separate decision.
        return { success: true, admin: { id: admin.id, username: admin.username, full_name: admin.full_name, role: admin.role } };
    } catch (error) {
        console.error('❌ Error in adminLogin:', error.message);
        throw error; // let the dispatcher answer 500 — a DB outage is NOT "invalid credentials"
    }
}

// ============================================
// User Management
// ============================================

async function getAllUsers() {
    const db = await getDb();

    // Same shape as the old LEFT JOIN + GROUP BY on vip_subscriptions: attach each user's
    // farthest expiry and a 0/1 VIP flag.
    const [users, subs] = await Promise.all([
        db.collection('users').find({}, {
            projection: {
                _id: 0, id: 1, user_id: 1, username: 1, full_name: 1, email: 1,
                is_active: 1, last_login: 1, created_at: 1, updated_at: 1,
            },
        }).sort({ user_id: 1 }).toArray(),
        db.collection('vip_subscriptions').find({}, { projection: { _id: 0, user_id: 1, expiry_date: 1 } }).toArray(),
    ]);

    const maxExpiry = new Map();
    for (const s of subs) {
        const cur = maxExpiry.get(s.user_id);
        if (!cur || new Date(s.expiry_date) > new Date(cur)) maxExpiry.set(s.user_id, s.expiry_date);
    }

    const now = new Date();
    const result = users.map((u) => {
        const expiry = maxExpiry.get(u.user_id) || null;
        return { ...u, expiry_date: expiry, is_vip: expiry && new Date(expiry) > now ? 1 : 0 };
    });

    return { success: true, users: result };
}

// ============================================
// VIP Subscriptions Management
// ============================================

async function getAllSubscriptions() {
    const db = await getDb();

    const [subs, plans, orders] = await Promise.all([
        db.collection('vip_subscriptions').find({}, {
            projection: {
                _id: 0, id: 1, user_id: 1, plan_id: 1, order_id: 1, plan_type: 1,
                expiry_date: 1, created_by_admin: 1, created_at: 1, updated_at: 1,
            },
        }).sort({ created_at: -1 }).toArray(),
        db.collection('vip_plans').find({}, { projection: { _id: 0, id: 1, plan_name: 1 } }).toArray(),
        db.collection('orders').find({}, { projection: { _id: 0, id: 1, order_code: 1 } }).toArray(),
    ]);

    const planNames = new Map(plans.map((p) => [p.id, p.plan_name]));
    const orderCodes = new Map(orders.map((o) => [o.id, o.order_code]));

    return {
        success: true,
        subscriptions: subs.map((s) => ({
            id: s.id,
            user_id: s.user_id,
            plan_id: s.plan_id,
            order_id: s.order_id,
            order_code: s.order_id != null ? (orderCodes.get(s.order_id) || null) : null,
            plan_type: s.plan_type,
            plan_name: s.plan_id != null ? (planNames.get(s.plan_id) || null) : null,
            expiry_date: s.expiry_date,
            created_by_admin: s.created_by_admin,
            created_at: s.created_at,
            updated_at: s.updated_at,
        })),
    };
}

async function addVIPSubscription(payload) {
    const { userId, planType } = payload;
    if (!userId || !planType) {
        return { success: false, message: 'userId and planType required' };
    }

    try {
        const db = await getDb();

        // Get plan info from database
        const plan = await db.collection('vip_plans').findOne(
            { plan_key: String(planType) },
            { projection: { _id: 0, id: 1, duration_days: 1, plan_name: 1 } }
        );
        if (!plan) {
            return { success: false, message: 'Invalid plan type' };
        }

        const planId = plan.id;
        const days = plan.duration_days;

        // VALIDATION: make sure the user row exists (the old code inserted it on the fly)
        const users = db.collection('users');
        const existingUser = await users.findOne({ user_id: String(userId) }, { projection: { _id: 0, id: 1 } });
        if (!existingUser) {
            const now = new Date();
            await users.insertOne({
                id: await nextId('users'),
                user_id: String(userId),
                username: null,
                email: null,
                full_name: null,
                is_active: 1,
                last_login: null,
                created_at: now,
                updated_at: now,
            });
            console.log(`ℹ️  Created new user: ${userId}`);
        }

        // Check for active VIP subscription
        const activeVIP = await db.collection('vip_subscriptions').findOne(
            { user_id: String(userId), expiry_date: { $gt: new Date() } },
            { projection: { _id: 0, expiry_date: 1 }, sort: { expiry_date: -1 } }
        );

        let expiryDate;
        let addType = 'new';

        if (activeVIP) {
            // Extend from existing expiry date (round to end of day, then add days)
            expiryDate = new Date(activeVIP.expiry_date);
            // Round to end of current expiry day
            expiryDate.setHours(23, 59, 59, 999);
            // Add the number of days
            expiryDate.setDate(expiryDate.getDate() + days);

            // Format to a wall-clock datetime string (YYYY-MM-DD HH:mm:ss) to preserve timezone
            const expiryString = expiryDate.getFullYear() + '-' +
                String(expiryDate.getMonth() + 1).padStart(2, '0') + '-' +
                String(expiryDate.getDate()).padStart(2, '0') + ' ' +
                String(expiryDate.getHours()).padStart(2, '0') + ':' +
                String(expiryDate.getMinutes()).padStart(2, '0') + ':' +
                String(expiryDate.getSeconds()).padStart(2, '0');

            await insertSubscription(db, userId, planId, planType, expiryString, 'admin');
            addType = 'cumulative';
        } else {
            // Start from tomorrow midnight, then add days (end of day)
            expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 1);
            expiryDate.setHours(0, 0, 0, 0);
            expiryDate.setDate(expiryDate.getDate() + days);
            // Set to end of the final day
            expiryDate.setHours(23, 59, 59, 999);

            // Format to wall-clock datetime string (YYYY-MM-DD HH:mm:ss) to preserve timezone
            const expiryString = expiryDate.getFullYear() + '-' +
                String(expiryDate.getMonth() + 1).padStart(2, '0') + '-' +
                String(expiryDate.getDate()).padStart(2, '0') + ' ' +
                String(expiryDate.getHours()).padStart(2, '0') + ':' +
                String(expiryDate.getMinutes()).padStart(2, '0') + ':' +
                String(expiryDate.getSeconds()).padStart(2, '0');

            await insertSubscription(db, userId, planId, planType, expiryString, 'admin');
            addType = 'new';
        }

        return {
            success: true,
            message: addType === 'cumulative'
                ? `Đã cộng thêm ${days} ngày VIP`
                : `Đã thêm VIP ${days} ngày mới`,
            expiryDate: expiryDate.toISOString(),
            addType
        };
    } catch (error) {
        console.error('❌ Error adding VIP:', error.message);
        return { success: false, message: 'Failed to add VIP', error: error.message };
    }
}

/** Shared writer for the two addVIPSubscription branches. */
async function insertSubscription(db, userId, planId, planType, expiryString, createdBy) {
    const now = new Date();
    await db.collection('vip_subscriptions').insertOne({
        id: await nextId('vip_subscriptions'),
        user_id: String(userId),
        plan_id: planId,
        plan_type: planType,
        expiry_date: vnWallClockToUTCDate(expiryString),
        order_id: null,
        created_by_admin: createdBy,
        created_at: now,
        updated_at: now,
    });
}

async function deleteSubscription(payload) {
    const { subscriptionId } = payload;
    if (!subscriptionId) {
        return { success: false, message: 'subscriptionId required' };
    }

    try {
        const db = await getDb();
        const result = await db.collection('vip_subscriptions').deleteOne({ id: Number(subscriptionId) });

        if (result.deletedCount === 0) {
            return { success: false, message: 'Subscription not found' };
        }

        return { success: true, message: 'Subscription deleted' };
    } catch (error) {
        console.error('❌ Error deleting subscription:', error.message);
        return { success: false, message: 'Failed to delete', error: error.message };
    }
}

async function deleteUser(payload) {
    const { userId } = payload;
    if (!userId) {
        return { success: false, message: 'userId required' };
    }

    try {
        const db = await getDb();
        const uid = String(userId);

        // Replicates what the MySQL FK graph used to do on DELETE:
        //   vip_subscriptions.user_id  ON DELETE CASCADE   -> subscriptions disappear
        //   orders.user_id             ON DELETE SET NULL  -> orders stay, anonymised
        //   (transactions hang off orders and are untouched)
        await db.collection('vip_subscriptions').deleteMany({ user_id: uid });
        await db.collection('orders').updateMany({ user_id: uid }, { $set: { user_id: null, updated_at: new Date() } });
        await db.collection('users').deleteOne({ user_id: uid });

        return { success: true, message: 'User deleted successfully' };
    } catch (error) {
        console.error('❌ Error deleting user:', error.message);
        return { success: false, message: 'Failed to delete user', error: error.message };
    }
}

// ============================================
// Order Management
// ============================================

async function getAllOrders() {
    const db = await getDb();
    const orders = await db.collection('orders').find({}, {
        projection: {
            _id: 0, id: 1, order_code: 1, user_id: 1, plan_id: 1, plan_type: 1, plan_name: 1,
            amount: 1, payment_status: 1, transaction_ref: 1, gateway: 1,
            created_at: 1, updated_at: 1, paid_at: 1, cancelled_at: 1,
        },
    }).sort({ created_at: -1 }).toArray();
    return { success: true, orders };
}

// ============================================
// Transactions
// ============================================

async function getAllTransactions() {
    const db = await getDb();
    const [transactions, orders] = await Promise.all([
        db.collection('transactions').find({}, {
            projection: {
                _id: 0, id: 1, order_id: 1, gateway: 1, transaction_date: 1, account_number: 1,
                sub_account: 1, amount_in: 1, amount_out: 1, accumulated: 1, code: 1,
                transaction_content: 1, reference_number: 1, body: 1, received_at: 1,
            },
        }).sort({ received_at: -1 }).toArray(),
        db.collection('orders').find({}, { projection: { _id: 0, id: 1, order_code: 1 } }).toArray(),
    ]);

    const orderCodes = new Map(orders.map((o) => [o.id, o.order_code]));
    return {
        success: true,
        transactions: transactions.map((t) => ({
            ...t,
            order_code: t.order_id != null ? (orderCodes.get(t.order_id) || null) : null,
        })),
    };
}

// ============================================
// Dashboard Statistics (using improved views)
// ============================================

// 7*3600*1000: shift a UTC instant to Vietnam wall clock before bucketing by calendar day —
// exactly what DATE(x) did inside the old +07:00 session.
const VN_DAY_MS = 7 * 60 * 60 * 1000;

async function getDashboardStats() {
    try {
        const db = await getDb();
        const now = new Date();

        const totalUsers = await db.collection('users').countDocuments({});

        // Count DISTINCT users with active VIP (not total subscriptions)
        const vipUsers = (await db.collection('vip_subscriptions').distinct('user_id', { expiry_date: { $gt: now } })).length;

        const orders = db.collection('orders');
        const paidFilter = { payment_status: 'Paid' };
        const totalRevenue = (await orders.aggregate([
            { $match: paidFilter },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]).toArray())[0];

        // Order summary
        const [orderStats] = await orders.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    paid: { $sum: { $cond: [{ $eq: ['$payment_status', 'Paid'] }, 1, 0] } },
                    unpaid: { $sum: { $cond: [{ $eq: ['$payment_status', 'Unpaid'] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $eq: ['$payment_status', 'Cancelled'] }, 1, 0] } },
                },
            },
        ]).toArray();

        // Revenue by date (last 7 days)
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
        let revenueByDate = [];
        try {
            revenueByDate = await orders.aggregate([
                { $match: { payment_status: 'Paid', paid_at: { $ne: null, $gte: sevenDaysAgo } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: { $add: ['$paid_at', VN_DAY_MS] } } },
                        revenue: { $sum: '$amount' },
                    },
                },
                { $sort: { _id: -1 } },
                { $limit: 7 },
            ]).toArray();
        } catch (e) {
            revenueByDate = [];
        }

        // Normalize data format to ensure consistency (date-only bucket -> +07 midnight instant,
        // the same Date object the mysql2 driver produced for DATE(paid_at))
        const normalizedRevenueData = revenueByDate.map(row => ({
            date: vnWallClockToUTCDate(`${row._id} 00:00:00`),
            revenue: parseFloat(row.revenue || 0)
        }));

        // User growth (last 7 days)
        const userGrowthRaw = await db.collection('users').aggregate([
            { $match: { created_at: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: { $add: ['$created_at', VN_DAY_MS] } } },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]).toArray();
        const userGrowth = userGrowthRaw.map(row => ({
            date: vnWallClockToUTCDate(`${row._id} 00:00:00`),
            count: row.count,
        }));

        // VIP plan distribution
        const vipDistributionRaw = await db.collection('vip_subscriptions').aggregate([
            { $match: { expiry_date: { $gt: now } } },
            { $group: { _id: '$plan_type', count: { $sum: 1 } } },
        ]).toArray();
        const vipDistribution = vipDistributionRaw.map(row => ({ plan_type: row._id, count: row.count }));

        return {
            success: true,
            stats: {
                totalUsers,
                vipUsers,
                totalRevenue: parseFloat((totalRevenue && totalRevenue.total) || 0),
                orders: {
                    total: (orderStats && orderStats.total) || 0,
                    paid: (orderStats && orderStats.paid) || 0,
                    unpaid: (orderStats && orderStats.unpaid) || 0,
                    cancelled: (orderStats && orderStats.cancelled) || 0,
                },
                revenueByDate: normalizedRevenueData,
                userGrowth,
                vipDistribution,
            }
        };
    } catch (error) {
        console.warn('⚠️  Dashboard stats error:', error.message);
        // Fallback to basic stats if anything failed
        try {
            const db = await getDb();
            const totalUsers = await db.collection('users').countDocuments({});
            const vipUsers = (await db.collection('vip_subscriptions').distinct('user_id', { expiry_date: { $gt: new Date() } })).length;

            return {
                success: true,
                stats: {
                    totalUsers,
                    vipUsers,
                    totalRevenue: 0,
                    orders: { total: 0, paid: 0, unpaid: 0, cancelled: 0 },
                    revenueByDate: [],
                    userGrowth: [],
                    vipDistribution: [],
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
                }
            };
        }
    }
}

// ============================================
// VIP Plans Management
// ============================================

async function getAllVIPPlans() {
    const db = await getDb();
    const plans = await db.collection('vip_plans').find({}, {
        projection: {
            _id: 0, id: 1, plan_key: 1, plan_name: 1, duration_days: 1, price: 1,
            is_active: 1, sort_order: 1, description: 1, created_at: 1, updated_at: 1,
        },
    }).sort({ sort_order: 1, id: 1 }).toArray();
    return { success: true, plans };
}

async function createVIPPlan(payload) {
    const { planKey, planName, durationDays, price, sortOrder, description } = payload;

    if (!planKey || !planName || !durationDays || price === undefined || price === null) {
        return { success: false, message: 'planKey, planName, durationDays, and price are required' };
    }

    try {
        const db = await getDb();

        // Check if plan_key already exists (unique index)
        const existing = await db.collection('vip_plans').findOne({ plan_key: planKey }, { projection: { _id: 0, id: 1 } });
        if (existing) {
            return { success: false, message: 'Plan key already exists' };
        }

        await db.collection('vip_plans').insertOne({
            id: await nextId('vip_plans'),
            plan_key: planKey,
            plan_name: planName,
            duration_days: durationDays,
            price,
            is_active: 1,
            sort_order: sortOrder || 0,
            description: description || null,
            created_at: new Date(),
            updated_at: null,
        });
        return { success: true, message: 'VIP plan created successfully' };
    } catch (error) {
        console.error('❌ Error creating VIP plan:', error.message);
        return { success: false, message: 'Failed to create VIP plan', error: error.message };
    }
}

async function updateVIPPlan(payload) {
    const { id, planKey, planName, durationDays, price, sortOrder, description, isActive } = payload;

    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    try {
        const db = await getDb();
        const plans = db.collection('vip_plans');

        const existing = await plans.findOne({ id: Number(id) }, { projection: { _id: 0, plan_key: 1 } });
        if (!existing) {
            return { success: false, message: 'Plan not found' };
        }

        // If plan_key is being changed, check for duplicates
        if (planKey && planKey !== existing.plan_key) {
            const duplicate = await plans.findOne({ plan_key: planKey, id: { $ne: Number(id) } }, { projection: { _id: 0, id: 1 } });
            if (duplicate) {
                return { success: false, message: 'Plan key already exists' };
            }
        }

        const set = { updated_at: new Date() };
        if (planKey !== undefined) set.plan_key = planKey;
        if (planName !== undefined) set.plan_name = planName;
        if (durationDays !== undefined) set.duration_days = durationDays;
        if (price !== undefined) set.price = price;
        if (sortOrder !== undefined) set.sort_order = sortOrder;
        if (description !== undefined) set.description = description;
        if (isActive !== undefined) set.is_active = isActive ? 1 : 0;

        await plans.updateOne({ id: Number(id) }, { $set: set });
        return { success: true, message: 'VIP plan updated successfully' };
    } catch (error) {
        console.error('❌ Error updating VIP plan:', error.message);
        return { success: false, message: 'Failed to update VIP plan', error: error.message };
    }
}

async function deleteVIPPlan(payload) {
    const { id } = payload;

    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    try {
        const db = await getDb();

        const plan = await db.collection('vip_plans').findOne({ id: Number(id) }, { projection: { _id: 0, plan_key: 1, plan_name: 1 } });
        if (!plan) {
            return { success: false, message: 'Plan not found' };
        }

        // Check if plan is being used
        const activeOrdersCount = await db.collection('orders').countDocuments({ plan_id: Number(id), payment_status: 'Unpaid' });
        if (activeOrdersCount > 0) {
            return {
                success: false,
                message: `Cannot delete plan. ${activeOrdersCount} unpaid orders are using this plan.`
            };
        }

        await db.collection('vip_plans').deleteOne({ id: Number(id) });
        return { success: true, message: 'VIP plan deleted successfully' };
    } catch (error) {
        console.error('❌ Error deleting VIP plan:', error.message);
        return { success: false, message: 'Failed to delete VIP plan', error: error.message };
    }
}

async function toggleVIPPlanStatus(payload) {
    const { id } = payload;

    if (!id) {
        return { success: false, message: 'Plan ID is required' };
    }

    try {
        const db = await getDb();
        const plans = db.collection('vip_plans');

        const plan = await plans.findOne({ id: Number(id) }, { projection: { _id: 0, plan_name: 1, is_active: 1 } });
        if (!plan) {
            return { success: false, message: 'Plan not found' };
        }

        const newStatus = plan.is_active ? 0 : 1;
        await plans.updateOne({ id: Number(id) }, { $set: { is_active: newStatus, updated_at: new Date() } });
        return { success: true, message: `Plan ${newStatus ? 'enabled' : 'disabled'} successfully`, isActive: newStatus };
    } catch (error) {
        console.error('❌ Error toggling VIP plan status:', error.message);
        return { success: false, message: 'Failed to toggle plan status', error: error.message };
    }
}
