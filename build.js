#!/usr/bin/env node
// Reassembles index.html from the partials in sections/, in page order.
// Run with: node build.js
const fs = require('fs');
const path = require('path');

const SECTIONS_DIR = path.join(__dirname, 'sections');
const OUTPUT_FILE = path.join(__dirname, 'index.html');

const order = [
  'head.html',
  'header.html',
  'stats.html',
  'steps.html',
  'team.html',
  'pricing.html',
  'tail.html',
];

const output = order
  .map((file) => fs.readFileSync(path.join(SECTIONS_DIR, file), 'utf8'))
  .join('');

fs.writeFileSync(OUTPUT_FILE, output);
console.log(`Wrote ${OUTPUT_FILE} from ${order.length} section(s).`);
