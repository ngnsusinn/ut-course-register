const fs = require('fs');
const path = require('path');

console.log('🔓 Restoring original JavaScript files...\n');

// Files to restore
const filesToRestore = [
    {
        backup: 'public/app.original.js',
        target: 'public/app.js'
    },
    {
        backup: 'public/admin-panel.original.js',
        target: 'public/admin-panel.js'
    },
    {
        backup: 'public/timetable.original.js',
        target: 'public/timetable.js'
    }
];

// Restore each file
filesToRestore.forEach(file => {
    try {
        const backupPath = path.join(__dirname, '..', file.backup);
        const targetPath = path.join(__dirname, '..', file.target);
        
        // Check if backup exists
        if (!fs.existsSync(backupPath)) {
            console.log(`⚠️  Backup not found: ${file.backup}`);
            return;
        }
        
        console.log(`📄 Restoring: ${file.target}`);
        
        // Copy backup to target
        const backupContent = fs.readFileSync(backupPath, 'utf8');
        fs.writeFileSync(targetPath, backupContent, 'utf8');
        
        console.log(`   ✅ Restored from: ${file.backup}\n`);
        
    } catch (error) {
        console.error(`❌ Error restoring ${file.target}:`, error.message);
    }
});

console.log('✅ Restoration completed!');
console.log('\n📝 Original files have been restored.');
console.log('You can now continue development with readable code.');
