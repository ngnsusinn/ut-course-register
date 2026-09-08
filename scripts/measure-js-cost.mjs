// Measures what the browser actually pays to compile and start executing the shipped
// obfuscated bundles vs their readable sources. Uses a throwaway V8 context.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = [
  ['public/app.original.js', 'readable source'],
  ['public/app.js',          'SHIPPED (obfuscated)'],
  ['public/timetable.original.js', 'readable source'],
  ['public/timetable.js',          'SHIPPED (obfuscated)'],
];

function cost(file) {
  const code = readFileSync(file, 'utf8');
  const size = Buffer.byteLength(code, 'utf8');
  // Compile only: this is the parse+compile phase the browser blocks on for a classic <script>.
  const t0 = process.hrtime.bigint();
  const script = new vm.Script(code, { filename: file });
  const compileMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const heapKB = script.source?.length ? 0 : 0;
  return { size, compileMs };
}

console.log('file'.padEnd(32), 'raw KB'.padStart(9), 'compile ms'.padStart(12), '  note');
console.log('-'.repeat(78));
const out = {};
for (const [f, note] of files) {
  const { size, compileMs } = cost(f);
  out[f] = { size, compileMs };
  console.log(f.padEnd(32), (size / 1024).toFixed(0).padStart(9), compileMs.toFixed(1).padStart(12), `  ${note}`);
}
const aR = out['public/app.original.js'], aS = out['public/app.js'];
const tR = out['public/timetable.original.js'], tS = out['public/timetable.js'];
console.log('\nObfuscation cost paid by every visitor, per page load:');
console.log(`  app.js       raw  ${(aR.size/1024).toFixed(0)} KB -> ${(aS.size/1024).toFixed(0)} KB   (${(aS.size/aR.size).toFixed(1)}x)   compile ${aR.compileMs.toFixed(1)}ms -> ${aS.compileMs.toFixed(1)}ms  (${(aS.compileMs/aR.compileMs).toFixed(1)}x)`);
console.log(`  timetable.js raw  ${(tR.size/1024).toFixed(0)} KB -> ${(tS.size/1024).toFixed(0)} KB   (${(tS.size/tR.size).toFixed(1)}x)   compile ${tR.compileMs.toFixed(1)}ms -> ${tS.compileMs.toFixed(1)}ms  (${(tS.compileMs/tR.compileMs).toFixed(1)}x)`);
console.log(`  TOTAL blocking JS: ${((aR.size+tR.size)/1024).toFixed(0)} KB -> ${((aS.size+tS.size)/1024).toFixed(0)} KB of source to parse`);
