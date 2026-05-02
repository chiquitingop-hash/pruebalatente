import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.vite') continue;
      walk(p, acc);
    } else if (/\.(js|jsx)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const files = walk(process.argv[2]);
let failed = 0;
for (const f of files) {
  try {
    const src = fs.readFileSync(f, 'utf8');
    parse(src, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'dynamicImport', 'optionalChaining', 'nullishCoalescingOperator'],
      errorRecovery: false,
    });
  } catch (e) {
    failed++;
    console.log(`FAIL ${f}\n  ${e.message}`);
  }
}
console.log(`\n${failed === 0 ? 'OK' : 'FAILED'}: ${files.length} files, ${failed} errors`);
process.exit(failed === 0 ? 0 : 1);
