// Build pipeline for Open-Source UTH Course Registration Tool
// Updates versioning, validates JS syntax with esbuild, and verifies source-map cleanliness.
// Completely un-obfuscated and transparent for open-source community contributors.
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

console.log('📦 Starting open-source build verification (esbuild syntax & asset validation)...\n');

const filesToProcess = [
    { file: 'public/app.js' },
    { file: 'public/admin-panel.js' },
    { file: 'public/timetable.js' }
];

async function build() {
    // Update version and footer date in HTML files
    updateVersion();
    updateFooterDate();

    for (const item of filesToProcess) {
        const filePath = path.join(__dirname, item.file);

        if (!fs.existsSync(filePath)) {
            console.log(`⚠️  File not found: ${item.file}`);
            continue;
        }

        console.log(`📄 Verifying: ${item.file}`);
        const sourceCode = fs.readFileSync(filePath, 'utf8');
        const originalSize = Buffer.byteLength(sourceCode, 'utf8');

        try {
            // Validate syntax and transform check with esbuild
            await esbuild.transform(sourceCode, {
                target: 'es2020',
                charset: 'utf8',
                sourcemap: false
            });

            // Ensure no source map reference survives
            if (/sourceMappingURL/i.test(sourceCode)) {
                throw new Error('source map reference found in source code — refusing to ship');
            }

            console.log(`   📊 Size: ${(originalSize / 1024).toFixed(2)} KB`);
            console.log(`   ✅ Clean syntax verified (ES2020 compliant, transparent open source)\n`);
        } catch (error) {
            console.error(`❌ Error verifying ${item.file}:`, error.message);
            process.exitCode = 1;
        }
    }

    console.log('✅ Build verification completed! Open-source client code is clean, valid, and source-map free.');
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
