import { captureSheet } from './sheet-texture.js';

// The texture and the mechanical sampling grid come from the same typeset sheet.
// Rest coordinates (x, z) are measured from the puncture, in nozzle units.
export function captureCutSurface(sheet, cx, cy, unit, radius) {
    const page = sheet.getBoundingClientRect();
    const extent = radius * unit;
    const left = Math.floor(Math.max(page.left, cx - extent));
    const top = Math.floor(Math.max(page.top, cy - extent));
    const width = Math.max(1, Math.ceil(Math.min(page.right, cx + extent)) - left);
    const height = Math.max(1, Math.ceil(Math.min(page.bottom, cy + extent)) - top);
    const bounds = new DOMRect(left, top, width, height);
    const density = Math.min(devicePixelRatio, 3072 / Math.max(width, height));
    const canvas = captureSheet(sheet, bounds, Math.max(1, Math.round(width * density)),
        Math.max(1, Math.round(height * density)), true);
    const raster = document.createElement('canvas');
    const scale = Math.min(1, density);
    raster.width = Math.max(1, Math.round(width * scale));
    raster.height = Math.max(1, Math.round(height * scale));
    const ctx = raster.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, raster.width, raster.height);
    const pixels = ctx.getImageData(0, 0, raster.width, raster.height);
    const alpha = new Uint8Array(raster.width * raster.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels.data[i * 4 + 3];
    const sx = raster.width / width, sy = raster.height / height;
    return { canvas, bounds, mask: new CutMask(alpha, raster.width, raster.height,
        (cx - left) * sx, (cy - top) * sy, unit * sx, unit * sy) };
}

export class CutMask {
    constructor(alpha, width, height, ox, oy, sx, sy) {
        Object.assign(this, { alpha, width, height, ox, oy, sx, sy });
        this.stride = width + 1;
        const sums = this.sums = new Uint32Array(this.stride * (height + 1));
        for (let y = 0; y < height; y++) {
            let row = 0;
            for (let x = 0; x < width; x++) {
                if (alpha[y * width + x] < 128) row++;
                const j = y * this.stride + x + 1;
                sums[j + this.stride] = sums[j] + row;
            }
        }
        this.hasHoles = sums[sums.length - 1] > 0;
    }

    coverage(x, z) {
        const px = x * this.sx + this.ox - .5, py = z * this.sy + this.oy - .5;
        if (px < 0 || py < 0 || px >= this.width - 1 || py >= this.height - 1) return 1;
        const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
        const j = iy * this.width + ix, k = j + this.width, a = this.alpha;
        return ((a[j] * (1 - fx) + a[j + 1] * fx) * (1 - fy) +
            (a[k] * (1 - fx) + a[k + 1] * fx) * fy) / 255;
    }

    // Classify a rectangle in constant time: solid (1), empty (-1), or mixed (0).
    kind(minX, minZ, maxX, maxZ) {
        const x0 = Math.floor(minX * this.sx + this.ox - .5), x1 = Math.ceil(maxX * this.sx + this.ox + .5);
        const y0 = Math.floor(minZ * this.sy + this.oy - .5), y1 = Math.ceil(maxZ * this.sy + this.oy + .5);
        const left = Math.max(0, x0), right = Math.min(this.width, x1);
        const top = Math.max(0, y0), bottom = Math.min(this.height, y1);
        if (left >= right || top >= bottom) return 1;
        const s = this.sums, a = top * this.stride, b = bottom * this.stride;
        const holes = s[b + right] - s[b + left] - s[a + right] + s[a + left];
        return holes === 0 ? 1 : holes === (x1 - x0) * (y1 - y0) ? -1 : 0;
    }

    crosses(ax, az, bx, bz) {
        const kind = this.kind(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
        if (kind) return kind < 0;
        const steps = Math.max(1, Math.ceil(2 * Math.max(Math.abs((bx - ax) * this.sx), Math.abs((bz - az) * this.sy))));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            if (this.coverage(ax + t * (bx - ax), az + t * (bz - az)) < .5) return true;
        }
        return false;
    }
}
