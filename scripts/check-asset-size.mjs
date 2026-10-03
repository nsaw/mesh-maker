#!/usr/bin/env node
// Cloudflare Pages refuses any single file over 25 MiB, and wrangler checks that only at upload, after a
// full CI build. @huggingface/transformers 4.3.0's onnxruntime wasm is 26,861,777 bytes, which is why
// package.json pins 4.2.0 (23,567,050 bytes). This runs after every build so a dependency bump that
// crosses the limit fails locally, not in the deploy step.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 25 * 1024 * 1024;
const DIST = process.argv[2] ?? 'dist';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let files;
try {
  files = walk(DIST);
} catch (error) {
  console.error(`check-asset-size: cannot read ${DIST}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const over = files.map((f) => [f, statSync(f).size]).filter(([, size]) => size > LIMIT);
if (over.length > 0) {
  for (const [f, size] of over) console.error(`check-asset-size: ${f} is ${size} bytes, over the Cloudflare Pages limit of ${LIMIT}`);
  process.exit(1);
}
console.log(`check-asset-size: ${files.length} files, none over ${LIMIT} bytes`);
