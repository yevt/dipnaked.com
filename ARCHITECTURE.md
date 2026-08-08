# Architecture — dipnaked.com

## Overview
Root landing page (`index.html`) with a micro-modular grid layout. Content block
is bounding-box-centered in the viewport when it fits; gracefully scrolls (minimal
scroll) when it doesn't.

## Layout Hierarchy
```
body (flex column, overflow:auto, padding:var(--edge))
└─ .center-block (flex column, margin:auto → safe centering)
   ├─ a > img.logo
   └─ .text-block (flex column, max-width capped to viewport)
      ├─ .brand-name
      ├─ .tagline       ← next line after brand-name
      └─ .links         ← 2 modules below tagline; 1 module between items
```

## Design System

### Micro-module grid
All vertical spacing is expressed in multiples of `--mm` (= line-height = 16px).
The logo height is also snapped to the grid via `--logo-lines`.
Tune these via CSS custom properties in `:root`.

### Safe viewport centering
`margin: auto` on `.center-block` inside a flex column distributes free space on
all sides, centering the block by its bounding-box. When the block exceeds the
viewport, the margin collapses to zero and `overflow: auto` on `body` adds just
enough scroll to reveal the content.

Minimum `--edge` (= 1 module) clearance is always preserved via `body` padding.
`100dvh` is used (with `100vh` fallback) to account for mobile browser chrome.

### Horizontal overflow / line wrapping
Long lines (e.g. the tagline) wrap at word boundaries before the block exceeds
the viewport. If even the longest single word doesn't fit, a horizontal scrollbar
appears for exactly the needed width. Letter-spacing is progressively reduced at
narrow breakpoints (≤ 420px and ≤ 300px) to preserve the rarefied typographic
feel as long as possible.

## Typography
- **Font**: Satoshi (400, 500, 700 weights from Fontshare CDN)
- **Base size**: 12px / 16px line-height
- **Letter-spacing**: `--ls-brand` 0.9ch · `--ls-tagline` 0.5ch · `--ls-links` 1ch
- **Palette**: `--color-text` #ccc on `--color-bg` #000; tagline `--color-tagline` #a3a3a3

## CSS Custom Properties (tune in `:root`)
| Variable          | Default       | Purpose                            |
|-------------------|---------------|------------------------------------|
| `--mm`            | 16px          | Micro-module = line-height         |
| `--font-size`     | 12px          | Base font size                     |
| `--color-bg`      | #000          | Page background                    |
| `--color-text`    | #ccc          | Primary text / link color          |
| `--color-tagline` | #a3a3a3       | Tagline text (slightly greyer)     |
| `--ls-brand`      | 0.9ch         | Brand name letter-spacing          |
| `--ls-tagline`    | 0.5ch         | Tagline letter-spacing             |
| `--ls-links`      | 1ch           | Links letter-spacing               |
| `--logo-width`    | 150px         | Logo rendered width                |
| `--logo-lines`    | 9             | Logo height in micro-modules       |
| `--edge`          | var(--mm)     | Min clearance from viewport edge   |

## Files
- `index.html` — Main landing page
- `style.css` — All styles; theme tokens in `:root`
- `logo.png` — Brand logo
- `assets/icons/` — Icons for music services (used in release pages)
- `assets/logos/` — Additional logos (e.g., Spotify)
- `releases/august/index.html` — Release page
- `releases/princess/index.html` — Release page
- `lab/membrane/` — Experimental 3D logo animation (point piercing a stretched
  film; Verlet mass–spring simulation, all constants in `CONFIG`, GUI on `H`).
  Not linked from the main site.
