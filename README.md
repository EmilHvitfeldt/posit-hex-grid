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

If a sticker has no resolvable URL, it's reported and omitted from the grid. Add an entry to `OVERRIDES` in `generate.js` to include it.

## File structure

```
hex-grid/
├── index.html        # page shell — canvas, loading overlay, side panel
├── style.css         # full-screen canvas, dark background, panel styles
├── main.js           # canvas rendering, pan/hover/click/panel logic
├── generate.js       # rebuilds images/ and packages.js from rstudio/hex-stickers
├── packages.js       # JS global PACKAGES — generated, do not edit by hand
├── images/           # generated 600×693 WebP stickers (tidyverse.webp used as favicon)
└── .cache/           # gitignored full-size upstream PNGs, so re-runs skip the download
```
