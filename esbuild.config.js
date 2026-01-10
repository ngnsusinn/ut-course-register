const esbuild = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

console.log('📦 Starting build process (minify + obfuscate)...\n');

// Obfuscation settings
const obfuscationOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
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
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

// Files to process
const filesToProcess = [
    { input: 'public/app.js', backup: 'public/app.original.js' },
    { input: 'public/admin-panel.js', backup: 'public/admin-panel.original.js' },
    { input: 'public/timetable.js', backup: 'public/timetable.original.js' }
];

async function build() {
    // Update footer date in HTML files
    updateFooterDate();

    for (const file of filesToProcess) {
        const inputPath = path.join(__dirname, file.input);
        const backupPath = path.join(__dirname, file.backup);

        if (!fs.existsSync(inputPath)) {
            console.log(`⚠️  File not found: ${file.input}`);
            continue;
        }

        console.log(`📄 Processing: ${file.input}`);

        // Read original/backup file
        let sourceCode;
        if (fs.existsSync(backupPath)) {
            sourceCode = fs.readFileSync(backupPath, 'utf8');
            console.log(`   📦 Using backup: ${file.backup}`);
        } else {
            sourceCode = fs.readFileSync(inputPath, 'utf8');
            fs.writeFileSync(backupPath, sourceCode, 'utf8');
            console.log(`   ✅ Backup created: ${file.backup}`);
        }

        const originalSize = Buffer.byteLength(sourceCode, 'utf8');

        try {
            // Step 1: Minify with esbuild
            const minified = await esbuild.transform(sourceCode, {
                minify: true,
                target: 'es2020',
                charset: 'utf8'
            });

            // Step 2: Obfuscate
            const obfuscated = JavaScriptObfuscator.obfuscate(minified.code, obfuscationOptions);
            const finalCode = obfuscated.getObfuscatedCode();

            // Write final code
            fs.writeFileSync(inputPath, finalCode, 'utf8');

            const finalSize = Buffer.byteLength(finalCode, 'utf8');
            const minifiedSize = Buffer.byteLength(minified.code, 'utf8');

            console.log(`   📊 Original: ${(originalSize / 1024).toFixed(2)} KB`);
            console.log(`   📊 Minified: ${(minifiedSize / 1024).toFixed(2)} KB`);
            console.log(`   📊 Obfuscated: ${(finalSize / 1024).toFixed(2)} KB`);
            console.log(`   🎉 Minify reduced: ${((1 - minifiedSize / originalSize) * 100).toFixed(1)}%\n`);

        } catch (error) {
            console.error(`❌ Error processing ${file.input}:`, error.message);
        }
    }

    console.log('✅ Build completed! Files are minified and obfuscated.');
}

// Update "Cập nhật lần cuối" in HTML footer
function updateFooterDate() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    const htmlFiles = ['public/index.html'];
    const pattern = /Cập nhật lần cuối: \d{1,2}\/\d{1,2}\/\d{4}/g;
    const replacement = `Cập nhật lần cuối: ${dateStr}`;

    htmlFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf8');
            if (pattern.test(content)) {
                content = content.replace(pattern, replacement);
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`📅 Updated footer date in ${file}: ${dateStr}\n`);
            }
        }
    });
}

build().catch(console.error);

