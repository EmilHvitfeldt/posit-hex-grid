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

## Adding new packages

1. Drop the new `.svg` (or `.png`) into the `images/` folder.
2. Add an entry to `packages.js`:

```js
{ name: "newpkg", path: "images/newpkg.svg", url: "https://newpkg.example.com" },
```

## File structure

```
hex-grid/
├── index.html        # page shell — canvas, loading overlay, side panel
├── style.css         # full-screen canvas, dark background, panel styles
├── main.js           # canvas rendering, pan/hover/click/panel logic
├── packages.js       # JS global PACKAGES — edit manually to add/update packages
└── images/           # SVG and PNG sticker files (tidyverse.svg used as favicon)
```
