#!/usr/bin/env node
//
// generate.js — rebuilds images/ and packages.js from rstudio/hex-stickers.
//
// The sticker artwork all comes from https://github.com/rstudio/hex-stickers.
// Package websites are resolved from CRAN metadata, with a hand-maintained
// OVERRIDES table for anything CRAN can't answer.
//
// Everything under images/ is generated output. Upstream's full-size PNGs
// (~2500px) are cached under .cache/ and downscaled to TARGET_WIDTH, which is
// all the grid ever draws. Rasterizing here rather than in the browser is what
// keeps the payload small and the first paint fast.
//
// We downscale from upstream's PNGs rather than their SVGs so no SVG rendering
// is needed at all: it avoids ImageMagick's weak built-in SVG renderer, and
// sidesteps the handful of upstream SVGs that are broken or wildly oversized.
//
// Usage:
//   node generate.js                 # sync stickers, keep existing URLs
//   node generate.js --refresh-urls  # also re-resolve URLs already in packages.js
//   node generate.js --force         # re-encode every image, even if current
//   node generate.js --dry-run       # report what would change, write nothing
//
// Requires Node 18+ and ImageMagick (`magick`) + `cwebp` on PATH.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, 'images');
const CACHE_DIR = path.join(ROOT, '.cache', 'stickers');
const PACKAGES_FILE = path.join(ROOT, 'packages.js');

const REPO = 'rstudio/hex-stickers';
const BRANCH = 'main';
const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

// The grid draws a hex at (R - GAP) * sqrt(3) = ~132 CSS px wide, up to ~145
// when hover-scaled. 600px covers that at devicePixelRatio 3 with room spare.
const TARGET_WIDTH = 600;
// Pointy-top hex aspect: width = r*sqrt(3), height = 2r.
const TARGET_HEIGHT = Math.round(TARGET_WIDTH * 2 / Math.sqrt(3));
const FORMAT = 'webp';
const WEBP_QUALITY = 90;

// How many stickers to fetch/encode at once.
const CONCURRENCY = 8;

// Sticker names to skip entirely (no package site to link to).
const SKIP = new Set([]);

