require('dotenv').config();
const db = require('../database/db_connect');

async function testDatabaseConnection() {
    console.log('Testing database connection...\n');
    console.log('Configuration:');
    console.log('- Host:', db.dbConfig.host);
    console.log('- User:', db.dbConfig.user);
    console.log('- Database:', db.dbConfig.database);
    console.log('\n');

    try {
        // Test connection
        const isConnected = await db.testConnection();
        
        if (!isConnected) {
            console.error('❌ Connection failed!');
            process.exit(1);
        }

        console.log('✅ Connection successful!\n');

        // Test query - Get table list
        console.log('Checking database tables...');
        const tables = await db.executeQuery('SHOW TABLES');
        
        console.log('\nFound tables:');
        tables.forEach((table, index) => {
            const tableName = Object.values(table)[0];
            console.log(`${index + 1}. ${tableName}`);
        });

        // Check if required tables exist
        const requiredTables = ['users', 'vip_subscriptions', 'orders', 'transactions', 'activity_logs'];
        const existingTables = tables.map(t => Object.values(t)[0]);
        
        console.log('\nRequired tables status:');
        let allTablesExist = true;
        
        requiredTables.forEach(tableName => {
            const exists = existingTables.includes(tableName);
            console.log(`${exists ? '✅' : '❌'} ${tableName}`);
            if (!exists) allTablesExist = false;
        });

        if (!allTablesExist) {
            console.log('\n⚠️  Some required tables are missing.');
            console.log('Run: mysql -u root -p uth_registration < database/schema.sql');
        } else {
            console.log('\n✅ All required tables exist!');
            
            // Show record counts
            console.log('\nRecord counts:');
            for (const tableName of requiredTables) {
                const [result] = await db.executeQuery(`SELECT COUNT(*) as count FROM ${tableName}`);
                console.log(`- ${tableName}: ${result.count} records`);
            }
        }

        await db.closePool();
        console.log('\n✅ Test completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        await db.closePool();
        process.exit(1);
    }
}

// Run test
testDatabaseConnection();