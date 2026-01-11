const esbuild = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

console.log('📦 Starting build process (minify + obfuscate)...\n');

// Obfuscation settings
const obfuscationOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1, // Tăng từ 0.75 lên 1 (100%)
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.5, // Tăng từ 0.4 lên 0.5
    debugProtection: true, // Bật để chống debug (lưu ý: có thể gây khó chịu khi dev)
    debugProtectionInterval: 500, // Kiểm tra debug mỗi 2 giây
    disableConsoleOutput: true, // Tắt console.log trong production
    domainLock: [], // Thêm domain nếu muốn lock code chỉ chạy trên domain cụ thể
    identifierNamesGenerator: 'mangled-shuffled', // Mạnh hơn 'hexadecimal'
    identifiersPrefix: '',
    numbersToExpressions: true,
    renameGlobals: true, // Bật để đổi tên global variables
    renameProperties: false, // Cẩn thận với option này, có thể break code
    rotateStringArray: true,
    selfDefending: true,
    shuffleStringArray: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 5, // Giảm từ 10 xuống 5 để chia nhỏ hơn
    stringArray: true,
    stringArrayCallsTransform: true, // Thêm - làm rối cách gọi string array
    stringArrayCallsTransformThreshold: 0.75,
    stringArrayEncoding: ['rc4'], // Đổi từ 'base64' sang 'rc4' (mạnh hơn)
    stringArrayIndexesType: ['hexadecimal-number', 'hexadecimal-numeric-string'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2, // Thêm wrappers
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 1, // Tăng lên 1 (100%)
    transformObjectKeys: true,
    unicodeEscapeSequence: true // Bật để chuyển đổi sang unicode
};

// Files to process
const filesToProcess = [
    { input: 'public/app.js', backup: 'public/app.original.js' },
    { input: 'public/admin-panel.js', backup: 'public/admin-panel.original.js' },
    { input: 'public/timetable.js', backup: 'public/timetable.original.js' }
];

async function build() {
    // Update version and footer date in HTML files
    updateVersion();
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

// Get ISO week number
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Update version: v{year}.{week}.{dayOfWeek}
function updateVersion() {
    const now = new Date();
    const year = now.getFullYear();
    const week = getWeekNumber(now);
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday

    const newVersion = `v${year}.${week}.${dayOfWeek}`;

    const htmlFiles = ['public/index.html'];
    const pattern = /v\d{4}\.\d{1,2}\.\d{1}/g;

    htmlFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf8');
            if (pattern.test(content)) {
                content = content.replace(pattern, newVersion);
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`🏷️  Updated version in ${file}: ${newVersion}`);
            }
        }
    });
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


