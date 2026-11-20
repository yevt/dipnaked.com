// Refine only the polar cells near a glyph. Both sides of a shared edge split
// at the same rest position; the two banks of a tear keep distinct particles.
const pair = (a, b) => a < b ? b * (b + 1) / 2 + a : a * (a + 1) / 2 + b;

function refine(mesh, mask, unit) {
    const home = Array.from(mesh.home);
    const canonical = Array.from({ length: mesh.count }, (_, i) => i);
    const parents = new Map(), detailWelds = [];
    let faces = mesh.triangles;
    for (const seam of mesh.seams) canonical[seam.b] = seam.ring ? seam.a : 0;
    canonical[0] = 0;
    for (const seam of mesh.seams) {
        if (seam.ring) parents.set(pair(canonical[mesh.seams[seam.inner].a], canonical[seam.a]), seam);
    }
    mesh.rim.forEach((v, s) => {
        const last = mesh.seams[mesh.seams.length - mesh.rim.length + s];
        parents.set(pair(canonical[last.a], v), last);
    });
    function vertex(x, z) {
        const i = canonical.length;
        canonical.push(i);
        home.push(x, 0, z);
        return i;
    }
    function kind(a, b, c) {
        const i = a * 3, j = b * 3, k = c * 3;
        return mask.kind(Math.min(home[i], home[j], home[k]), Math.min(home[i+2], home[j+2], home[k+2]),
            Math.max(home[i], home[j], home[k]), Math.max(home[i+2], home[j+2], home[k+2]));
    }
    function splitEdges(marks) {
        const placed = new Map(), next = [];
        function split(a, b) {
            const ga = canonical[a], gb = canonical[b], key = pair(ga, gb);
            const mark = marks.get(key);
            if (!mark) return -1;
            const actual = pair(a, b);
            if (placed.has(actual)) return placed.get(actual);
            const t = ga < gb ? mark.t : 1 - mark.t, i = a * 3, j = b * 3;
            const v = vertex(home[i] + t * (home[j] - home[i]), home[i+2] + t * (home[j+2] - home[i+2]));
            const parent = parents.get(key);
            if (mark.first === undefined) {
                mark.first = v;
                if (parent) {
                    parents.set(pair(ga, v), parent);
                    parents.set(pair(v, gb), parent);
                }
            } else {
                canonical[v] = mark.first;
                if (parent) detailWelds.push({ a: mark.first, b: v, parent });
            }
            placed.set(actual, v);
            return v;
        }
        for (let i = 0; i < faces.length; i += 3) {
            let a = faces[i], b = faces[i + 1], c = faces[i + 2];
            let ab = split(a, b), bc = split(b, c), ca = split(c, a);
            const splitCount = (ab >= 0) + (bc >= 0) + (ca >= 0);
            if (!splitCount) {
                next.push(a, b, c);
                continue;
            }
            if (splitCount === 3) {
                next.push(a, ab, ca,   ab, b, bc,   ca, bc, c,   ab, bc, ca);
                continue;
            }
            while (ab < 0 || (splitCount === 2 && bc < 0)) {
                [a, b, c] = [b, c, a];
                [ab, bc, ca] = [bc, ca, ab];
            }
            if (splitCount === 1) next.push(a, ab, c,   ab, b, c);
            else next.push(a, ab, c,   ab, bc, c,   ab, b, bc);
        }
        faces = next;
    }
    // A finer stencil near the jet resolves the lips while the mostly flat
    // far field can use larger cells. Optical coverage stays at texture resolution.
    for (let pass = 0; pass < 6 && canonical.length < 20000; pass++) {
        const marks = new Map();
        for (let i = 0; i < faces.length; i += 3) {
            const a = faces[i], b = faces[i + 1], c = faces[i + 2];
            if (kind(a, b, c) !== 0) continue;
            const x = home[3 * a] + home[3 * b] + home[3 * c];
            const z = home[3 * a + 2] + home[3 * b + 2] + home[3 * c + 2];
            const r = Math.hypot(x, z) / 3;
            const cell = Math.max(2.4 / unit, .023 + .035 * Math.min(2, Math.max(0, r - 1)));
            for (let k = 0; k < 3; k++) {
                const u = faces[i + k], v = faces[i + (k + 1) % 3];
                const dx = home[3 * u] - home[3 * v], dz = home[3 * u + 2] - home[3 * v + 2];
                if (dx * dx + dz * dz > cell * cell) marks.set(pair(canonical[u], canonical[v]), { t: .5 });
            }
        }
        if (!marks.size) break;
        splitEdges(marks);
    }

    const coverage = i => mask.coverage(home[3 * i], home[3 * i + 2]);
    // Put a particle on each bank where an edge meets a stroke. A narrow stroke
    // can cross an edge twice, even when both ends land on white material.
    for (const findBoundary of [false, true]) {
        const marks = new Map();
        for (let i = 0; i < faces.length; i += 3) {
            if (kind(faces[i], faces[i + 1], faces[i + 2]) !== 0) continue;
            for (let j = 0; j < 3; j++) {
                const a = faces[i + j], b = faces[i + (j + 1) % 3];
                const ga = canonical[a], gb = canonical[b];
                const key = pair(ga, gb);
                if (marks.has(key)) continue;
                const paper = coverage(a) >= .5, other = coverage(b) >= .5;
                const x = home[3 * a], z = home[3 * a + 2], dx = home[3 * b] - x, dz = home[3 * b + 2] - z;
                let t = .5;
                if (findBoundary) {
                    if (paper === other) continue;
                    let white = paper ? 0 : 1, hole = 1 - white;
                    for (let k = 0; k < 8; k++) {
                        t = (white + hole) * .5;
                        if (mask.coverage(x + t * dx, z + t * dz) >= .51) white = t;
                        else hole = t;
                    }
                    t = white;
                    if (t < .04 || t > .96) continue;
                } else if (paper !== other || (mask.coverage(x + dx * .5, z + dz * .5) >= .5) === paper) {
                    continue;
                }
                marks.set(key, { t: ga < gb ? t : 1 - t });
            }
        }
        if (marks.size) splitEdges(marks);
    }
    return { home: Float32Array.from(home), faces, detailWelds };
}

