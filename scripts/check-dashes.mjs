#!/usr/bin/env node
// Fails (exit code 1) if any text file in the repo contains an em dash (U+2014) or an en dash (U+2013).
// Usage: node scripts/check-dashes.mjs [rootDir]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'out', '.next', '.turbo']);
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.ts', '.tsx', '.jsx', '.json', '.rs', '.toml', '.html', '.css', '.svg', '.yml', '.yaml', '.txt', '.sh', '']);
const BAD = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');

let hits = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    const file = path.join(dir, entry.name);
    if (!TEXT_EXT.has(path.extname(entry.name))) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (BAD.test(line)) {
        hits++;
        console.log(`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

walk(root);
if (hits > 0) {
  console.error(`\nFound ${hits} line(s) with an em dash or en dash. Replace them with a comma, colon, parentheses, "to", or a new sentence.`);
  process.exit(1);
}
console.log('OK: no em dash or en dash found.');
