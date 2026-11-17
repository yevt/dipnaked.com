// Top-down variant of the polar Verlet membrane from ../intro/membrane.js.
// The renderer owns projection. All distances here are in material space.
const DT = 1 / 120;
export const PATCH_RADIUS = 4;
export const tearDefaults = Object.freeze({
    wind: 45, nozzleRadius: 0.75, coneSlope: 1.3, shear: 0.35,
    tearStrain: 0.6,
    memoryStiffness: 30, drag: 8.5, prickRadius: 0.075, pressDuration: 0.15,
    shrinkDuration: 1.2,
    rings: 34, segments: 56,
});

function mulberry32(a) {
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function smooth(x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
}

// Each sector owns its two banks. Cohesive welds join coincident banks;
// a failed weld exposes two surfaces without discarding any triangle area.
function buildMembrane(options) {
    const rings = options.rings, segments = options.segments;
    const core = Math.round(0.76 * rings), coreRadius = 1.35;
    // Most rings resolve the puncture. The remaining rings grow gradually
    // in width and cover the much larger, almost stationary far field.
    const shoulder = 1.7 * coreRadius / core;
    function ringRadius(r) {
        if (r <= core) {
            const t = r / core;
            return coreRadius * (0.3 * t + 0.7 * t * t);
        }
        const outer = r - core, t = outer / (rings - core);
        return coreRadius + shoulder * outer + (PATCH_RADIUS - coreRadius - shoulder * (rings - core)) * t * t;
    }
    const originalCount = 1 + rings * segments;
    const count = originalCount + (rings - 1) * segments + (segments - 1);
    const home = new Float32Array(3 * count);
    const rng = mulberry32(options.seed + 193);
    const vertex = (r, s) => 1 + (r - 1) * segments + s;
    const bank = (r, s) => r === rings ? vertex(r, s) : originalCount + (r - 1) * segments + s;
    const tip = s => s === 0 ? 0 : originalCount + (rings - 1) * segments + s - 1;
    for (let r = 1; r <= rings; r++) {
        const radius = ringRadius(r);
        for (let s = 0; s < segments; s++) {
            const jitter = r === rings ? 0 : 0.23;
            const a = (s + jitter * (rng() * 2 - 1)) * 2 * Math.PI / segments;
            const length = radius + jitter * (rng() * 2 - 1) * (radius - ringRadius(r - 1));
            for (const i of [vertex(r, s), bank(r, s)]) {
                home[i * 3] = Math.cos(a) * length;
                home[i * 3 + 2] = Math.sin(a) * length;
            }
        }
    }
    const weights = new Float32Array(count);
    const faces = [];
    const constraints = [];
    const edges = new Map();
    const pairKey = (a, b) => Math.min(a, b) * count + Math.max(a, b);
    const reference = coreRadius / core;
    function edge(a, b, bend = false) {
        const key = pairKey(a, b);
        if (edges.has(key)) return edges.get(key);
        const ja = 3 * a, jb = 3 * b;
        const rest = Math.hypot(home[ja] - home[jb], home[ja + 2] - home[jb + 2]);
        const index = constraints.length;
        constraints.push({ a, b, ja, jb, rest, bend, gw: 0, k: 0, stiffness: 1 + 0.06 * (rng() * 2 - 1)});
        edges.set(key, index);
        return index;
    }
    function face(a, b, c) {
        faces.push(a, b, c);
        const ax = home[3 * a], az = home[3 * a + 2], bx = home[3 * b], bz = home[3 * b + 2];
        const area = Math.abs((bx - ax) * (home[3 * c + 2] - az) - (bz - az) * (home[3 * c] - ax)) * 0.5;
        for (const node of [a, b, c]) weights[node] += area / 3;
        for (const index of [edge(a, b), edge(b, c), edge(c, a)]) {
            const link = constraints[index];
            link.gw += area / (link.rest * link.rest);
        }
    }
    const hoop = new Uint16Array(rings * segments);
    for (let s = 0; s < segments; s++) {
        const next = (s + 1) % segments;
        face(tip(s), bank(1, next), vertex(1, s));
        for (let r = 1; r < rings; r++) {
            const a = vertex(r, s), b = bank(r, next), c = vertex(r + 1, s), d = bank(r + 1, next);
            face(a, d, c);
            face(a, b, d);
            hoop[(r - 1) * segments + s] = edge(a, b);
        }
        for (let r = 1; r < rings; r++) {
            const a = r === 1 ? tip(s) : vertex(r - 1, s);
            const b = r === 1 ? tip(s) : bank(r - 1, next);
            edge(a, vertex(r + 1, s), true);
            edge(b, bank(r + 1, next), true);
        }
    }
    const inverseMass = new Float32Array(count), dampingJitter = new Float32Array(count);
    const referenceArea = Math.PI * 0.8 * reference / segments;
    for (let i = 0; i < count; i++) {
        inverseMass[i] = Math.max(0.3, Math.min(6, referenceArea / weights[i])) / (1 + 0.06 * (rng() * 2 - 1));
        dampingJitter[i] = 1 + 0.1 * (rng() * 2 - 1);
    }
    for (const c of constraints) {
        const total = inverseMass[c.a] + inverseMass[c.b];
        c.wa = inverseMass[c.a] / total;
        c.wb = inverseMass[c.b] / total;
        c.gw = c.bend ? 1 : Math.max(0.12, Math.min(3, c.gw));
    }
    const seams = [];
    for (let r = 0; r < rings; r++) {
        for (let s = 0; s < segments; s++) {
            const prev = (s + segments - 1) % segments;
            const a = r ? vertex(r, s) : tip(s), b = r ? bank(r, s) : tip(prev);
            const wa = inverseMass[a] / (inverseMass[a] + inverseMass[b]);
            seams.push({ a, b, ja: 3 * a, jb: 3 * b, wa, wb: 1 - wa, broken: false, contactTime: 0,
                threshold: 0.82 + 0.36 * rng(), ring: r, inner: (r - 1) * segments + s,
                gauge: Math.max(0.014, ringRadius(r) * 2 * Math.PI / segments),
                hoopA: hoop[Math.max(0, r - 1) * segments + s], hoopB: hoop[Math.max(0, r - 1) * segments + prev],
            });
        }
    }
    const triangles = Uint16Array.from(faces);
    const rim = Uint16Array.from({ length: segments }, (_, s) => vertex(rings, s));
    return { home, pos: home.slice(), prev: home.slice(), inverseMass, dampingJitter, count, rim,
        nodeArea: weights,
        constraints, seams, triangles, visible: new Uint8Array(triangles.length / 3).fill(1) };
}

export class TearSolver {
    constructor(settings = {}) {
        this.options = { ...tearDefaults, seed: Math.random() * 0x100000000 >>> 0, ...settings };
        Object.assign(this, buildMembrane(this.options));
        this.phase = 'press';
        this.phaseTime = 0;
        this.accumulator = 0;
        this.topologyVersion = 0;
        this.brokenCount = 0;
        this.radius = new Float32Array(this.count);
        this.radiusUnits = PATCH_RADIUS;
        this.normals = new Float32Array(this.pos.length);
        this.pixelsPerUnit = settings.pixelsPerUnit ?? 200;
        this.closing = false;
        this.refreshTipGroups();
        this.restoring = new Float32Array(this.count);
        this.damping = new Float32Array(this.count);
        for (let i = 0; i < this.count; i++) {
            const j = i * 3;
            const r = this.radius[i] = Math.hypot(this.home[j], this.home[j + 2]);
            // Shape memory stays active throughout the cycle. The continuation
            // of the sheet provides progressively stronger support far from the jet.
            const support = smooth((r - 1.25) / (PATCH_RADIUS - 1.25));
            this.restoring[i] = this.options.memoryStiffness + 14000 * support ** 4;
            this.damping[i] = this.options.drag * this.dampingJitter[i] + 125 * support * support;
        }
    }

    advance(seconds) {
        this.accumulator += Math.max(0, Math.min(0.05, seconds));
        while (this.accumulator >= DT && this.phase !== 'done') {
            this.step();
            this.accumulator -= DT;
        }
    }

    // Several sector tips meet at exactly one point. Pairwise welding alone
    // would leave numerical pinholes around that high-valence vertex.
    refreshTipGroups() {
        const segments = this.options.segments;
        const firstCut = this.seams.slice(0, segments).findIndex(s => s.broken);
        const first = firstCut < 0 ? 0 : firstCut;
        this.tipGroups = [];
        let group;
        for (let k = 0; k < segments; k++) {
            const seam = this.seams[(first + k) % segments];
            if (k === 0 || seam.broken) {
                group = { nodes: [], mass: 0 };
                this.tipGroups.push(group);
            }
            const mass = 1 / this.inverseMass[seam.a];
            group.nodes.push({ j: seam.ja, mass });
            group.mass += mass;
        }
    }

    heal() {
        if (this.closing || this.phase === 'done') return;
        this.closing = true;
        this.returnCeiling = new Float32Array(this.count);
        for (let i = 0; i < this.count; i++) {
            this.returnCeiling[i] = Math.max(0, this.pos[3 * i + 1]);
        }
        this.closingFlow = this.phase === 'blow';
        this.phase = 'heal';
        this.phaseTime = 0;
    }

    step() {
        this.phaseTime += DT;
        if (this.phase === 'settle') {
            this.settle();
            return;
        }
        if (this.phase === 'press' && this.phaseTime >= this.options.pressDuration) {
            this.phase = 'blow';
            this.phaseTime = 0;
            this.prick();
        }
        this.integrate();
        this.relax();
        if (this.closing) this.limitReturnHeight();
        this.updateSeams();
        if (this.phase === 'heal') this.checkRest();
    }

    prick() {
        // The three edges of a small pointed tip start short cuts within its
        // footprint. Their eventual length follows hoop tension at each tip.
        const { segments, seed } = this.options;
        const rng = mulberry32(seed + 4711);
        const azimuth = rng() * segments;
        const starts = new Set();
        for (let n = 0; n < 3; n++) {
            starts.add(Math.floor(azimuth + (n + 0.3 * rng()) * segments / 3) % segments);
        }
        for (let i = 0; i < this.seams.length; i++) {
            const seam = this.seams[i];
            if (starts.has(i % segments) && this.radius[seam.a] <= this.options.prickRadius) {
                seam.broken = true;
                this.brokenCount++;
            }
        }
        this.refreshTipGroups();
        this.topologyVersion++;
    }

    updateNormals() {
        const { normals, pos, triangles } = this;
        normals.fill(0);
        for (let face = 0; face < triangles.length; face += 3) {
            const a = 3 * triangles[face];
            const b = 3 * triangles[face + 1];
            const c = 3 * triangles[face + 2];
            const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
            const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
            // The unnormalised cross product also weights the force normal by area.
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;
            for (let corner = 0; corner < 3; corner++) {
                const j = 3 * triangles[face + corner];
                normals[j] += nx;
                normals[j + 1] += ny;
                normals[j + 2] += nz;
            }
        }
        for (const seam of this.seams) {
            if (seam.broken || seam.ring === 0) continue;
            for (let axis = 0; axis < 3; axis++) {
                const a = seam.ja + axis, b = seam.jb + axis;
                normals[a] += normals[b];
                normals[b] = normals[a];
            }
        }
    }

    integrate() {
        const { pos, prev, home, options: opt } = this;
        const press = this.phase === 'press';
        const shrinking = this.closingFlow && this.phaseTime < opt.shrinkDuration;
        // Closing the nozzle confines the air to the remaining deep centre.
        // The outer sheet unloads first while the tip still feels the jet.
        const aperture = shrinking ? 1 - smooth(this.phaseTime / opt.shrinkDuration) : 1;
        const blowing = (this.phase === 'blow' || shrinking) && opt.wind > 0 && aperture > 0.00001;
        if (blowing) this.updateNormals();
        const nozzle = opt.nozzleRadius * aperture;
        const coneSlope = opt.coneSlope * aperture;
        const apex = opt.nozzleRadius / opt.coneSlope;
        for (let i = 0; i < this.count; i++) {
            const j = i * 3;
            const x = pos[j], y = pos[j + 1], z = pos[j + 2];
            const r2 = x * x + z * z;
            const k = this.restoring[i];
            let ax = -k * (x - home[j]), ay = -k * y, az = -k * (z - home[j + 2]);
            let resistance = this.damping[i];
            if (press) {
                // Broad contact shoulder of the tip creates an elastic dimple.
                const contact = Math.exp(-r2 / 0.019);
                ay -= 32 * smooth(this.phaseTime / opt.pressDuration) * contact;
            } else if (blowing) {
                // Streamlines diverge from a virtual point above the nozzle.
                // Jet speed falls with cross-section radius and mixes smoothly
                // into still air off-axis. Sample space, not material labels.
                const distance = apex + Math.max(0, -y);
                const width = coneSlope * distance;
                const width2 = width * width;
                // Average a sub-cell jet over the area represented by this node.
                // Even a tip exactly on the axis unloads continuously as the
                // nozzle closes below the mesh resolution.
                let profile = Math.exp(-r2 / width2);
                if (shrinking) {
                    const cellArea = this.nodeArea[i] / Math.PI;
                    const openWidth2 = (opt.coneSlope * distance) ** 2;
                    const exposure = width2 / (width2 + cellArea);
                    const openExposure = openWidth2 / (openWidth2 + cellArea);
                    // Calibrate the finite-area correction to the open nozzle.
                    // At aperture=1 this is exactly the original point profile.
                    const inverseVariance = 1 / (width2 + cellArea) +
                        cellArea / (openWidth2 * (openWidth2 + cellArea));
                    profile = exposure / openExposure * Math.exp(-r2 * inverseVariance);
                }
                const speed = opt.wind * nozzle / width * profile;
                const transfer = 9 * profile;
                const n = this.normals;
                const norm = Math.sqrt(n[j] * n[j] + n[j + 1] * n[j + 1] + n[j + 2] * n[j + 2]) || 1;
                const nx = n[j] / norm, ny = n[j + 1] / norm, nz = n[j + 2] / norm;
                const ux = speed * x / distance, uy = -speed, uz = speed * z / distance;
                const vx = (x - prev[j]) / DT, vy = (y - prev[j + 1]) / DT, vz = (z - prev[j + 2]) / DT;

                // Air transfers its normal relative velocity as pressure and
                // a smaller tangential component as shear on the moving film.
                const normalSpeed = (ux - vx) * nx + (uy - vy) * ny + (uz - vz) * nz;
                const shear = opt.shear;
                ax += transfer * (shear * ux + (1 - shear) * normalSpeed * nx);
                ay += transfer * (shear * uy + (1 - shear) * normalSpeed * ny);
                az += transfer * (shear * uz + (1 - shear) * normalSpeed * nz);
                resistance += transfer * shear;
            }
            // Implicit linear drag on displacement per fixed step.
            const factor = 1 / (1 + resistance * DT);
            // Critical normal damping for this implicit-drag Verlet step.
            // Tangential motion retains the existing material resistance.
            const verticalFactor = this.closing
                ? 1 / (1 + Math.max(resistance, 2 * Math.sqrt(k) + k * DT) * DT)
                : factor;
            const dx = (x - prev[j] + ax * DT * DT) * factor;
            const dy = (y - prev[j + 1] + ay * DT * DT) * verticalFactor;
            const dz = (z - prev[j + 2] + az * DT * DT) * factor;
            prev[j] = x;
            prev[j + 1] = y;
            prev[j + 2] = z;
            pos[j] = x + dx;
            pos[j + 1] = y + dy;
            pos[j + 2] = z + dz;
        }
    }

    limitReturnHeight() {
        // Inelastic return to the page plane: constraint relaxation may not
        // throw a returning vertex through it. Folds already above the page
        // descend from their current height, without an immediate projection.
        for (let i = 0; i < this.count; i++) {
            const j = 3 * i + 1;
            if (this.pos[j] > this.returnCeiling[i]) {
                this.pos[j] = this.returnCeiling[i];
                this.prev[j] = this.pos[j];
            } else {
                this.returnCeiling[i] = Math.max(0, this.pos[j]);
            }
        }
    }

    relax() {
        const { constraints, pos } = this;
        // Original latex J-curve, cached once per fixed step.
        for (const c of constraints) {
            if (c.bend) {
                c.k = 0.03 * c.stiffness;
            } else {
                const a = c.ja, b = c.jb;
                const x = pos[b] - pos[a], y = pos[b + 1] - pos[a + 1], z = pos[b + 2] - pos[a + 2];
                const strain = Math.sqrt(x * x + y * y + z * z) / c.rest - 1;
                c.strain = strain;
                const knee = Math.min(1, Math.max(0, (strain - 0.1) / 0.6));
                const stiffness = strain > 0 ? 0.03 + 0.92 * knee ** 2.2 : 0.03 * 0.15;
                c.k = Math.min(1, stiffness * c.gw) * c.stiffness;
            }
        }
        for (let iter = 0; iter < 6; iter++) {
            for (const c of constraints) {
                if (!c.k) continue;
                const a = c.ja, b = c.jb;
                const x = pos[b] - pos[a], y = pos[b + 1] - pos[a + 1], z = pos[b + 2] - pos[a + 2];
                const d = Math.sqrt(x * x + y * y + z * z);
                if (d < 1e-9 || (c.bend && d >= c.rest)) continue;
                const corr = c.k * (1 - c.rest / d);
                const left = corr * c.wa, right = corr * c.wb;
                pos[a] += left * x;
                pos[a + 1] += left * y;
                pos[a + 2] += left * z;
                pos[b] -= right * x;
                pos[b + 1] -= right * y;
                pos[b + 2] -= right * z;
            }
            for (const seam of this.seams) {
                if (seam.broken || seam.ring === 0) continue;
                const a = seam.ja, b = seam.jb;
                for (let k = 0; k < 3; k++) {
                    const delta = pos[b + k] - pos[a + k];
                    pos[a + k] += delta * seam.wa;
                    pos[b + k] -= delta * seam.wb;
                }
            }
            for (const group of this.tipGroups) {
                let x = 0, y = 0, z = 0;
                for (const { j, mass } of group.nodes) {
                    x += pos[j] * mass;
                    y += pos[j + 1] * mass;
                    z += pos[j + 2] * mass;
                }
                x /= group.mass;
                y /= group.mass;
                z /= group.mass;
                for (const { j } of group.nodes) {
                    pos[j] = x;
                    pos[j + 1] = y;
                    pos[j + 2] = z;
                }
            }
        }
    }

    updateSeams() {
        // The closing sheet keeps its existing cuts until it is nearly flat.
        // That avoids projecting separated banks together during the return.
        if (this.closing) return;
        const { pos, prev, seams, constraints } = this;
        // Inspect outer tips first: stress can advance a crack only from an
        // existing opening. Intact material away from a tip stays connected.
        for (let i = seams.length - 1; i >= 0; i--) {
            const seam = seams[i], a = seam.ja, b = seam.jb;
            if (!seam.broken) {
                if (seam.inner < 0 || !seams[seam.inner].broken) continue;
                const tensile = 0.5 * (constraints[seam.hoopA].strain + constraints[seam.hoopB].strain);
                if (tensile > this.options.tearStrain * seam.threshold) {
                    seam.broken = true;
                    seam.contactTime = 0;
                    this.brokenCount++;
                    this.topologyVersion++;
                }
                continue;
            }
            const x = pos[b] - pos[a], y = pos[b + 1] - pos[a + 1], z = pos[b + 2] - pos[a + 2];
            const vx = x - prev[b] + prev[a], vy = y - prev[b + 1] + prev[a + 1], vz = z - prev[b + 2] + prev[a + 2];
            const weldDistance = 0.12 * seam.gauge;
            if (x * x + y * y + z * z > weldDistance * weldDistance ||
                vx * vx + vy * vy + vz * vz > (0.2 * DT) ** 2) {
                seam.contactTime = 0;
                continue;
            }
            seam.contactTime += DT;
            if (seam.contactTime >= 0.12) {
                seam.broken = false;
                seam.contactTime = 0;
                this.brokenCount--;
                this.topologyVersion++;
                if (!seam.ring) this.refreshTipGroups();
            }
        }
    }

    checkRest() {
        const { pos, home } = this;
        const tolerance2 = (2 / this.pixelsPerUnit) ** 2;
        for (let j = 0; j < pos.length; j += 3) {
            const dx = pos[j] - home[j], dy = pos[j + 1], dz = pos[j + 2] - home[j + 2];
            if (dx * dx + dy * dy + dz * dz > tolerance2) return;
        }
        for (const seam of this.seams) {
            if (!seam.broken) continue;
            const a = seam.ja, b = seam.jb;
            const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
            if (dx * dx + dy * dy + dz * dz > tolerance2) return;
        }
        // The visible return is complete. Finish its sub-two-pixel remainder
        // in one short linear movement, then return an exactly flat page.
        this.settleFrom = pos.slice();
        this.settleProgress = 0;
        this.phase = 'settle';
        this.phaseTime = 0;
    }

    settle() {
        const progress = Math.min(1, this.phaseTime / 0.14);
        this.settleProgress = progress;
        for (let j = 0; j < this.pos.length; j++) {
            this.prev[j] = this.pos[j];
            this.pos[j] = this.home[j] + (1 - progress) * (this.settleFrom[j] - this.home[j]);
        }
        if (progress < 1) return;
        this.prev.set(this.home);
        for (const seam of this.seams) {
            seam.broken = false;
            seam.contactTime = 0;
        }
        this.brokenCount = 0;
        this.refreshTipGroups();
        this.topologyVersion++;
        this.settleFrom = null;
        this.phase = 'done';
    }
}