// A cell straddling a cut can contain two independently moving banks. Divide
// its texture domain between them; even its antialiased fringe follows only
// the neighbouring material. No triangle can stretch across the empty stroke.
function separateBanks(home, faces, fractions, solid, connected) {
    const points = Array.from(home), triangles = [], areas = [], lipFollowers = [];
    const copies = new Map();
    function carriedBy(v, bank) {
        if (v === bank) return v;
        const key = pair(v, bank);
        if (copies.has(key)) return copies.get(key);
        const id = points.length / 3;
        points.push(points[3 * v], 0, points[3 * v + 2]);
        lipFollowers.push(3 * id, 3 * bank);
        copies.set(key, id);
        return id;
    }
    function middle(a, b) {
        const id = points.length / 3;
        points.push((points[3 * a] + points[3 * b]) / 2, 0, (points[3 * a + 2] + points[3 * b + 2]) / 2);
        return id;
    }
    function closest(v, bank) {
        let best = bank[0], distance = Infinity;
        for (const u of bank) {
            const d = (points[3 * v] - points[3 * u]) ** 2 + (points[3 * v + 2] - points[3 * u + 2]) ** 2;
            if (d < distance) {
                best = u;
                distance = d;
            }
        }
        return best;
    }
    const nearest = (v, bank) => carriedBy(v, closest(v, bank));
    function face(a, b, c, fraction) {
        triangles.push(a, b, c);
        areas.push(fraction);
    }
    for (let i = 0; i < faces.length; i += 3) {
        const a = faces[i], b = faces[i + 1], c = faces[i + 2], fraction = fractions[i / 3];
        const ab = connected.has(pair(a, b)), bc = connected.has(pair(b, c)), ca = connected.has(pair(c, a));
        if (Number(ab) + Number(bc) + Number(ca) >= 2) {
            face(a, b, c, fraction);
            continue;
        }
        const vertices = [a, b, c];
        const paper = vertices.filter(v => solid[v]);
        if (paper.length === 1 || (paper.length === 2 && (ab || bc || ca))) {
            face(...vertices.map(v => nearest(v, paper)), fraction);
            continue;
        }
        // Partition the cell in rest space. The texture supplies the precise
        // silhouette inside each piece, including when viewed from the back.
        const half = [middle(a, b), middle(b, c), middle(c, a)];
        const centre = points.length / 3;
        points.push((points[3 * a] + points[3 * b] + points[3 * c]) / 3, 0,
            (points[3 * a + 2] + points[3 * b + 2] + points[3 * c + 2]) / 3);
        for (let k = 0; k < 3; k++) {
            const corner = vertices[k];
            const owner = solid[corner] ? corner : closest(corner, paper);
            const bank = paper.filter(v => v === owner || connected.has(pair(owner, v)));
            const v = nearest(corner, bank), core = nearest(centre, bank);
            face(v, nearest(half[k], bank), core, fraction);
            face(v, core, nearest(half[(k + 2) % 3], bank), fraction);
        }
    }
    return { home: Float32Array.from(points), triangles, faceFraction: Float32Array.from(areas), lipFollowers };
}

