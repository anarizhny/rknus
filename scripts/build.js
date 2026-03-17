#!/usr/bin/env node
// scripts/build.js
// Копирует файлы расширения в dist/ и (опционально) создаёт zip-архив.
// Firefox build: copy manifest.firefox.json as manifest.json

import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

const shouldZip = process.argv.includes('--zip');
const isFirefox = process.argv.includes('--firefox');

// Файлы и директории для копирования в dist/
const COPY_ITEMS = [
  'manifest.json',
  'background.js',
  'popup',
  'options',
  'content',
  'lib',
  'assets',
  '_locales',
];

// --- Очистка ---
if (existsSync(DIST)) {
  rmSync(DIST, { recursive: true, force: true });
}
mkdirSync(DIST, { recursive: true });

console.log('Building extension into dist/ ...');

// --- Копирование ---
for (const item of COPY_ITEMS) {
  const src = resolve(ROOT, item);
  const dest = resolve(DIST, item);

  if (!existsSync(src)) {
    console.warn(`  SKIP (not found): ${item}`);
    continue;
  }

  cpSync(src, dest, { recursive: true });
  console.log(`  COPY: ${item}`);
}

// --- Firefox: подменяем manifest ---
if (isFirefox) {
  const firefoxManifest = resolve(ROOT, 'manifest.firefox.json');
  if (existsSync(firefoxManifest)) {
    cpSync(firefoxManifest, resolve(DIST, 'manifest.json'));
    console.log('  COPY: manifest.firefox.json -> manifest.json (Firefox)');
  } else {
    console.error('ERROR: manifest.firefox.json not found');
    process.exit(1);
  }
}

console.log('Build complete.');

// --- ZIP ---
if (shouldZip) {
  const zipPath = resolve(ROOT, 'dist.zip');
  if (existsSync(zipPath)) {
    rmSync(zipPath);
  }

  console.log('Creating dist.zip ...');

  // Используем встроенный Node.js zip (через child_process)
  // На Windows можно использовать PowerShell, на Linux/Mac — zip
  const isWin = process.platform === 'win32';

  try {
    if (isWin) {
      execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zipPath}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`cd "${DIST}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
    }
    console.log(`ZIP created: dist.zip`);
  } catch (err) {
    console.error('Failed to create zip:', err.message);
    process.exit(1);
  }
}
