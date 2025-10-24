import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { testConnection, executeQuery, closePool } from '../database/db_connect.js';

dotenv.config();

async function runMigration() {
    console.log('🚀 Starting database migration...\n');

    try {
        // Read schema file
        const schemaPath = path.join(process.cwd(), 'database', 'schema.sql');
        
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
        const isConnected = await testConnection();
        if (!isConnected) {
            throw new Error('Cannot connect to database');
        }

        // Execute queries
        console.log('Executing migrations...\n');
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            try {
                await executeQuery(query);
                
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
        const tables = await executeQuery('SHOW TABLES');
        console.log(`\nFound ${tables.length} tables:`);
        tables.forEach((table, index) => {
            const tableName = Object.values(table)[0];
            console.log(`${index + 1}. ${tableName}`);
        });

        await closePool();
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        await closePool();
        process.exit(1);
    }
}

// Run migration
console.log('Database Migration Tool');
console.log('======================\n');
console.log('Configuration:');
console.log('- Host:', process.env.DB_HOST || 'localhost');
console.log('- Database:', process.env.DB_NAME || 'uth_registration');
console.log('- User:', process.env.DB_USER || 'your_db_user');
console.log('\n');

runMigration();