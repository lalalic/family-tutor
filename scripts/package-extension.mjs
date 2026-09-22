import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'skills/family-tutor/extension');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const outDir = path.join(root, 'dist');
const name = `family-tutor-extension-${manifest.version}.zip`;
const output = path.join(outDir, name);
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(output, { force: true });
const entries = fs.readdirSync(source).filter((entry) => entry !== 'test' && entry !== '.DS_Store').sort();
execFileSync('/usr/bin/zip', ['-X', '-q', '-r', output, ...entries], { cwd: source });
const bytes = fs.readFileSync(output);
const sha256 = createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({ version: manifest.version, file: path.relative(root, output), bytes: bytes.length, sha256 }, null, 2));
