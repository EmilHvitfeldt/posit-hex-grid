# hex-grid

An infinite panning hex grid of R package stickers. Drag or scroll in any direction. Click a hex to open its package website in a side panel.

## Controls

| Action | Effect |
|---|---|
| Drag | Pan |
| Two-finger scroll / trackpad | Pan |
| Click a hex | Open package website in side panel |
| ↗ button | Open current package in new tab |
| ✕ button / Escape | Close side panel |

## Settings menu

Press **M** to open it. Every setting is mirrored into the URL, so the address bar (or the **Copy share link** button) is a shareable link. **Reset to defaults** restores everything.

| Setting | URL key | Notes |
|---|---|---|
| Hex size | `size` | 40 to 250 (%) |
| Gap | `gap` | 0 to 24 px between hexes |
| Background | `bg` | hex color without the `#` |
| Scroll speed | `scroll` | 25 to 300 (%), wheel and trackpad |
| Momentum | `momentum` | 0 to 95, how long a drag glides (0 is off) |
| Auto drift | `drift`, `dspeed` | direction (`n`, `ne`, `e`, `se`, `s`, `sw`, `w`, `nw`) and speed in px/s; picking a direction turns drift on |
| Show each sticker once | `unique=1` | |
| Stickers | `off` or `on` | comma-separated package names; group chips toggle whole families |

## Where the stickers come from

All artwork is from [rstudio/hex-stickers](https://github.com/rstudio/hex-stickers) (the `PNG/` directory). Package websites are resolved from CRAN metadata via [crandb](https://crandb.r-pkg.org), falling back to the GitHub repo homepage, with a hand-maintained `OVERRIDES` table in `generate.js` for packages CRAN can't answer for.

## Regenerating

Both `images/` and `packages.js` are generated output. Rather than editing them, re-run the generator, which picks up any stickers added upstream:

```sh
node generate.js                 # sync stickers, keep existing URLs
node generate.js --dry-run       # report what would change, write nothing
node generate.js --refresh-urls  # also re-resolve URLs already in packages.js
node generate.js --force         # re-encode every image, even if current
```

Needs Node 18+ and ImageMagick (`magick`) plus `cwebp` on PATH. Set `GITHUB_TOKEN` to avoid GitHub API rate limits.

Upstream's full-size PNGs are downloaded once into `.cache/` (gitignored, ~100MB) and downscaled to 600×693 WebP, which is all the grid ever draws. That keeps `images/` at ~5MB instead of ~56MB, so the whole grid loads in one go. Re-runs only encode stickers that aren't already built; `--force` redoes them all after changing `TARGET_WIDTH` or `WEBP_QUALITY`.

Anything in `images/` that isn't in the manifest is deleted as stale, so don't put hand-made files there.

Menu groups (Tidyverse, Tidymodels, and so on) come from the `GROUPS` table in `generate.js`. New stickers land in "Other" and are reported on each run, so add them to a group there.

If a sticker has no resolvable URL, it's reported and omitted from the grid. Add an entry to `OVERRIDES` in `generate.js` to include it.

## Social card

`social-card.png` is the 1200×630 link preview referenced by the `og:image` and `twitter:image` tags in `index.html`. Rebuild it after the sticker set changes with:

```sh
node social-card.js
```

Needs ImageMagick (`magick`). The tags use absolute URLs on GitHub Pages, so update them if the site moves.

## File structure

```
hex-grid/
├── index.html        # page shell — canvas, loading overlay, side panel
├── style.css         # full-screen canvas, dark background, panel styles
├── main.js           # canvas rendering, pan/hover/click/panel logic
├── generate.js       # rebuilds images/ and packages.js from rstudio/hex-stickers
├── social-card.js    # builds social-card.png from the stickers in images/
├── social-card.png   # 1200×630 link preview image (og:image)
├── packages.js       # JS global PACKAGES — generated, do not edit by hand
├── images/           # generated 600×693 WebP stickers (tidyverse.webp used as favicon)
└── .cache/           # gitignored full-size upstream PNGs, so re-runs skip the download
```
