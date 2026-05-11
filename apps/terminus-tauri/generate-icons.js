#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Try to use system tools or npm sharp
const svgFile = path.join(__dirname, 'icons/terminus-icon.svg');

console.log('Generating icons from SVG...');

// Try convert command from ImageMagick
try {
  const sizes = [
    { size: 32, name: '32x32' },
    { size: 64, name: '128x128@2x' },  // 2x resolution
    { size: 128, name: '128x128' }
  ];

  for (const { size, name } of sizes) {
    const output = path.join(__dirname, `icons/${name}.png`);
    try {
      execSync(`convert -background none -size ${size}x${size} ${svgFile} -resize ${size}x${size} ${output}`, {
        stdio: 'pipe'
      });
      console.log(`✓ Generated ${name}.png`);
    } catch (err) {
      console.log(`⚠ Could not generate ${name}.png with convert`);
    }
  }
} catch (e) {
  console.log('ImageMagick not available. Trying alternative...\n');
  
  // Try with npx and another tool
  try {
    execSync('npx svg2img --version 2>&1 > /dev/null', { stdio: 'pipe' });
    console.log('Using svg2img...');
    // Usage: npx svg2img input.svg -o output.png -w 128 -h 128
  } catch {
    console.log('\n❌ No SVG to PNG converter found.');
    console.log('Install one of these:\n');
    console.log('  Option 1: brew install imagemagick');
    console.log('  Option 2: npm install -g svg2img');
    console.log('  Option 3: Use online converter at https://convertio.co/svg-png/\n');
    console.log('For now, keep using existing PNG icons.');
  }
}
