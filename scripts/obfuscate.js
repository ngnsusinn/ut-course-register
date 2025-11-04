const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

console.log('🔒 Starting JavaScript obfuscation...\n');

// Configuration for obfuscation
const obfuscationOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    debugProtectionInterval: 0,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: true,
    shuffleStringArray: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

// Files to obfuscate (will backup original and replace with obfuscated)
const filesToObfuscate = [
    {
        input: 'public/app.js',
        backup: 'public/app.original.js'
    },
    {
        input: 'public/admin-panel.js',
        backup: 'public/admin-panel.original.js'
    },
    {
        input: 'public/timetable.js',
        backup: 'public/timetable.original.js'
    }
];

// Process each file
filesToObfuscate.forEach(file => {
    try {
        const inputPath = path.join(__dirname, '..', file.input);
        const backupPath = path.join(__dirname, '..', file.backup);
        
        // Check if file exists
        if (!fs.existsSync(inputPath)) {
            console.log(`⚠️  File not found: ${file.input}`);
            return;
        }
        
        console.log(`📄 Processing: ${file.input}`);
        
        // Read original file
        const originalCode = fs.readFileSync(inputPath, 'utf8');
        
        // Create backup of original file (only once)
        if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, originalCode, 'utf8');
            console.log(`   ✅ Backup created: ${file.backup}`);
        } else {
            console.log(`   📦 Backup exists: ${file.backup}`);
        }
        
        // Obfuscate the code
        console.log(`   🔄 Obfuscating...`);
        const obfuscationResult = JavaScriptObfuscator.obfuscate(originalCode, obfuscationOptions);
        
        // Overwrite original file with obfuscated code
        fs.writeFileSync(inputPath, obfuscationResult.getObfuscatedCode(), 'utf8');
        console.log(`   ✅ File obfuscated and replaced: ${file.input}`);
        
        // Get file sizes
        const originalSize = (fs.statSync(backupPath).size / 1024).toFixed(2);
        const obfuscatedSize = (fs.statSync(inputPath).size / 1024).toFixed(2);
        console.log(`   📊 Original size: ${originalSize} KB`);
        console.log(`   📊 Obfuscated size: ${obfuscatedSize} KB\n`);
        
    } catch (error) {
        console.error(`❌ Error processing ${file.input}:`, error.message);
    }
});

console.log('✅ Obfuscation completed!');
console.log('\n📝 Important:');
console.log('- Original files backed up as *.original.js');
console.log('- Main JS files now contain obfuscated code');
console.log('- Deploy to production normally');
console.log('\n⚠️  To restore original files, run: npm run restore');
