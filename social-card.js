#!/usr/bin/env node
//
// social-card.js: builds social-card.png, the 1200x630 link-preview image
// referenced by the og:image / twitter:image tags in index.html.
//
// It tiles a honeycomb of stickers from images/ over the page's dark
// background. The card lives at the repo root because generate.js deletes
// anything in images/ that isn't a sticker.
//
// Usage: node social-card.js
// Requires Node 18+ and ImageMagick (`magick`) on PATH.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'social-card.png');

const WIDTH = 1200;
const HEIGHT = 630;
const BACKGROUND = '#111';

// Pointy-top hex cell: width = r*sqrt(3), height = 2r, rows interlock at 3/4 height.
const CELL_W = 150;
const CELL_H = Math.round(CELL_W * 2 / Math.sqrt(3));
const ROW_STEP = Math.round(CELL_H * 0.75);
const GAP = 8;

// Stickers to feature first; the rest of the grid is filled from packages.js.
const FEATURED = [
  'tidyverse', 'ggplot2', 'dplyr', 'shiny', 'quarto', 'positron', 'RStudio',
  'tidymodels', 'purrr', 'tidyr', 'readr', 'stringr', 'forcats', 'tibble',
  'usethis', 'devtools', 'testthat', 'pkgdown', 'rmarkdown', 'knitr',
];

const src = fs.readFileSync(path.join(ROOT, 'packages.js'), 'utf8');
const packages = eval(`${src}; PACKAGES`);
const byName = new Map(packages.map(p => [p.name, p.path]));

const ordered = [
  ...FEATURED.filter(n => byName.has(n)),
  ...packages.map(p => p.name).filter(n => !FEATURED.includes(n)),
];

const args = ['-size', `${WIDTH}x${HEIGHT}`, `xc:${BACKGROUND}`];
const drawW = CELL_W - GAP;
const drawH = Math.round(drawW * 2 / Math.sqrt(3));

let i = 0;
for (let row = -1; row * ROW_STEP < HEIGHT; row++) {
  const offset = Math.abs(row) % 2 ? CELL_W / 2 : 0;
  for (let col = -1; col * CELL_W + offset < WIDTH; col++) {
    const name = ordered[i++ % ordered.length];
    const x = Math.round(col * CELL_W + offset + (CELL_W - drawW) / 2);
    const y = Math.round(row * ROW_STEP + (CELL_H - drawH) / 2);
    args.push(
      '(', path.join(ROOT, byName.get(name)), '-resize', `${drawW}x${drawH}`, ')',
      '-geometry', `+${x}+${y}`, '-composite'
    );
  }
}

args.push('-strip', OUT);
execFileSync('magick', args);
console.log(`wrote ${path.relative(ROOT, OUT)} (${WIDTH}x${HEIGHT}, ${i} stickers)`);
