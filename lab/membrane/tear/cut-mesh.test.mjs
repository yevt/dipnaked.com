import test from 'node:test';
import assert from 'node:assert/strict';
import { CutMask } from './cut-surface.js';
import { TearSolver } from './solver.js';

const unit = 100, width = 256, centre = width / 2;
function maskFor(inHole) {
    const alpha = Uint8Array.from({ length: width ** 2 }, (_, i) => {
        const x = (i % width + .5 - centre) / unit;
        const z = (Math.floor(i / width) + .5 - centre) / unit;
        return inHole(x,z) ? 0 : 255;
    });
    return new CutMask(alpha, width, width, centre, centre, unit, unit);
}
const sheet = cutouts => new TearSolver({cutouts, seed:42, pixelsPerUnit:unit});

test('a white counter has no mechanical connection through the stroke enclosing it', () => {
    const mask = maskFor((x,z) => Math.hypot(x,z) > .11 && Math.hypot(x,z) < .21);
    const s = sheet(mask), network = Array.from({length:s.count}, () => []);
    for (const {a,b} of [...s.constraints, ...s.welds]) {
        assert(!mask.crosses(s.home[a*3],s.home[a*3+2],s.home[b*3],s.home[b*3+2]));
        network[a].push(b); network[b].push(a);
    }
    const connected = new Set([0]);
    for (const a of connected) for (const b of network[a]) connected.add(b);
    assert(connected.size > 10);
    assert(Math.max(...Array.from(connected, i => s.radius[i])) < .16);
    assert(s.rim.every(i => !connected.has(i)));
});

test('an existing opening admits the tip and survives the complete healing cycle', () => {
    const mask = maskFor((x,z) => Math.abs(x) < .065 && Math.abs(z) < .37);
    const s = sheet(mask), originalLinks = s.constraints.length;
    s.prick();
    assert.equal(s.brokenCount, 0);
    assert.equal(s.nodeArea[0], 0);
    for (let step=0;step<150;step++) s.step();
    assert(s.pos.every(Number.isFinite));
    assert(s.brokenCount > 0, 'stress extends a tear from the existing free edge');
    s.heal();
    for (let step=0;step<900 && s.phase!=='done';step++) s.step();
    assert.equal(s.phase, 'done');
    assert.deepEqual(s.pos, s.home);
    assert.equal(s.brokenCount, 0);
    assert.equal(s.constraints.length, originalLinks);
    assert.equal(s.nodeArea[0], 0);
});

test('the visible surface has no triangle joining opposite sides of a thin circular cut', () => {
    const radius = (x, z) => Math.hypot(x - .034, z + .019);
    const s = sheet(maskFor((x, z) => Math.abs(radius(x, z) - .21) < .015));
    const bank = new Map();
    for (let i = 0; i < s.lipFollowers.length; i += 2) {
        bank.set(s.lipFollowers[i] / 3, s.lipFollowers[i + 1] / 3);
    }
    for (let i = 0; i < s.triangles.length; i += 3) {
        const sides = [];
        for (const vertex of s.triangles.subarray(i, i + 3)) {
            const node = bank.get(vertex) ?? vertex;
            sides.push(radius(s.home[3 * node], s.home[3 * node + 2]) < .21);
        }
        assert(sides.every(side => side === sides[0]), 'moving the white counter must not stretch the outer sheet');
    }
});

test('solid paper under the same jet retains the original trajectory', () => {
    const s = sheet(maskFor(() => false)), plain = sheet(undefined);
    for (let i=0;i<50;i++) { s.step(); plain.step(); }
    assert.deepEqual(s.pos,plain.pos);
    assert.equal(s.brokenCount,plain.brokenCount);
});
