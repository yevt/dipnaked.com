# Architecture — dipnaked.com

## Overview
Root landing page (`index.html`) with clean, centered layout. Flexible vertical layout that remains centered as content grows.

## Structure

### Layout Hierarchy
```
body (flex center/center, min-height 100vh)
└─ .center-block (flex column, align-items flex-start)
   ├─ .logo (150px width)
   ├─ .brand-name (text)
   ├─ .tagline (text)
   └─ .links (flex row)
```

### Design Principles
- **Vertical centering**: Entire `.center-block` is centered on viewport
- **Horizontal alignment**: All content left-aligned within the block
- **Growth**: As more elements are added, block expands vertically, always remains centered
- **Padding**: 24px horizontal, 16px responsive to viewport size

## Typography
- **Font**: Satoshi (400, 500, 700 weights from Fontshare CDN)
- **Base size**: 12px
- **Letter spacing**: 1ch (≈ width of 1 character)
- **Color**: White (#ffffff) on black background (#000000)

## Content Sections

### Logo
- File: `logo.png` (150px fixed width)
- Margin below: 8px extra (total gap 24px from next element)

### Brand Name (Lettering)
- Text: "dipnaked"
- Weight: 500 (medium)
- Transform: uppercase
- Style: Satoshi, 12px, 1ch letter-spacing

### Tagline
- Text: "if affair with the abbys"
- Weight: 400 (regular)
- Style: Satoshi, 12px, 1ch letter-spacing

### Links
- Three items: "listen", "watch", "look"
- Layout: flex row, 24px gap between items
- "listen" links to `/releases/august/`
- "watch" and "look" are placeholders (#watch, #look)

## Styling Features
- **Reset**: Universal box-sizing, margin/padding zeroed on html/body
- **Transitions**: Links fade to 0.7 opacity on hover (200ms)
- **Font smoothing**: Antialiased on all platforms
- **Responsive**: Handles mobile via padding and flexible sizing

## Files
- `index.html` — Main landing page (this file)
- `logo.png` — Brand logo (correlated with `.logo` class)
- `assets/icons/` — Icons for music services (used in release pages)
- `assets/logos/` — Additional logos (e.g., Spotify)
- `releases/august/index.html` — Release page (linked from "listen")
- `releases/princess/index.html` — Release page (future)

## Future Extensions
- Add social links (Instagram, Twitter, etc.) as flex items
- Update "watch" and "look" hrefs to actual resources
- Potentially add hover effects to logo or brand name
- Consider animation/fade-in on page load
