// Build: public/*.original.js  ->  public/*.js  (minify + obfuscate, no source maps)
// Pipeline per file:
//   1. esbuild minify   — whitespace/identifiers, target es2020
//   2. obfuscator       — BALANCED settings (string-array + light control-flow flattening).
//      The old config (deadCodeInjection + 100% flattening + rc4) multiplied every file ~7x;
//      this one stays within ~2-3x while still hiding names, strings and structure.
//   3. source-map kill  — explicit `sourcemap: false` everywhere + defensive strip, and
//      .vercelignore blocks *.map from ever reaching the deployed output.
// Code splitting: timetable.js is NOT loaded eagerly by index.html any more — it is fetched
// on demand (first click / idle preload). admin-panel.js lives only on /admin. See index.html.
import esbuild from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

console.log('📦 Starting build process (minify + obfuscate)...\n');

// Obfuscation settings — deliberately moderate; heavy options were a size/perf trap.
const obfuscationOptions = (prefix, seed) => ({
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.35,
    deadCodeInjection: false,          // was 0.5 — pure bloat, no real protection
    debugProtection: false,            // hostile UX (devtools loops)
    disableConsoleOutput: false,       // keep logs available for production debugging
    domainLock: [],
    identifierNamesGenerator: 'mangled',
    identifiersPrefix: prefix,         // unique per file to avoid cross-chunk name clashes
    numbersToExpressions: false,
    renameGlobals: false,              // shared browser globals must stay intact
    renameProperties: false,           // would break API/DOM property names
    seed,                              // deterministic output for the same source
    selfDefending: false,              // breaks against re-minification and is trivially defeated
    shuffleStringArray: true,
    simplify: true,
    splitStrings: false,               // was 5-char chunks — big size penalty
    stringArray: true,                 // hide URLs/messages behind an encoded array + decoder
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.5,
    stringArrayEncoding: ['base64'],   // rc4 costs CPU on every page view
    stringArrayThreshold: 0.65,
    transformObjectKeys: false,        // payload fields (action, token...) must not be renamed
    unicodeEscapeSequence: false       // utf-8 Vietnamese stays readable in transit, no bloat
});

// Files to process: the .original.js backup holds the readable source; it is the input.
const filesToProcess = [
    { input: 'public/app.js', backup: 'public/app.original.js', prefix: '_a', seed: 20260913 },
    { input: 'public/admin-panel.js', backup: 'public/admin-panel.original.js', prefix: '_b', seed: 20260914 },
    { input: 'public/timetable.js', backup: 'public/timetable.original.js', prefix: '_c', seed: 20260915 }
];

const stripSourceMapReferences = (code) =>
    code.replace(/\/\/[#@]\s*sourceMappingURL\s*=\s*\S+/g, '');

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
            // Step 1: Minify with esbuild (never emit source maps)
            const minified = await esbuild.transform(sourceCode, {
                minify: true,
                target: 'es2020',
                charset: 'utf8',
                sourcemap: false
            });
            const minSize = Buffer.byteLength(minified.code, 'utf8');

            // Step 2: Obfuscate the minified code
            const obfuscated = JavaScriptObfuscator.obfuscate(
                stripSourceMapReferences(minified.code),
                obfuscationOptions(file.prefix, file.seed)
            ).getObfuscatedCode();

            // Step 3: Belt-and-braces — production must never reference a .map
            const finalCode = stripSourceMapReferences(obfuscated);
            if (/sourceMappingURL/i.test(finalCode)) {
                throw new Error('source map reference survived the strip — refusing to ship');
            }

            fs.writeFileSync(inputPath, finalCode, 'utf8');

            const finalSize = Buffer.byteLength(finalCode, 'utf8');

            console.log(`   📊 Original: ${(originalSize / 1024).toFixed(2)} KB`);
            console.log(`   📊 Minified: ${(minSize / 1024).toFixed(2)} KB`);
            console.log(`   📊 Obfuscated: ${(finalSize / 1024).toFixed(2)} KB`);
            console.log(`   🎉 Final vs original: ${((1 - finalSize / originalSize) * 100).toFixed(1)}%\n`);

        } catch (error) {
            console.error(`❌ Error processing ${file.input}:`, error.message);
            process.exitCode = 1;
        }
    }

    console.log('✅ Build completed! Files are minified + obfuscated, source-map free.');
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