// URLs CRAN can't give us: packages that aren't on CRAN, are Python-only, or
// whose DESCRIPTION URL field points somewhere unhelpful.
const OVERRIDES = {
  RStudio: 'https://posit.co/products/open-source/rstudio/',
  air: 'https://posit-dev.github.io/air/',
  ark: 'https://github.com/posit-dev/ark',
  chatlas: 'https://posit-dev.github.io/chatlas/',
  positron: 'https://positron.posit.co',
  quarto: 'https://quarto.org',
  raghilda: 'https://posit-dev.github.io/raghilda/',
  shinyreact: 'https://github.com/posit-dev/shinyreact',
  tabby: 'https://tabby.tidymodels.org',
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const REFRESH_URLS = args.includes('--refresh-urls');
const FORCE = args.includes('--force');

// --- Prerequisites ---

function requireTool(cmd, versionArg) {
  try {
    execFileSync(cmd, [versionArg], { stdio: 'ignore' });
  } catch {
    throw new Error(`${cmd} not found on PATH — install ImageMagick and webp`);
  }
}

// --- Existing packages.js ---

// Read the current packages.js so hand-fixed URLs survive a regeneration.
function readExisting() {
  if (!fs.existsSync(PACKAGES_FILE)) return new Map();
  const src = fs.readFileSync(PACKAGES_FILE, 'utf8');
  const list = eval(`${src}; PACKAGES`);
  return new Map(list.map(p => [p.name, p]));
}

// --- Upstream listing ---

async function fetchJSON(url) {
  const headers = { 'User-Agent': 'posit-hex-grid-generate' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function upstreamStickers() {
  const tree = await fetchJSON(TREE_API);
  return tree.tree
    .map(entry => entry.path)
    .filter(p => p.startsWith('PNG/') && p.endsWith('.png'))
    .map(p => path.basename(p, '.png'))
    .filter(name => !SKIP.has(name))
    .sort();
}

// --- URL resolution ---

// Prefer a package's own documentation site over its GitHub repo.
function pickBestURL(field) {
  const urls = field
    .split(',')
    .map(u => u.trim().replace(/\/$/, ''))
    .filter(u => /^https?:\/\//.test(u));
  if (urls.length === 0) return null;
  return urls.find(u => !u.includes('github.com')) || urls[0];
}

async function cranURL(name) {
  try {
    const res = await fetch(`https://crandb.r-pkg.org/${name}`);
    if (!res.ok) return null;
    const meta = await res.json();
    return meta.URL ? pickBestURL(meta.URL) : null;
  } catch {
    return null;
  }
}

// Fallback for packages that never reached CRAN: look for a repo of the same
// name under a Posit-affiliated org and use its homepage, else the repo itself.
const ORGS = ['posit-dev', 'tidymodels', 'tidyverse', 'r-lib', 'rstudio', 'mlverse'];

async function githubURL(name) {
  for (const org of ORGS) {
    try {
      const repo = await fetchJSON(`https://api.github.com/repos/${org}/${name}`);
      if (repo.homepage) return repo.homepage.replace(/\/$/, '');
      return repo.html_url;
    } catch {
      // Not in this org; try the next one.
    }
  }
  return null;
}

async function resolveURL(name, existing) {
  if (OVERRIDES[name]) return OVERRIDES[name];
  if (!REFRESH_URLS && existing?.url) return existing.url;
  return (await cranURL(name)) || (await githubURL(name)) || existing?.url || null;
}

// --- Image pipeline ---

// Upstream's full-size PNG, cached so re-runs don't re-download ~100MB.
async function cacheSource(name) {
  const dest = path.join(CACHE_DIR, `${name}.png`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;

  const res = await fetch(`${RAW_BASE}/PNG/${name}.png`);
  if (!res.ok) throw new Error(`${res.status} downloading ${name}.png`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// Downscale to draw size. Two steps because cwebp's own resizer is lower
// quality than ImageMagick's on this kind of flat-colour art.
function encode(src, dest) {
  const tmp = `${dest}.tmp.png`;
  execFileSync('magick', [
    src,
    '-resize', `${TARGET_WIDTH}x${TARGET_HEIGHT}`,
    '-strip',
    tmp,
  ]);
  execFileSync('cwebp', [
    '-quiet',
    '-q', String(WEBP_QUALITY),
    '-alpha_q', '100',
    tmp,
    '-o', dest,
  ]);
  fs.unlinkSync(tmp);
}

async function buildImage(name) {
  const relative = `images/${name}.${FORMAT}`;
  const dest = path.join(ROOT, relative);
  if (!FORCE && fs.existsSync(dest)) return { path: relative, built: false };
  if (DRY_RUN) return { path: relative, built: true };

  const src = await cacheSource(name);
  encode(src, dest);
  return { path: relative, built: true };
}

// Run tasks with bounded concurrency, preserving input order in the results.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// --- Main ---

async function main() {
  requireTool('magick', '-version');
  requireTool('cwebp', '-version');

  const existing = readExisting();
  const names = await upstreamStickers();
  console.log(`upstream stickers: ${names.length}`);
  console.log(`already in packages.js: ${existing.size}`);

  if (!DRY_RUN) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  // Resolve URLs first so we never build an image for a sticker we'll omit.
  const urls = await mapLimit(names, CONCURRENCY, name =>
    resolveURL(name, existing.get(name))
  );

  const keep = names.filter((_, i) => urls[i]);
  const unresolved = names.filter((_, i) => !urls[i]);
  const urlFor = new Map(names.map((n, i) => [n, urls[i]]));

  let built = 0;
  const packages = await mapLimit(keep, CONCURRENCY, async name => {
    const image = await buildImage(name);
    if (image.built) built++;
    return { name, path: image.path, url: urlFor.get(name) };
  });

  const added = keep.filter(n => !existing.has(n));
  const removed = [...existing.keys()].filter(n => !keep.includes(n));

  // images/ is generated output, so anything not in the manifest is stale.
  const wanted = new Set(packages.map(p => path.basename(p.path)));
  const stale = fs.existsSync(IMAGES_DIR)
    ? fs.readdirSync(IMAGES_DIR).filter(f => !wanted.has(f))
    : [];
  if (!DRY_RUN) {
    for (const f of stale) fs.unlinkSync(path.join(IMAGES_DIR, f));
  }

  const header = '// Generated by generate.js — do not edit by hand.\n';
  const body = `const PACKAGES = ${JSON.stringify(packages, null, 2)};\n`;
  if (!DRY_RUN) fs.writeFileSync(PACKAGES_FILE, header + body);

  console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}wrote ${packages.length} packages`);
  console.log(`images encoded: ${built} (${TARGET_WIDTH}x${TARGET_HEIGHT} ${FORMAT})`);
  if (added.length) console.log(`added:   ${added.join(', ')}`);
  if (removed.length) console.log(`dropped: ${removed.join(', ')}`);
  if (stale.length) console.log(`removed ${stale.length} stale file(s) from images/`);
  if (unresolved.length) {
    console.log(`\nno URL found (omitted — add to OVERRIDES to include):`);
    console.log(`  ${unresolved.join(', ')}`);
  }
  if (DRY_RUN) console.log('\n--dry-run: no files written');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
