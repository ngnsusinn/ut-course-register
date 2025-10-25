import { executeQuery, executeTransaction } from '../database/db_utils.js';

async function migrateData() {
    try {
        console.log('🚀 Starting data migration...\n');

        // Migrate users
        console.log('Migrating users...');
        await executeQuery(`
            INSERT INTO users (id, username, status)
            SELECT DISTINCT user_id, user_id, 'active'
            FROM vip_subscriptions_old
        `);
        
        // Migrate subscription plans
        console.log('Migrating subscription plans...');
        await executeQuery(`
            INSERT INTO subscription_plans (id, name, duration_days, price, status)
            VALUES 
            ('1day', '1 Ngày VIP', 1, 10000.00, 'active'),
            ('3days', '3 Ngày VIP', 3, 25000.00, 'active'),
            ('7days', '7 Ngày VIP', 7, 50000.00, 'active'),
            ('30days', '30 Ngày VIP', 30, 432000.00, 'active')
        `);

        // Migrate orders
        console.log('Migrating orders...');
        await executeQuery(`
            INSERT INTO orders (id, user_id, plan_id, amount, payment_status, transaction_ref, created_at, paid_at)
            SELECT 
                o.id,
                o.user_id,
                CASE 
                    WHEN o.plan_type = '1day' THEN '1day'
                    WHEN o.plan_type = '3days' THEN '3days'
                    WHEN o.plan_type = '7days' THEN '7days'
                    WHEN o.plan_type = '30days' THEN '30days'
                END as plan_id,
                o.amount,
                o.payment_status,
                o.transaction_ref,
                o.created_at,
                o.paid_at
            FROM orders_old o
        `);

        // Migrate transactions
        console.log('Migrating transactions...');
        await executeQuery(`
            INSERT INTO transactions (
                order_id, gateway, transaction_date, account_number,
                amount, status, reference_number, transaction_content,
                received_at
            )
            SELECT 
                t.order_id,
                t.gateway,
                t.transaction_date,
                t.account_number,
                t.amount_in,
                'Success',
                t.reference_number,
                t.body,
                t.received_at
            FROM transactions_old t
        `);

        // Migrate VIP subscriptions
        console.log('Migrating VIP subscriptions...');
        await executeQuery(`
            INSERT INTO vip_subscriptions (
                user_id, plan_id, order_id, start_date,
                expiry_date, status, created_at, updated_at
            )
            SELECT 
                vs.user_id,
                CASE 
                    WHEN vs.plan_type = '1day' THEN '1day'
                    WHEN vs.plan_type = '3days' THEN '3days'
                    WHEN vs.plan_type = '7days' THEN '7days'
                    WHEN vs.plan_type = '30days' THEN '30days'
                END as plan_id,
                o.id,
                vs.created_at,
                vs.expiry_date,
                CASE 
                    WHEN vs.expiry_date > NOW() THEN 'Active'
                    ELSE 'Expired'
                END as status,
                vs.created_at,
                vs.updated_at
            FROM vip_subscriptions_old vs
            JOIN orders_old o ON vs.user_id = o.user_id 
            AND o.payment_status = 'Paid'
            AND o.created_at <= vs.created_at
            ORDER BY o.created_at ASC
        `);

        // Migrate activity logs
        console.log('Migrating activity logs...');
        await executeQuery(`
            INSERT INTO activity_logs (
                user_id, action, entity_type, entity_id,
                details, created_at
            )
            SELECT 
                al.user_id,
                al.action,
                CASE 
                    WHEN al.action LIKE '%VIP%' THEN 'subscription'
                    ELSE 'order'
                END as entity_type,
                COALESCE(o.id, 0) as entity_id,
                al.details,
                al.created_at
            FROM activity_logs_old al
            LEFT JOIN orders_old o ON al.details LIKE CONCAT('%', o.id, '%')
        `);

        console.log('\n✅ Data migration completed successfully!');

    } catch (error) {
        console.error('❌ Error during data migration:', error);
        throw error;
    }
}

// Run migration
migrateData().catch(console.error);