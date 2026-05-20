# hex-grid

An infinite panning hex grid of R package stickers. Drag or scroll in any direction. Click a hex to open its package website.

## Adding new packages

1. Drop the new `.svg` into the `images/` folder.
2. Add an entry to `packages.js`:

```js
{ name: "newpkg", path: "images/newpkg.svg", url: "https://newpkg.example.com" },
```

## File structure

```
hex-grid/
├── index.html        # page shell — just a <canvas>
├── style.css         # full-screen canvas, dark background
├── main.js           # canvas rendering, pan/hover/click logic
├── packages.js       # JS global PACKAGES — edit manually to add/update packages
└── images/           # SVG sticker files
```

## Controls

| Action | Effect |
|---|---|
| Drag | Pan |
| Two-finger scroll / trackpad | Pan |
| Click a hex | Open package website in new tab |
