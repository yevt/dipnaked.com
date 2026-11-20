import { waterStripe } from './tube-liquid.js';

const centre = 128;

export async function loadTubeProfile() {
    const response = await fetch(new URL('./assets/pump-profiles.svg', import.meta.url));
    if (!response.ok) throw new Error('pump-profiles.svg: ' + response.status);
    const drawing = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    const walls = drawing.getElementById('bezier-walls').getAttribute('d');
    // The master uses absolute M/C/Q commands. The Q is the rim between the two walls.
    const curves = [];
    let start, rimIndex;
    for (const [, command, args] of walls.matchAll(/([MCQ])([^MCQ]*)/g)) {
        const values = args.trim().split(/[\s,]+/).map(Number);
        const end = values.slice(-2);
        if (command === 'C') curves.push([start, values.slice(0, 2), values.slice(2, 4), end]);
        if (command === 'Q') rimIndex = curves.length;
        start = end;
    }
    // At the bottom the two bores span y=167..194 and 224..251 in the master.
    // Measure centre to centre. This distance is independent of the page size.
    const bottoms = curves.filter(([a, , c, d]) => a[1] < d[1] && c[1] === d[1])
        .map(curve => curve[3][1]).sort((a, b) => a - b);
    const [innerTop, innerBottom, outerTop, outerBottom] = bottoms;
    const pitch = ((outerTop + outerBottom) - (innerTop + innerBottom)) / 2;
    // Read both outer turns in the direction of flow, from their rightmost point to the lip.
    const outer = curves.slice(0, rimIndex).reverse().map(curve => curve.slice().reverse());
    const inner = curves.slice(rimIndex);
    return {
        pitch,
        inner: repeatableTurn(inner.slice(-4), pitch),
        outer: repeatableTurn(outer.slice(-4), pitch),
    };
}

const offset = ([x, y], [dx, dy], distance) => [x + dx * distance, y + dy * distance];
const normal = ([x, y]) => [y, -x];

function direction(from, to) {
    const x = to[0] - from[0], y = to[1] - from[1];
    const length = Math.hypot(x, y);
    return [x / length, y / length];
}

function repeatableTurn(arcs, pitch) {
    // Complete the missing part from the open lip to the right-hand extremum.
    // Work one turn inward so adding the first pitch starts exactly at the lip.
    const last = arcs.at(-1);
    const tangent = direction(last[2], last[3]);
    const start = offset(last[3], normal(tangent), -pitch);
    const end = arcs[0][0];
    const dx = end[0] - start[0];
    const cornerY = start[1] + dx * tangent[1] / tangent[0];
    const halfCos = Math.sqrt((1 + tangent[1]) / 2);
    const handle = 4 * halfCos / (3 * (1 + halfCos));
    const bridge = [start, offset(start, tangent, handle * dx / tangent[0]),
        [end[0], end[1] + handle * (cornerY - end[1])], end];
    return [bridge, ...arcs].map(curve => {
        const t0 = direction(curve[0], curve[1]), t1 = direction(curve[2], curve[3]);
        const n0 = normal(t0), n1 = normal(t1);
        // One unit-radius arc of outward normals. Adding it to the Bézier
        // controls offsets every lap equally and preserves both end tangents.
        const angle = Math.atan2(t0[0] * t1[1] - t0[1] * t1[0], t0[0] * t1[0] + t0[1] * t1[1]);
        const k = 4 / 3 * Math.tan(angle / 4);
        const normals = [n0, offset(n0, t0, k), offset(n1, t1, -k), n1];
        return distance => curve.map((p, i) => offset(p, normals[i], distance));
    });
}

// Give the DOM and the tear texture the same outline. Browser rasterizers can
// flatten the same long cubic differently. The cubic's second derivative
// bounds the error of each chord by max |B''| / (8 * steps²).
const secondDifference = (a, b, c) => Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]);

function arcSteps([a, b, c, d], tolerance) {
    const maxAcceleration = 6 * Math.max(secondDifference(a, b, c), secondDifference(b, c, d));
    return Math.max(1, Math.ceil(Math.sqrt(maxAcceleration / (8 * tolerance))));
}

function cubic([a, b, c, d], t) {
    const u = 1 - t;
    const p0 = u ** 3, p1 = 3 * u * u * t, p2 = 3 * u * t * t, p3 = t ** 3;
    return [p0 * a[0] + p1 * b[0] + p2 * c[0] + p3 * d[0], p0 * a[1] + p1 * b[1] + p2 * c[1] + p3 * d[1]];
}

// Sample both walls at the same parameter. Distances follow the centre of
// the channel, so a scoop can occupy less of a revolution as the coil grows.
function sampleTurn(profile, index, tolerance) {
    const distance = (index - 1) * profile.pitch;
    const inner = profile.inner.map(arc => arc(distance));
    const outer = profile.outer.map(arc => arc(distance));
    const stations = [{ inner: inner[0][0], outer: outer[0][0], s: 0 }];
    let bottom = 0;
    for (let i = 0; i < inner.length; i++) {
        const steps = Math.max(arcSteps(inner[i], tolerance), arcSteps(outer[i], tolerance));
        for (let j = 1; j <= steps; j++) {
            const a = cubic(inner[i], j / steps), b = cubic(outer[i], j / steps);
            const prev = stations.at(-1);
            const dx = (a[0] - prev.inner[0] + b[0] - prev.outer[0]) / 2;
            const dy = (a[1] - prev.inner[1] + b[1] - prev.outer[1]) / 2;
            stations.push({ inner: a, outer: b, s: prev.s + Math.hypot(dx, dy) });
        }
        if (i === 1) bottom = stations.at(-1).s;
    }
    return { stations, bottom, length: stations.at(-1).s };
}

export function stripeDrawing(profile, page, sign) {
    const scale = sign.width / 256;
    const left = (page.left - sign.left) / scale, top = (page.top - sign.top) / scale;
    const width = page.width / scale, height = page.height / scale;
    const farthest = Math.hypot(Math.max(centre - left, left + width - centre),
        Math.max(centre - top, top + height - centre));
    const count = Math.ceil(farthest / profile.pitch) + 3;
    const tolerance = 0.1 / (scale * devicePixelRatio);
    const paths = [];
    // Start after the three laps of the separate logo. Only the water is printed here.
    for (let lap = 3; lap < count; lap++) {
        paths.push(waterStripe(sampleTurn(profile, lap, tolerance), lap, profile.pitch));
    }
    // Leave one regular gap between the last black turn and the first grey scoop.
    const placement = `translate(${profile.pitch / 4} ${profile.pitch / 2})`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="${left} ${top} ${width} ${height}" preserveAspectRatio="none"><path id="outer-water" transform="${placement}" d="${paths.join('')}" opacity=".21"/></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
