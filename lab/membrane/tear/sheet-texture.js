// A Range reports the ink run's layout origin even when its parent is a wide
// grid cell, right-aligned, or wraps across several lines.
function drawTextNode(ctx, range, node, bounds) {
    const value = node.data;
    if (!value.trim()) return;
    range.selectNodeContents(node);
    const boxes = range.getClientRects();
    if (!boxes.length || !overlaps(range.getBoundingClientRect(), bounds)) return;

    const style = getComputedStyle(node.parentElement);
    if (style.visibility !== "visible") return;
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
    ctx.fillStyle = style.color;
    // A two-tone sheet may invert the ink partway through a text run.
    // Use the containing label's origin even when this node is an alternate glyph.
    const split = node.parentElement.closest("[data-split-ink]");
    if (split) {
        const stop = split.getBoundingClientRect().top + parseFloat(style.getPropertyValue("--ink-stop"));
        const ink = ctx.createLinearGradient(0, stop - 1, 0, stop + 1);
        ink.addColorStop(0.5, style.getPropertyValue("--ink-above").trim());
        ink.addColorStop(0.5, style.getPropertyValue("--ink-below").trim());
        ctx.fillStyle = ink;
    }
    const ascent = ctx.measureText(value).fontBoundingBoxAscent;
    if (boxes.length === 1) {
        ctx.fillText(value.trim(), boxes[0].left, Math.round(boxes[0].top + ascent));
        return;
    }

    // Read line breaks from the layout engine. Draw each line as one shaped
    // run to keep kerning, ligatures, and variable glyphs intact.
    let start = 0;
    let first;
    for (let i = 0; i < value.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (!rect.width) continue;
        if (first && Math.abs(rect.top - first.top) > 0.5) {
            ctx.fillText(value.slice(start, i).trimEnd(), first.left, Math.round(first.top + ascent));
            first = null;
        }
        if (!first) {
            first = rect;
            start = i;
        }
    }
    if (first) ctx.fillText(value.slice(start).trimEnd(), first.left, Math.round(first.top + ascent));
}

function overlaps(a, b) {
    return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

export function captureSheet(sheet, bounds, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    // An alpha-enabled surface uses grayscale glyph antialiasing like the
    // composited DOM. An opaque context can bake coloured LCD fringes into
    // the texture, making text flicker when the physical sheet returns to DOM.
    const ctx = canvas.getContext("2d", { alpha: true });
    ctx.fillStyle = getComputedStyle(sheet).getPropertyValue("--paper").trim() || "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.scale(width / bounds.width, height / bounds.height);
    ctx.translate(-bounds.left, -bounds.top);

    const range = document.createRange();
    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) {
            drawTextNode(ctx, range, node, bounds);
        } else if (node instanceof HTMLImageElement && node.complete && node.naturalWidth) {
            const rect = node.getBoundingClientRect();
            if (!overlaps(rect, bounds)) continue;
            const style = getComputedStyle(node);
            if (style.visibility !== "visible") continue;
            const clip = node.closest("[data-print-clip]");
            if (clip) {
                const box = clip.getBoundingClientRect();
                // A rectangular CSS overflow clip ends on a screen-pixel boundary.
                const snap = value => Math.round(value * devicePixelRatio) / devicePixelRatio;
                const left = snap(box.left), top = snap(box.top);
                ctx.save();
                ctx.beginPath();
                ctx.rect(left, top, snap(box.right) - left, snap(box.bottom) - top);
                ctx.clip();
            }
            ctx.globalCompositeOperation = style.mixBlendMode === "difference" ? "difference" : "source-over";
            ctx.drawImage(node, rect.left, rect.top, rect.width, rect.height);
            ctx.globalCompositeOperation = "source-over";
            if (clip) ctx.restore();
        }
    }
    return canvas;
}