export function perforate(mesh, mask, unit, rings, segments) {
    const { home, faces, detailWelds } = refine(mesh, mask, unit);
    const count = home.length / 3, weights = new Float32Array(count), solid = new Uint8Array(count);
    const inverseMass = new Float32Array(count), dampingJitter = new Float32Array(count).fill(1);
    dampingJitter.set(mesh.dampingJitter);
    for (let i = 0; i < count; i++) solid[i] = mask.coverage(home[3 * i], home[3 * i + 2]) >= .5;
    const materialFaces = [], fractions = [], links = new Map();
    for (const c of mesh.constraints) {
        // A coarse span is still a ligament if its entire length is paper.
        // It carries long-range tension across finer cells along a letter.
        c.coarseWeight = c.gw;
        c.gw = 0;
        links.set(pair(c.a, c.b), c);
    }
    function edge(a, b, area) {
        if (!solid[a] || !solid[b]) return;
        const key = pair(a, b), ja = a * 3, jb = b * 3;
        let c = links.get(key);
        if (!c) {
            const rest = Math.hypot(home[ja] - home[jb], home[ja + 2] - home[jb + 2]);
            c = { a, b, ja, jb, rest, stiffness: 1, bend: false, gw: 0, k: 0 };
            links.set(key, c);
        }
        c.gw += area / (c.rest * c.rest);
    }
    for (let i = 0; i < faces.length; i += 3) {
        const a = faces[i], b = faces[i + 1], c = faces[i + 2];
        const ax = home[3 * a], az = home[3 * a + 2];
        const bx = home[3 * b], bz = home[3 * b + 2];
        const cx = home[3 * c], cz = home[3 * c + 2];
        const kind = mask.kind(Math.min(ax, bx, cx), Math.min(az, bz, cz), Math.max(ax, bx, cx), Math.max(az, bz, cz));
        const paperCorners = solid[a] + solid[b] + solid[c];
        if (kind < 0 || !paperCorners) continue;
        // Integrate area on the paper side only. Points just inside the optical
        // edge follow its nearest free lip for antialiasing; they transmit no load.
        const fraction = kind === 1 ? 1 : (
            mask.coverage((4 * ax + bx + cx) / 6, (4 * az + bz + cz) / 6) +
            mask.coverage((ax + 4 * bx + cx) / 6, (az + 4 * bz + cz) / 6) +
            mask.coverage((ax + bx + 4 * cx) / 6, (az + bz + 4 * cz) / 6)) / 3;
        if (fraction < .005) continue;
        const area = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) * .5 * fraction;
        if (area <= 1e-12) continue;
        materialFaces.push(a, b, c);
        fractions.push(fraction);
        for (let j = 0; j < 3; j++) {
            const v = faces[i + j];
            if (solid[v]) weights[v] += area / paperCorners;
        }
        edge(a, b, area);
        edge(b, c, area);
        edge(c, a, area);
    }
    const reference = Math.PI * .8 * (1.35 / Math.round(rings * .76)) / segments;
    for (let i = 0; i < count; i++) {
        if (weights[i]) inverseMass[i] = Math.max(.3, Math.min(6, reference / weights[i]));
    }
    const constraints = [], connected = new Set();
    for (const c of links.values()) {
        if (!weights[c.a] || !weights[c.b]) continue;
        if (mask.crosses(home[c.ja], home[c.ja + 2], home[c.jb], home[c.jb + 2])) continue;
        c.wa = inverseMass[c.a] / (inverseMass[c.a] + inverseMass[c.b]);
        c.wb = 1 - c.wa;
        c.gw = c.bend ? 1 : Math.max(.12, Math.min(3, c.gw || c.coarseWeight));
        constraints.push(c);
        if (!c.bend) connected.add(pair(c.a, c.b));
    }
    const welds = [];
    for (const seam of mesh.seams) {
        const inner = mesh.seams[seam.inner];
        seam.absent = !weights[seam.a] || !weights[seam.b];
        seam.atCut = !!inner && mask.crosses(home[inner.ja], home[inner.ja + 2], home[seam.ja], home[seam.ja + 2]);
        seam.inwardBank = inner?.absent ? inner.inwardBank : inner;
    }
    for (const weld of [...mesh.seams, ...detailWelds]) {
        const { a, b } = weld;
        if (!weights[a] || !weights[b]) continue;
        weld.wa = inverseMass[a] / (inverseMass[a] + inverseMass[b]);
        weld.wb = 1 - weld.wa;
        weld.ja = a * 3;
        weld.jb = b * 3;
        if (weld.ring !== 0) welds.push(weld);
    }
    const skin = separateBanks(home, materialFaces, fractions, solid, connected);
    const Index = skin.home.length / 3 + segments > 65535 ? Uint32Array : Uint16Array;
    // The final portion of the position buffers is kinematic. Only the first
    // count particles have inertia, receive pressure and enter the spring solve.
    return { ...mesh, ...skin, count, pos: skin.home.slice(), prev: skin.home.slice(),
        nodeArea: weights, inverseMass, dampingJitter, constraints, welds, triangles: Index.from(skin.triangles),
        visible: new Uint8Array(skin.triangles.length / 3).fill(1), localStrain: new Float32Array(count) };
}
