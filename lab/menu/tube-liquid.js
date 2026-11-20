const xy = ([x, y]) => x.toFixed(2) + ' ' + y.toFixed(2);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const mid = station => mix(station.inner, station.outer, .5);

function at(turn, distance) {
    const { stations, length } = turn;
    if (distance <= 0) return stations[0];
    if (distance >= length) return stations.at(-1);
    let lo = 0, hi = stations.length - 1;
    while (hi - lo > 1) {
        const i = (lo + hi) >>> 1;
        if (stations[i].s < distance) lo = i;
        else hi = i;
    }
    const a = stations[lo], b = stations[hi], t = (distance - a.s) / (b.s - a.s);
    return { inner: mix(a.inner, b.inner, t), outer: mix(a.outer, b.outer, t), s: distance };
}

function section(turn, from, to) {
    return [at(turn, from), ...turn.stations.filter(p => p.s > from && p.s < to), at(turn, to)];
}

// A fixed sample per scoop keeps the printed figure registered through
// scrolling, resizing, puncturing and healing.
function variation(index, salt) {
    let x = Math.imul(index + 7, 0x9e3779b1) ^ salt;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function meniscus(turn, distance, facing) {
    const p = at(turn, distance);
    const a = mid(at(turn, distance - 1)), b = mid(at(turn, distance + 1));
    const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / step, ty = (b[1] - a[1]) / step;
    // Gravity levels each interface on a steep side. At the shallow bottom
    // the interface stays across the bore and bows slightly into the air.
    const shift = (p.outer[1] - p.inner[1]) * .5 * ty / (ty * ty + .2);
    const inner = Math.min(turn.length, Math.max(0, distance + shift));
    const outer = Math.min(turn.length, Math.max(0, distance - shift));
    const u = at(turn, inner).inner, v = at(turn, outer).outer;
    const bow = facing * .08 * Math.hypot(p.outer[0] - p.inner[0], p.outer[1] - p.inner[1]);
    return { inner, outer, control: [(u[0] + v[0]) / 2 + bow * tx, (u[1] + v[1]) / 2 + bow * ty] };
}

export function waterStripe(turn, index, pitch) {
    const sample = variation(index, 53);
    const scoop = pitch * 5.7 * (.74 + .52 * sample);
    const length = Math.min(scoop, turn.length * (1 / 3) * (.92 + .16 * sample));

    // Adjacent pockets see a related load, with the original sample for each lap.
    const group = Math.floor((index - 3) / 5), t = (index - 3) % 5 / 5;
    const a = variation(group, 71), b = variation(group + 1, 71);
    const load = a + (b - a) * t * t * (3 - 2 * t);
    const lift = length * (.05 + .24 * variation(index, 173)) +
        turn.length * (.015 + .12 * load + .018 * (sample - .5));
    const middle = Math.max(length / 2, Math.min(turn.length - length / 2, turn.bottom - lift));
    const start = middle - length / 2, end = middle + length / 2;
    const head = meniscus(turn, start, -1);
    const tail = meniscus(turn, end, 1);
    const inner = section(turn, head.inner, tail.inner).map(p => xy(p.inner));
    const outer = section(turn, head.outer, tail.outer).map(p => xy(p.outer)).reverse();
    return 'M' + inner.join(' ') + 'Q' + xy(tail.control) + ' ' + outer[0] + 'L' + outer.slice(1).join(' ') +
        'Q' + xy(head.control) + ' ' + inner[0] + 'Z';
}
