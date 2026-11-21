# Architecture — dipnaked.com

## Overview

The root `index.html` serves the clockwise menu from `/lab/menu/?layout=trail&sign=under`.
Below 43rem of usable width it uses the centered, left-aligned menu column, with
each caption above its heading. Activating the wordmark or slogan reveals the
spiral beneath the sheet. Each of the seven sections opens its own preview.
The HTML contains the links in reading and tab order, so they also work when
JavaScript is disabled.

The homepage uses `/lab/menu/` as its base URL for the shared styles, scripts,
fonts and preview media. The menu grid is defined in `lab/menu/trail-layout.css`.

## Layout of the dark catalogue and listening pages

The following grid and typography belong to the shared root `style.css`.

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
- `lab/menu/` — Menu assets, preview data, styles and interaction code
- `style.css` — Shared styles for the dark pages
- `logo.png` — Brand logo
- `assets/icons/` — Icons for music services (used in release pages)
- `assets/logos/` — Additional logos (e.g., Spotify)
- `releases/august/index.html` — Release page
- `releases/princess/index.html` — Release page
- `lab/membrane/` — Experimental 3D logo animation (point piercing a stretched
  film; Verlet mass–spring simulation with strain-stiffening materials —
  presets in `MATERIALS`, constants in `CONFIG`, seeded imperfection, GUI on
  `H`). Listed in the Lab catalogue.

## Lab catalogue

`lab/index.html` lists the experiments and is linked from the main navigation.
It includes Membrane and both intro variants, Black Square, H Girl and its
studies, Organic Blob, Inertia, the Synchronicity simulator, and all 14 Drowning Links experiments. `lab/style.css` adds the catalogue list styles on
top of the existing site typography and colours.

Organic Blob is built in the sibling `organic-blob-reconstruction` project.
`npm run deploy` there builds `dist/` and mirrors it into `lab/organic-blob/`.
The existing GitHub Pages workflow publishes these static files with the site.

## Previous homepage

Commit `77940b4` preserves the dark homepage and its skip/replay controls.
The membrane simulation is also available in the lab catalogue at `/lab/membrane/intro/`.

## Autopost integration pages

- `integrations/autopost/index.html` describes the personal publishing tool,
  YouTube access, support contact and terms of use (`#terms`).
- `integrations/autopost/privacy/index.html` describes local storage, Google and
  YouTube API data, OpenAI content generation, and revocation/deletion options.
- `integrations/autopost/style.css` provides isolated, responsive document styles.

These static pages are served by the existing GitHub Pages workflow and use the
same `dipnaked.com` custom domain. They need no JavaScript, build step or additional
hosting. Google OAuth Branding uses `/integrations/autopost/` as the application
home page and `/integrations/autopost/privacy/` as the privacy policy URL. Keep the
public text in sync with the Autopost application's data practices.
