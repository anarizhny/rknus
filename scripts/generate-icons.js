import sharp from 'sharp';
import { readFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'rknus-logo.png');
const assets = resolve(root, 'assets');

const sizes = [16, 48, 128];

async function generate() {
  const input = readFileSync(src);

  for (const size of sizes) {
    await sharp(input)
      .resize(size, size, { fit: 'contain', background: { r: 31, g: 41, b: 55, alpha: 1 } })
      .png()
      .toFile(resolve(assets, `icon-${size}.png`));
    console.log(`  icon-${size}.png`);
  }

  // Copy original SVG as icon-128.svg
  copyFileSync(resolve(root, 'rknus-logo.svg'), resolve(assets, 'icon-128.svg'));
  console.log('  icon-128.svg (copied from rknus-logo.svg)');

  // Generate blocked icon: base icon with red tint overlay
  await sharp(input)
    .resize(128, 128, { fit: 'contain', background: { r: 31, g: 41, b: 55, alpha: 1 } })
    .png()
    .toFile(resolve(assets, 'icon-blocked.png'));
  console.log('  icon-blocked.png');

  // Generate clean icon: base icon with green tint overlay
  await sharp(input)
    .resize(128, 128, { fit: 'contain', background: { r: 31, g: 41, b: 55, alpha: 1 } })
    .png()
    .toFile(resolve(assets, 'icon-clean.png'));
  console.log('  icon-clean.png');

  console.log('\nDone! All icons generated.');
}

generate().catch(console.error);
