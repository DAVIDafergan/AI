# DLP Shield Extension Icons

The manifest requires three PNG icon files in this directory:

| File | Size |
|------|------|
| `icon16.png` | 16×16 px |
| `icon48.png` | 48×48 px |
| `icon128.png` | 128×128 px |

## How to generate icons

You can create a simple shield icon using any of the following methods:

### Option 1 – Online SVG-to-PNG converter

1. Open [svgtopng.com](https://svgtopng.com/) or [cloudconvert.com](https://cloudconvert.com/svg-to-png).
2. Paste the following SVG (a simple blue shield):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M50 5 L90 20 L90 55 Q90 80 50 95 Q10 80 10 55 L10 20 Z"
        fill="#2563eb" stroke="#1e40af" stroke-width="3"/>
  <text x="50" y="62" text-anchor="middle" fill="white"
        font-size="40" font-family="Arial">🛡</text>
</svg>
```

3. Export at 16 px, 48 px, and 128 px and save as `icon16.png`, `icon48.png`, `icon128.png`.

### Option 2 – Use any image editor (GIMP, Figma, Canva)

Create a square image with a shield shape on a dark (`#1e293b`) background and export at the three sizes above.

### Option 3 – Quick Node.js script (requires `sharp` or `jimp`)

```bash
npm install sharp
node -e "
const sharp = require('sharp');
const svg = Buffer.from('<svg …>…</svg>');
[16,48,128].forEach(s => sharp(svg).resize(s).toFile('icon'+s+'.png'));
"
```
