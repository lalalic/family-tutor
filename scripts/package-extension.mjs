import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'skills/family-tutor/extension');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const outDir = path.join(root, 'dist');
const name = `family-tutor-extension-${manifest.version}.zip`;
const output = path.join(outDir, name);
const stableTime = new Date('2020-01-01T00:00:00Z');

function filesUnder(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      if (entry.name === '.DS_Store' || (prefix === '' && entry.name === 'test')) return [];
      const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name;
      return entry.isDirectory()
        ? filesUnder(path.join(dir, entry.name), relative)
        : [relative];
    });
}

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(output, { force: true });

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'family-tutor-extension-package-'));
try {
  const entries = filesUnder(source);
  for (const relative of entries) {
    const src = path.join(source, ...relative.split('/'));
    const dest = path.join(staging, ...relative.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o644);
    fs.utimesSync(dest, stableTime, stableTime);
  }

  execFileSync('/usr/bin/zip', ['-X', '-q', output, ...entries], {
    cwd: staging,
    env: { ...process.env, TZ: 'UTC' },
  });
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

const bytes = fs.readFileSync(output);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const siteDownloadDir = path.join(root, 'site', 'downloads');
const siteDownload = path.join(siteDownloadDir, 'family-tutor-extension.zip');
const versionedSiteDownload = path.join(siteDownloadDir, `family-tutor-extension-${manifest.version}.zip`);
fs.mkdirSync(siteDownloadDir, { recursive: true });
fs.copyFileSync(output, siteDownload);
fs.copyFileSync(output, versionedSiteDownload);

console.log(JSON.stringify({
  version: manifest.version,
  file: path.relative(root, output),
  siteFile: path.relative(root, siteDownload),
  versionedSiteFile: path.relative(root, versionedSiteDownload),
  bytes: bytes.length,
  sha256,
}, null, 2));
