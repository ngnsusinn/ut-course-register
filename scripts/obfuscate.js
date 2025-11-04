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

// Files to obfuscate
const filesToObfuscate = [
    {
        input: 'public/app.js',
        output: 'public/app.obfuscated.js',
        backup: 'public/app.original.js'
    },
    {
        input: 'public/admin-panel.js',
        output: 'public/admin-panel.obfuscated.js',
        backup: 'public/admin-panel.original.js'
    },
    {
        input: 'public/timetable.js',
        output: 'public/timetable.obfuscated.js',
        backup: 'public/timetable.original.js'
    }
];

// Process each file
filesToObfuscate.forEach(file => {
    try {
        const inputPath = path.join(__dirname, '..', file.input);
        const outputPath = path.join(__dirname, '..', file.output);
        const backupPath = path.join(__dirname, '..', file.backup);
        
        // Check if file exists
        if (!fs.existsSync(inputPath)) {
            console.log(`⚠️  File not found: ${file.input}`);
            return;
        }
        
        console.log(`📄 Processing: ${file.input}`);
        
        // Read original file
        const originalCode = fs.readFileSync(inputPath, 'utf8');
        
        // Create backup of original file
        if (!fs.existsSync(backupPath)) {
            fs.writeFileSync(backupPath, originalCode, 'utf8');
            console.log(`   ✅ Backup created: ${file.backup}`);
        }
        
        // Obfuscate the code
        console.log(`   🔄 Obfuscating...`);
        const obfuscationResult = JavaScriptObfuscator.obfuscate(originalCode, obfuscationOptions);
        
        // Write obfuscated code
        fs.writeFileSync(outputPath, obfuscationResult.getObfuscatedCode(), 'utf8');
        console.log(`   ✅ Obfuscated file created: ${file.output}`);
        
        // Get file sizes
        const originalSize = (fs.statSync(inputPath).size / 1024).toFixed(2);
        const obfuscatedSize = (fs.statSync(outputPath).size / 1024).toFixed(2);
        console.log(`   📊 Original size: ${originalSize} KB`);
        console.log(`   📊 Obfuscated size: ${obfuscatedSize} KB\n`);
        
    } catch (error) {
        console.error(`❌ Error processing ${file.input}:`, error.message);
    }
});

console.log('✅ Obfuscation completed!');
console.log('\n📝 Next steps:');
console.log('1. Update your HTML files to use .obfuscated.js files');
console.log('2. Test the obfuscated files locally');
console.log('3. Deploy to Vercel');
console.log('\n⚠️  Note: Keep the .original.js files as backups (add to .gitignore)');
