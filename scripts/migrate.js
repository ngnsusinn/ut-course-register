require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../database/db_connect');

async function runMigration() {
    console.log('🚀 Starting database migration...\n');

    try {
        // Read schema file
        const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
        
        if (!fs.existsSync(schemaPath)) {
            throw new Error('Schema file not found: database/schema.sql');
        }

        console.log('📖 Reading schema file...');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // Split queries by semicolon
        const queries = schema
            .split(';')
            .map(q => q.trim())
            .filter(q => q.length > 0 && !q.startsWith('--'));

        console.log(`Found ${queries.length} SQL statements\n`);

        // Test connection
        const isConnected = await db.testConnection();
        if (!isConnected) {
            throw new Error('Cannot connect to database');
        }

        // Execute queries
        console.log('Executing migrations...\n');
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            try {
                await db.executeQuery(query);
                
                // Extract table name for better logging
                const tableMatch = query.match(/CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?/i);
                if (tableMatch) {
                    console.log(`✅ Created table: ${tableMatch[1]}`);
                } else {
                    console.log(`✅ Executed statement ${i + 1}`);
                }
            } catch (error) {
                console.error(`❌ Error in statement ${i + 1}:`, error.message);
                throw error;
            }
        }

        console.log('\n🎉 Migration completed successfully!');
        
        // Verify tables
        console.log('\nVerifying tables...');
        const tables = await db.executeQuery('SHOW TABLES');
        console.log(`\nFound ${tables.length} tables:`);
        tables.forEach((table, index) => {
            const tableName = Object.values(table)[0];
            console.log(`${index + 1}. ${tableName}`);
        });

        await db.closePool();
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        await db.closePool();
        process.exit(1);
    }
}

// Run migration
console.log('Database Migration Tool');
console.log('======================\n');
console.log('Configuration:');
console.log('- Host:', db.dbConfig.host);
console.log('- Database:', db.dbConfig.database);
console.log('- User:', db.dbConfig.user);
console.log('\n');

runMigration();