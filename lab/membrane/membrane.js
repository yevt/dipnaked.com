// ============================================================================
// dipnaked — membrane lab
// A point pierces a stretched circular film: real-time 3D mass–spring (Verlet)
// membrane simulation. The maximum-stretch frame reproduces the static logo.
//
// Iteration 2 — material physics:
//   • strain-stiffening links (J-curve: compliant at rest, stiff when
//     stretched) → the funnel bows in arcs instead of a straight cone
//   • bend (second-neighbour) links → surface curvature control
//   • material presets (latex, rubber, silicone, film, spandex), live-switch
//   • ball contact with adhesion: the film dimples and wraps before tearing
//   • tearing by per-link strain with cascade + recoil impulses (snap-back)
//   • healing by growing home-springs + proximity re-knitting → real inertia:
//     the film overshoots, sloshes and settles instead of lerping home
//   • seeded imperfection: mass/stiffness/damping/tear jitter, entry offset
// All tweakable constants live in CONFIG below (live-editable via GUI, press H).
// ============================================================================

import * as THREE from 'three';
import GUI from 'lil-gui';

// ----------------------------------------------------------------------------
// MATERIALS — presets are parameter sets for one solver, not separate math.
// Stiffness follows a J-curve: compliant below `stiffenStart` strain, rising
// to `maxStiffness` over `stiffenSpan` with exponent `stiffenPower`.
// ----------------------------------------------------------------------------
const MATERIALS = {
    latex: {
        baseStiffness: 0.03,   // stiffness at low strain (soft start → the ball sinks in)
        stiffenStart: 0.10,    // strain where stiffening kicks in
        stiffenSpan: 0.60,     // strain span to reach maxStiffness
        stiffenPower: 2.2,     // knee sharpness of the J-curve
        maxStiffness: 0.95,    // stiffness deep in the stretched regime
        compressResist: 0.15,  // fraction of baseStiffness resisting compression (wrinkles)
        bendStiffness: 0.03,   // straightening (2nd-neighbour) stiffness
        damping: 0.9985,       // internal velocity keep-factor
        massScale: 1.0,        // node inertia vs impulses (recoil, heal springs)
        grip: 0.6,             // ball adhesion 0..1 (film wraps the sphere)
        tearStrain: 5.5,       // strain that snaps a link (latex stretches far)
        tearCascade: 0.8,      // neighbour threshold multiplier after a snap (unzip)
        recoil: 0.55,          // snap-back impulse per unit strain
        healSpring: 14,        // home-spring stiffness at full heal ramp (1/s²)
        healSnap: 0.12,        // re-knit distance from rest position
    },
    rubber: {
        baseStiffness: 0.10, stiffenStart: 0.05, stiffenSpan: 0.40, stiffenPower: 1.7,
        maxStiffness: 0.97, compressResist: 0.30, bendStiffness: 0.07, damping: 0.997,
        massScale: 1.5, grip: 0.5, tearStrain: 2.6, tearCascade: 0.8, recoil: 0.45,
        healSpring: 18, healSnap: 0.12,
    },
    silicone: {
        baseStiffness: 0.06, stiffenStart: 0.12, stiffenSpan: 0.70, stiffenPower: 1.5,
        maxStiffness: 0.90, compressResist: 0.25, bendStiffness: 0.05, damping: 0.985,
        massScale: 1.2, grip: 0.85, tearStrain: 3.4, tearCascade: 0.85, recoil: 0.3,
        healSpring: 10, healSnap: 0.14,
    },
    film: { // polyethylene: stiff from the start, near-cone, tears sharply
        baseStiffness: 0.65, stiffenStart: 0.0, stiffenSpan: 0.12, stiffenPower: 1.0,
        maxStiffness: 0.99, compressResist: 0.50, bendStiffness: 0.01, damping: 0.996,
        massScale: 0.8, grip: 0.2, tearStrain: 1.3, tearCascade: 0.7, recoil: 0.9,
        healSpring: 22, healSnap: 0.10,
    },
    spandex: { // fabric: floppy, folds freely, almost never tears by strain
        baseStiffness: 0.02, stiffenStart: 0.25, stiffenSpan: 0.90, stiffenPower: 2.0,
        maxStiffness: 0.80, compressResist: 0.05, bendStiffness: 0.005, damping: 0.997,
        massScale: 0.9, grip: 0.7, tearStrain: 7.0, tearCascade: 0.9, recoil: 0.4,
        healSpring: 9, healSnap: 0.16,
    },
};

// ----------------------------------------------------------------------------
// CONFIG — all tunable constants, grouped by section
// ----------------------------------------------------------------------------
const CONFIG = {
    scene: {
        background: '#000000',
        cameraFov: 35,            // deg
        cameraDistance: 7.0,      // units from origin
        cameraHeight: 0.4,        // camera y
        lookAtY: -0.9,            // where the camera looks (y)
        membraneTilt: -24,        // deg; negative tips the plane away → we see its back
    },
    membrane: {
        radius: 1.6,              // disc radius
        rings: 26,                // radial resolution
        segments: 56,             // angular resolution
        iterations: 6,            // constraint solver iterations
        damping: 0.996,           // velocity keep-factor before rupture (× material damping)
        gravity: 0.0,             // optional sag (units/s², along -normal)
    },
    materialPreset: 'latex',
    material: { ...MATERIALS.latex }, // live-editable copy (edited sliders → "custom")
    ball: {
        radius: 0.10,
        startHeight: 3.2,         // spawn height above the film (along +normal)
        speed: 0.55,              // units/s along -normal (slow, comet-like)
        exitDistance: 4.5,        // despawn this far below the film
        color: '#2ec8e0',
    },
    rupture: {
        maxDepth: 2.6,            // failsafe: force-tear if the centre ever gets this deep
        healDelay: 1.2,           // s after rupture before healing starts
        healDuration: 3.0,        // s for the home-springs to reach full strength
    },
    oscillation: {
        damping: 0.9995,          // weak post-rupture damping → the film sloshes and rings
        settleTime: 5.0,          // s of oscillation after full re-knit before the next cycle
    },
    imperfection: {               // seeded chaos sources; 0 = sterile symmetry
        seed: 3,
        massJitter: 0.06,         // ± fraction of node mass
        stiffnessJitter: 0.06,    // ± fraction of link stiffness
        dampingJitter: 0.25,      // ± fraction of per-node energy loss
        tearJitter: 0.15,         // ± fraction of per-link tear threshold
        entryOffset: 0.07,        // max ball entry offset from the axis (units)
        recoilNoise: 0.35,        // rupture impulse noise 0..1
    },
    look: {
        baseColor: '#2ec8e0',     // film color at rest / at the rim
        darkenDepth: 1.9,         // deflection at which darkening saturates
        darkenPower: 0.7,         // curve exponent (higher = darkening stays near tip)
        darkenStrength: 0.97,     // 0..1 max darkening at full stretch
        brightness: 1.0,          // global film brightness multiplier
    },
    timing: {
        timeScale: 1.0,           // global slow-motion factor
        restPause: 1.5,           // s of calm film between cycles
    },
    debug: {
        showContact: false,       // wireframe contact sphere + penetrating faces in red
    },
};

// Small deterministic RNG (mulberry32) — all chaos is reproducible via seed.
function mulberry32(a) {
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ----------------------------------------------------------------------------
// Renderer / scene / camera
// ----------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
    CONFIG.scene.cameraFov, window.innerWidth / window.innerHeight, 0.1, 100);

function applyCamera() {
    camera.fov = CONFIG.scene.cameraFov;
    camera.position.set(0, CONFIG.scene.cameraHeight, CONFIG.scene.cameraDistance);
    camera.lookAt(0, CONFIG.scene.lookAtY, 0);
    camera.updateProjectionMatrix();
    scene.background = new THREE.Color(CONFIG.scene.background);
}

// Tilted group: the membrane lives in its local XZ plane (normal = local +Y).
const tiltGroup = new THREE.Group();
scene.add(tiltGroup);
function applyTilt() {
    tiltGroup.rotation.x = THREE.MathUtils.degToRad(CONFIG.scene.membraneTilt);
}

// ----------------------------------------------------------------------------
// Membrane: radial-ring disc mesh + Verlet mass-spring simulation
// ----------------------------------------------------------------------------
let mem = null; // simulation state bundle

function buildMembrane() {
    if (mem) {
        tiltGroup.remove(mem.mesh);
        mem.mesh.geometry.dispose();
        mem.mesh.material.dispose();
    }

    const R = Math.max(3, Math.round(CONFIG.membrane.rings));
    const S = Math.max(8, Math.round(CONFIG.membrane.segments));
    const radius = CONFIG.membrane.radius;
    const count = 1 + R * S; // center + rings

    const home = new Float32Array(count * 3);  // rest positions (local space)
    const pos = new Float32Array(count * 3);
    const prev = new Float32Array(count * 3);
    const ringOf = new Int16Array(count);      // ring index per vertex
    const pinned = new Uint8Array(count);
    const jitInvMass = new Float32Array(count);  // 1 / (1 + mass jitter)
    const geoInvMass = new Float32Array(count);  // 1 / (vertex share of disc area)
    const dampJit = new Float32Array(count);     // per-vertex energy-loss multiplier
    const stiffJit = new Float32Array(count);    // per-vertex stiffness multiplier
    const wArr = new Float32Array(count);        // per-step working inverse masses
    const brokenTouch = new Uint16Array(count);  // broken links touching each vertex

    const idx = (ring, seg) => ring === 0 ? 0 : 1 + (ring - 1) * S + ((seg % S + S) % S);

    // Geometric weights. Each vertex owns a share of the disc area and each
    // link a share of the material cross-section it represents. On a polar
    // grid radial "strips" get narrower toward the center (width ∝ r), so
    // strain piles up near a point load (∝ 1/r) — that is what bends the
    // profile into concave arcs. Without these weights every ring strains
    // equally and the deflection is a straight cone regardless of material.
    const dr = radius / R;
    const shareRef = 2 * Math.PI * (radius / 2) * dr / S; // mid-disc vertex share
    const gwRef = (2 * Math.PI * (radius / 2) / S) / dr;  // mid-disc radial link

    for (let r = 0; r <= R; r++) {
        if (r === 0) { ringOf[0] = 0; continue; }
        const rr = (r / R) * radius;
        for (let s = 0; s < S; s++) {
            const i = idx(r, s);
            const a = (s / S) * Math.PI * 2;
            home[i * 3] = Math.cos(a) * rr;
            home[i * 3 + 1] = 0;
            home[i * 3 + 2] = Math.sin(a) * rr;
            ringOf[i] = r;
            if (r === R) pinned[i] = 1;
        }
    }
    pos.set(home); prev.set(home);
    for (let i = 0; i < count; i++) {
        const rr = (ringOf[i] / R) * radius;
        const share = i === 0 ? Math.PI * dr * dr * 0.25 : 2 * Math.PI * rr * dr / S;
        geoInvMass[i] = Math.min(6, Math.max(0.5, shareRef / share));
    }

    // Constraints. Structural: radial, circumferential, diagonal (shear) —
    // these stretch, tear and re-knit. Bend: second-neighbour straightening
    // links that only resist folding; alive iff both structural halves are.
    const constraints = []; // {a,b,rest,broken,bend,h0,h1,spoke,tearBase,tearScale,k}
    const conAt = new Map(); // vertex-pair key → structural constraint index
    const vertexCons = [];   // per-vertex list of structural constraint indices
    for (let i = 0; i < count; i++) vertexCons.push([]);
    const pairKey = (a, b) => a < b ? a * count + b : b * count + a;
    const restOf = (a, b) => {
        const dx = home[a * 3] - home[b * 3];
        const dy = home[a * 3 + 1] - home[b * 3 + 1];
        const dz = home[a * 3 + 2] - home[b * 3 + 2];
        return Math.hypot(dx, dy, dz);
    };
    const addC = (a, b, gw) => {
        const ci = constraints.length;
        constraints.push({ a, b, rest: restOf(a, b), broken: false, bend: false, h0: -1, h1: -1,
                           spoke: a === 0 || b === 0, tearBase: 1, tearScale: 1, k: 0,
                           gw: Math.min(4, Math.max(0.1, gw)) });
        conAt.set(pairKey(a, b), ci);
        vertexCons[a].push(ci);
        vertexCons[b].push(ci);
    };
    // Cross-section per link type (normalized to a mid-disc radial link):
    // radial ∝ arc width at its mid radius, circumferential ∝ dr per arc
    // length, diagonals get the geometric mean with a shear discount.
    const gwRad = (r) => (2 * Math.PI * ((r + 0.5) / R) * radius / S) / dr / gwRef;
    const gwCirc = (r) => (dr / (2 * Math.PI * (r / R) * radius / S)) / gwRef;
    for (let s = 0; s < S; s++) addC(0, idx(1, s), gwRad(0));           // center spokes
    for (let r = 1; r <= R; r++) {
        for (let s = 0; s < S; s++) {
            addC(idx(r, s), idx(r, s + 1), gwCirc(r));                  // circumferential
            if (r < R) {
                addC(idx(r, s), idx(r + 1, s), gwRad(r));               // radial
                addC(idx(r, s), idx(r + 1, s + 1), 0.5 * Math.sqrt(gwRad(r) * gwCirc(r + 0.5))); // diagonal
            }
        }
    }
    const structCount = constraints.length;

    // Bend links (a—c across the middle vertex of two collinear halves)
    const addBend = (a, c, via) => {
        const h0 = conAt.get(pairKey(a, via));
        const h1 = conAt.get(pairKey(via, c));
        if (h0 === undefined || h1 === undefined) return;
        constraints.push({ a, b: c, rest: restOf(a, c), broken: false, bend: true, h0, h1,
                           spoke: false, tearBase: 1, tearScale: 1, k: 0,
                           gw: 0.5 * (constraints[h0].gw + constraints[h1].gw) });
    };
    for (let s = 0; s < S; s++) {
        addBend(0, idx(2, s), idx(1, s));                                          // radial through ring 1
        for (let r = 1; r <= R - 2; r++) addBend(idx(r, s), idx(r + 2, s), idx(r + 1, s)); // radial
        for (let r = 1; r <= R; r++) addBend(idx(r, s), idx(r, s + 2), idx(r, s + 1));     // circumferential
    }
    if (S % 2 === 0) {
        for (let s = 0; s < S / 2; s++) addBend(idx(1, s), idx(1, s + S / 2), 0);  // diameters across center
    }

    // Triangles, each holding its three edge links (visible iff all alive)
    const tris = []; // {a, b, c, e0, e1, e2}
    const addTri = (a, b, c) => tris.push({
        a, b, c,
        e0: conAt.get(pairKey(a, b)), e1: conAt.get(pairKey(b, c)), e2: conAt.get(pairKey(c, a)),
    });
    for (let s = 0; s < S; s++) addTri(0, idx(1, s + 1), idx(1, s));
    for (let r = 1; r < R; r++) {
        for (let s = 0; s < S; s++) {
            const a = idx(r, s), b = idx(r, s + 1), c = idx(r + 1, s), d = idx(r + 1, s + 1);
            addTri(a, d, c);
            addTri(a, b, d);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const depths = new Float32Array(count);
    geometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1).setUsage(THREE.DynamicDrawUsage));
    const indexArr = new Uint32Array(tris.length * 3);
    geometry.setIndex(new THREE.BufferAttribute(indexArr, 1));

    // Per-fragment darkening: the nonlinear curve is applied after interpolation,
    // giving a smooth logo-like fade even across large stretched triangles.
    const material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
            uColor: { value: new THREE.Color(CONFIG.look.baseColor) },
            uBrightness: { value: CONFIG.look.brightness },
            uDarkenDepth: { value: CONFIG.look.darkenDepth },
            uDarkenPower: { value: CONFIG.look.darkenPower },
            uDarkenStrength: { value: CONFIG.look.darkenStrength },
        },
        vertexShader: /* glsl */`
            attribute float aDepth;
            varying float vDepth;
            void main() {
                vDepth = aDepth;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */`
            uniform vec3 uColor;
            uniform float uBrightness;
            uniform float uDarkenDepth;
            uniform float uDarkenPower;
            uniform float uDarkenStrength;
            varying float vDepth;
            void main() {
                float t = pow(clamp(vDepth / uDarkenDepth, 0.0, 1.0), uDarkenPower);
                float k = 1.0 - t * uDarkenStrength;
                gl_FragColor = vec4(uColor * uBrightness * k, 1.0);
            }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    tiltGroup.add(mesh);

    mem = { R, S, count, home, pos, prev, ringOf, pinned, constraints, structCount, vertexCons,
            jitInvMass, geoInvMass, dampJit, stiffJit, wArr, brokenTouch, brokenCount: 0, spokesBroken: 0,
            needIndexRebuild: false, tearRng: mulberry32(1),
            tris, geometry, mesh, material, depths, indexArr };
    buildJitter();
    rebuildIndex();
    updateColors();
    rebuildDebugOverlay();
}

// Seeded per-vertex / per-link imperfection — nothing in the real world is
// exact. Regenerated live when the imperfection sliders change.
function buildJitter() {
    const imp = CONFIG.imperfection;
    const rng = mulberry32((Math.round(imp.seed) || 1) >>> 0);
    const { count, jitInvMass, dampJit, stiffJit, constraints, structCount } = mem;
    for (let i = 0; i < count; i++) {
        jitInvMass[i] = 1 / (1 + (rng() * 2 - 1) * imp.massJitter);
        stiffJit[i] = 1 + (rng() * 2 - 1) * imp.stiffnessJitter;
        dampJit[i] = 1 + (rng() * 2 - 1) * imp.dampingJitter;
    }
    for (let ci = 0; ci < structCount; ci++) {
        const c = constraints[ci];
        c.tearBase = 1 + (rng() * 2 - 1) * imp.tearJitter;
        if (!c.broken) c.tearScale = c.tearBase;
    }
    cycleRng = mulberry32((Math.round(imp.seed) * 7919 + 101) >>> 0);
}

// Rebuild the triangle index: a triangle renders only while all three of its
// edge links are alive — tears and healing leave a ragged, uneven hole.
function rebuildIndex() {
    const { tris, indexArr, geometry, constraints } = mem;
    let n = 0;
    for (const t of tris) {
        if (constraints[t.e0].broken || constraints[t.e1].broken || constraints[t.e2].broken) continue;
        indexArr[n++] = t.a; indexArr[n++] = t.b; indexArr[n++] = t.c;
    }
    geometry.setDrawRange(0, n);
    geometry.index.needsUpdate = true;
}

// ----------------------------------------------------------------------------
// Ball
// ----------------------------------------------------------------------------
const ballMat = new THREE.MeshBasicMaterial({ color: CONFIG.ball.color });
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), ballMat);
tiltGroup.add(ballMesh);
ballMesh.visible = false;
const ballPos = new THREE.Vector3(); // local (tiltGroup) space

function applyBallLook() {
    ballMesh.scale.setScalar(CONFIG.ball.radius);
    ballMat.color.set(CONFIG.ball.color);
}

// ----------------------------------------------------------------------------
// Contact debug overlay (GUI toggle, off by default): a wireframe sphere at
// the exact visible ball radius, red highlighting of any membrane face whose
// closest point lies inside that radius, and a max-penetration readout.
// With the face–sphere collision pass active the readout should stay at ~0.
// ----------------------------------------------------------------------------
const debugState = { maxPenetration: 0 };
const debugSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#ff3355', wireframe: true, depthTest: false, transparent: true, opacity: 0.8 }));
debugSphere.renderOrder = 2;
debugSphere.visible = false;
tiltGroup.add(debugSphere);
let debugFaceMesh = null;

function rebuildDebugOverlay() {
    if (debugFaceMesh) {
        tiltGroup.remove(debugFaceMesh);
        debugFaceMesh.geometry.dispose();
        debugFaceMesh.material.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', mem.geometry.attributes.position); // shared, live
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(mem.tris.length * 3), 1));
    g.setDrawRange(0, 0);
    debugFaceMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: '#ff3355', side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.55 }));
    debugFaceMesh.renderOrder = 3;
    debugFaceMesh.visible = false;
    debugFaceMesh.frustumCulled = false;
    tiltGroup.add(debugFaceMesh);
}

// Per-frame diagnostic: closest point of every intact face vs the visible
// radius. Highlights penetrating faces and reports the deepest cut.
function updateContactDebug() {
    const on = CONFIG.debug.showContact && ballEngaged && phase === Phase.APPROACH;
    debugSphere.visible = on;
    if (debugFaceMesh) debugFaceMesh.visible = on;
    if (!on) { debugState.maxPenetration = 0; return; }
    debugSphere.position.copy(ballPos);
    debugSphere.scale.setScalar(CONFIG.ball.radius);
    const { pos, tris, constraints } = mem;
    const r = CONFIG.ball.radius;
    const r2 = r * r;
    const cx = ballPos.x, cy = ballPos.y, cz = ballPos.z;
    const idx = debugFaceMesh.geometry.index.array;
    let n = 0, maxPen = 0;
    for (const t of tris) {
        if (constraints[t.e0].broken || constraints[t.e1].broken || constraints[t.e2].broken) continue;
        const ja = t.a * 3, jb = t.b * 3, jc = t.c * 3;
        const ax = pos[ja], ay = pos[ja + 1], az = pos[ja + 2];
        const bx = pos[jb], by = pos[jb + 1], bz = pos[jb + 2];
        const gx = pos[jc], gy = pos[jc + 1], gz = pos[jc + 2];
        if (Math.min(ax, bx, gx) - r > cx || Math.max(ax, bx, gx) + r < cx ||
            Math.min(ay, by, gy) - r > cy || Math.max(ay, by, gy) + r < cy ||
            Math.min(az, bz, gz) - r > cz || Math.max(az, bz, gz) + r < cz) continue;
        closestPointOnTriangle(cx, cy, cz, ax, ay, az, bx, by, bz, gx, gy, gz, _cp);
        const dx = _cp.x - cx, dy = _cp.y - cy, dz = _cp.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (!(d2 < r2)) continue;
        const pen = r - Math.sqrt(d2);
        if (pen > maxPen) maxPen = pen;
        idx[n++] = t.a; idx[n++] = t.b; idx[n++] = t.c;
    }
    debugState.maxPenetration = maxPen;
    debugFaceMesh.geometry.setDrawRange(0, n);
    debugFaceMesh.geometry.index.needsUpdate = true;
}

// ----------------------------------------------------------------------------
// State machine
// ----------------------------------------------------------------------------
const Phase = { REST: 'rest', APPROACH: 'approach', PIERCED: 'pierced', HEAL: 'heal' };
let phase = Phase.REST;
let phaseTime = 0;
let ballEngaged = false;      // ball drives the physics (contact) this cycle
let ballStuck = false;        // the point has caught the film's center
let healedAt = -1;            // phaseTime when the last link re-knitted
let cycleIndex = 0;
let cycleRng = mulberry32(1); // seeded in buildJitter; drives per-cycle variation

function setPhase(p) { phase = p; phaseTime = 0; if (p === Phase.HEAL) healedAt = -1; }

// Hard reset (boot, GUI restart, failsafe). Normal cycles flow through REST
// without a reset, so residual sway carries over — no two cycles identical.
function restartCycle() {
    mem.pos.set(mem.home);
    mem.prev.set(mem.home);
    for (let ci = 0; ci < mem.structCount; ci++) {
        const c = mem.constraints[ci];
        c.broken = false;
        c.tearScale = c.tearBase;
    }
    mem.brokenTouch.fill(0);
    mem.brokenCount = 0;
    mem.spokesBroken = 0;
    rebuildIndex();
    ballMesh.visible = false;
    ballEngaged = false;
    ballStuck = false;
    setPhase(Phase.REST);
}

// ----------------------------------------------------------------------------
// Physics step (fixed dt, local tiltGroup space; membrane normal = +Y)
// ----------------------------------------------------------------------------
const FIXED_DT = 1 / 120;

// Strain-stiffening J-curve: compliant at low strain, stiff once stretched;
// soft against compression (a film wrinkles rather than resists).
function stiffnessAt(strain, mat) {
    if (strain <= 0) return mat.baseStiffness * mat.compressResist;
    const t = Math.min(1, Math.max(0, (strain - mat.stiffenStart) / Math.max(1e-4, mat.stiffenSpan)));
    return mat.baseStiffness + (mat.maxStiffness - mat.baseStiffness) * Math.pow(t, mat.stiffenPower);
}

// Effective ball collision radius: the visual radius plus a hair-thin margin
// against z-fighting. No sagitta inflation: the face–sphere pass below keeps
// the flat triangles between vertices outside the ball, so vertices may sit
// right on the surface — the funnel tip touches the sphere without a gap.
function ballCollisionRadius() {
    return CONFIG.ball.radius * 1.008;
}

// Closest point on triangle (a,b,c) to point p (Ericson, "Real-Time Collision
// Detection"). Writes the point and its barycentric weights into `out`.
function closestPointOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { out.x = ax; out.y = ay; out.z = az; out.u = 1; out.v = 0; out.w = 0; return; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { out.x = bx; out.y = by; out.z = bz; out.u = 0; out.v = 1; out.w = 0; return; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const t = d1 / (d1 - d3);
        out.x = ax + abx * t; out.y = ay + aby * t; out.z = az + abz * t;
        out.u = 1 - t; out.v = t; out.w = 0; return;
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { out.x = cx; out.y = cy; out.z = cz; out.u = 0; out.v = 0; out.w = 1; return; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const t = d2 / (d2 - d6);
        out.x = ax + acx * t; out.y = ay + acy * t; out.z = az + acz * t;
        out.u = 1 - t; out.v = 0; out.w = t; return;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        out.x = bx + (cx - bx) * t; out.y = by + (cy - by) * t; out.z = bz + (cz - bz) * t;
        out.u = 0; out.v = 1 - t; out.w = t; return;
    }
    const sum = va + vb + vc;
    if (!(sum > 1e-30)) { // degenerate (collapsed/collinear) triangle
        out.x = ax; out.y = ay; out.z = az; out.u = 1; out.v = 0; out.w = 0; return;
    }
    const denom = 1 / sum;
    const v = vb * denom, w = vc * denom;
    out.x = ax + abx * v + acx * w; out.y = ay + aby * v + acy * w; out.z = az + abz * v + acz * w;
    out.u = 1 - v - w; out.v = v; out.w = w;
}

// Face–sphere collision: for each intact triangle near the ball, find its
// closest point to the ball center and, if it lies inside the collision
// radius, push the three vertices out along (closest − center). The push is
// distributed by barycentric weight × inverse mass (PBD projection of the
// distance constraint on the face), so pinned vertices stay put. The vertex
// pass alone leaves the flat triangles between on-surface vertices cutting
// through the ball — this pass is what actually keeps the film outside it.
const _cp = { x: 0, y: 0, z: 0, u: 0, v: 0, w: 0 };
const _faceCand = []; // per-step candidate faces near the ball (reused array)

// Broad-phase cull, once per physics step: only faces whose AABB comes within
// r + slack of the ball center are tested per iteration. The slack absorbs
// vertex movement during the solver iterations of the same step.
function gatherBallFaceCandidates(r) {
    const { pos, tris, constraints } = mem;
    const m = 2 * r;
    const cx = ballPos.x, cy = ballPos.y, cz = ballPos.z;
    _faceCand.length = 0;
    for (const t of tris) {
        if (constraints[t.e0].broken || constraints[t.e1].broken || constraints[t.e2].broken) continue;
        const ja = t.a * 3, jb = t.b * 3, jc = t.c * 3;
        const ax = pos[ja], bx = pos[jb], gx = pos[jc];
        if (Math.min(ax, bx, gx) - m > cx || Math.max(ax, bx, gx) + m < cx) continue;
        const ay = pos[ja + 1], by = pos[jb + 1], gy = pos[jc + 1];
        if (Math.min(ay, by, gy) - m > cy || Math.max(ay, by, gy) + m < cy) continue;
        const az = pos[ja + 2], bz = pos[jb + 2], gz = pos[jc + 2];
        if (Math.min(az, bz, gz) - m > cz || Math.max(az, bz, gz) + m < cz) continue;
        _faceCand.push(t);
    }
}

function collideFacesWithBall(r) {
    const { pos, wArr } = mem;
    const r2 = r * r;
    const cx = ballPos.x, cy = ballPos.y, cz = ballPos.z;
    for (const t of _faceCand) {
        const ja = t.a * 3, jb = t.b * 3, jc = t.c * 3;
        const ax = pos[ja], ay = pos[ja + 1], az = pos[ja + 2];
        const bx = pos[jb], by = pos[jb + 1], bz = pos[jb + 2];
        const gx = pos[jc], gy = pos[jc + 1], gz = pos[jc + 2];
        // Broad phase: sphere vs triangle AABB — cheap reject away from contact
        if (Math.min(ax, bx, gx) - r > cx || Math.max(ax, bx, gx) + r < cx ||
            Math.min(ay, by, gy) - r > cy || Math.max(ay, by, gy) + r < cy ||
            Math.min(az, bz, gz) - r > cz || Math.max(az, bz, gz) + r < cz) continue;
        closestPointOnTriangle(cx, cy, cz, ax, ay, az, bx, by, bz, gx, gy, gz, _cp);
        const dx = _cp.x - cx, dy = _cp.y - cy, dz = _cp.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (!(d2 < r2) || !(d2 > 1e-12)) continue; // negated: also rejects NaN
        const d = Math.sqrt(d2);
        const pen = r - d;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const wa = wArr[t.a], wb = wArr[t.b], wc = wArr[t.c];
        const denom = wa * _cp.u * _cp.u + wb * _cp.v * _cp.v + wc * _cp.w * _cp.w;
        if (denom < 1e-12) continue;
        const s = pen / denom;
        pos[ja] += nx * s * wa * _cp.u; pos[ja + 1] += ny * s * wa * _cp.u; pos[ja + 2] += nz * s * wa * _cp.u;
        pos[jb] += nx * s * wb * _cp.v; pos[jb + 1] += ny * s * wb * _cp.v; pos[jb + 2] += nz * s * wb * _cp.v;
        pos[jc] += nx * s * wc * _cp.w; pos[jc + 1] += ny * s * wc * _cp.w; pos[jc + 2] += nz * s * wc * _cp.w;
    }
}

function homeDist2(i) {
    const j = i * 3;
    const dx = mem.pos[j] - mem.home[j];
    const dy = mem.pos[j + 1] - mem.home[j + 1];
    const dz = mem.pos[j + 2] - mem.home[j + 2];
    return dx * dx + dy * dy + dz * dz;
}

function physicsStep(dt) {
    const mat = CONFIG.material;
    const { pos, prev, pinned, count, constraints, structCount,
            jitInvMass, geoInvMass, dampJit, stiffJit, wArr, brokenTouch, home } = mem;
    const post = phase === Phase.PIERCED || phase === Phase.HEAL;
    const baseKeep = (post ? CONFIG.oscillation.damping : CONFIG.membrane.damping) * mat.damping;
    const gdy = -CONFIG.membrane.gravity * dt * dt;
    const invMassScale = 1 / Math.max(0.05, mat.massScale);

    // Healing home-springs grow over the heal ramp. Forces, not lerp: the film
    // keeps its inertia, overshoots the rest plane and rings while closing.
    let healK = 0;
    if (phase === Phase.HEAL) {
        const ramp = Math.min(1, phaseTime / Math.max(0.01, CONFIG.rupture.healDuration));
        healK = mat.healSpring * ramp * ramp;
    }

    // Verlet integration: per-vertex damping (+ home springs on torn vertices)
    const vCap = 8 * dt; // global speed limit (units/step) — keeps flaps sane
    for (let i = 0; i < count; i++) {
        if (pinned[i]) { wArr[i] = 0; continue; }
        wArr[i] = jitInvMass[i] * geoInvMass[i] * invMassScale;
        const j = i * 3;
        const keep = Math.min(1, Math.max(0.85, 1 - (1 - baseKeep) * dampJit[i]));
        let vx = (pos[j] - prev[j]) * keep;
        let vy = (pos[j + 1] - prev[j + 1]) * keep;
        let vz = (pos[j + 2] - prev[j + 2]) * keep;
        const v2 = vx * vx + vy * vy + vz * vz;
        if (v2 > vCap * vCap) { const f = vCap / Math.sqrt(v2); vx *= f; vy *= f; vz *= f; }
        let ax = 0, ay = gdy, az = 0;
        if (healK > 0 && brokenTouch[i] > 0) {
            const s = healK * wArr[i] * dt * dt;
            ax += (home[j] - pos[j]) * s;
            ay += (home[j + 1] - pos[j + 1]) * s;
            az += (home[j + 2] - pos[j + 2]) * s;
        }
        prev[j] = pos[j]; prev[j + 1] = pos[j + 1]; prev[j + 2] = pos[j + 2];
        pos[j] += vx + ax; pos[j + 1] += vy + ay; pos[j + 2] += vz + az;
        // Leash: no shred of film strays further than ~a radius from home
        const lx = pos[j] - home[j], ly = pos[j + 1] - home[j + 1], lz = pos[j + 2] - home[j + 2];
        const l2 = lx * lx + ly * ly + lz * lz;
        const maxD = 3.4;
        if (l2 > maxD * maxD) {
            const f = maxD / Math.sqrt(l2);
            pos[j] = home[j] + lx * f; pos[j + 1] = home[j + 1] + ly * f; pos[j + 2] = home[j + 2] + lz * f;
        }
    }

    // Ball motion + contact. The film both collides with and adheres to the
    // sphere (`grip`): the contact zone wraps the leading hemisphere, so the
    // ball first sinks into a dimple; free tension arcs start past its edge.
    if (ballEngaged) {
        const step = CONFIG.ball.speed * dt;
        ballPos.y -= step;
        if (phase === Phase.APPROACH) {
            const r = ballCollisionRadius();
            const r2 = r * r;
            // Once the point reaches the center vertex, that contact holds
            // (the point presses the film in front of it) until punch-through.
            if (!ballStuck && ballPos.y - r <= pos[1]) ballStuck = true;
            if (ballStuck) {
                pos[0] = prev[0] = ballPos.x;
                pos[1] = prev[1] = ballPos.y - r;
                pos[2] = prev[2] = ballPos.z;
                wArr[0] = 0;
            }
            const grip = mat.grip;
            for (let i = 1; i < count; i++) {
                if (pinned[i]) continue;
                const j = i * 3;
                const dx = pos[j] - ballPos.x;
                const dy = pos[j + 1] - ballPos.y;
                const dz = pos[j + 2] - ballPos.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < r2 && d2 > 1e-12) {
                    const d = Math.sqrt(d2);
                    const k = r / d;
                    pos[j] = ballPos.x + dx * k;
                    pos[j + 1] = ballPos.y + dy * k;
                    pos[j + 2] = ballPos.z + dz * k;
                    if (grip > 0) {
                        // Adhesion, strongest at the leading pole: blend the
                        // vertex velocity toward co-moving with the ball.
                        const stick = grip * Math.max(0, -dy / d);
                        prev[j] += (pos[j] - prev[j]) * stick;
                        prev[j + 1] += (pos[j + 1] + step - prev[j + 1]) * stick;
                        prev[j + 2] += (pos[j + 2] - prev[j + 2]) * stick;
                    }
                }
            }
        }
    }

    // Cache per-link stiffness from current strain (once per step): near the
    // ball the film is strained and stiff, near the rim slack and compliant →
    // the profile bows in arcs instead of a straight cone.
    for (let ci = 0; ci < constraints.length; ci++) {
        const c = constraints[ci];
        if (c.bend) {
            c.k = (constraints[c.h0].broken || constraints[c.h1].broken)
                ? 0 : Math.min(1, mat.bendStiffness * c.gw) * 0.5 * (stiffJit[c.a] + stiffJit[c.b]);
            continue;
        }
        if (c.broken) { c.k = 0; continue; }
        const ja = c.a * 3, jb = c.b * 3;
        const dx = pos[jb] - pos[ja];
        const dy = pos[jb + 1] - pos[ja + 1];
        const dz = pos[jb + 2] - pos[ja + 2];
        const strain = (Math.hypot(dx, dy, dz) - c.rest) / c.rest;
        c.k = Math.min(1, stiffnessAt(strain, mat) * c.gw) * 0.5 * (stiffJit[c.a] + stiffJit[c.b]);
    }

    // Constraint relaxation (PBD distance constraints, inverse-mass weighted).
    // The sphere is re-asserted as a hard collision constraint after every
    // iteration: first a cheap vertex pass, then a face–sphere pass that keeps
    // the flat triangles between vertices from cutting inside the visible
    // ball. The distance solver keeps pulling vertices back toward rest and
    // would let them sink through the ball, so both passes run each iteration.
    // This is what makes the film actually wrap the leading hemisphere at the
    // contact point instead of the sphere showing through the intact film.
    const iters = Math.max(1, Math.round(CONFIG.membrane.iterations));
    const ballContact = ballEngaged && phase === Phase.APPROACH;
    const ballR = ballCollisionRadius();
    const ballR2 = ballR * ballR;
    if (ballContact) gatherBallFaceCandidates(ballR);
    for (let it = 0; it < iters; it++) {
        for (const c of constraints) {
            if (c.k === 0) continue;
            const ja = c.a * 3, jb = c.b * 3;
            const dx = pos[jb] - pos[ja];
            const dy = pos[jb + 1] - pos[ja + 1];
            const dz = pos[jb + 2] - pos[ja + 2];
            const d = Math.hypot(dx, dy, dz);
            if (d < 1e-9) continue;
            if (c.bend && d >= c.rest) continue; // bend links only resist folding
            const wa = wArr[c.a], wb = wArr[c.b];
            const ws = wa + wb;
            if (ws === 0) continue;
            const diff = ((d - c.rest) / d) * c.k / ws;
            const ox = dx * diff, oy = dy * diff, oz = dz * diff;
            pos[ja] += ox * wa; pos[ja + 1] += oy * wa; pos[ja + 2] += oz * wa;
            pos[jb] -= ox * wb; pos[jb + 1] -= oy * wb; pos[jb + 2] -= oz * wb;
        }
        if (ballContact) {
            for (let i = 1; i < count; i++) {
                if (pinned[i]) continue;
                const j = i * 3;
                const dx = pos[j] - ballPos.x;
                const dy = pos[j + 1] - ballPos.y;
                const dz = pos[j + 2] - ballPos.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < ballR2 && d2 > 1e-12) {
                    const push = ballR / Math.sqrt(d2);
                    pos[j] = ballPos.x + dx * push;
                    pos[j + 1] = ballPos.y + dy * push;
                    pos[j + 2] = ballPos.z + dz * push;
                }
            }
            collideFacesWithBall(ballR);
        }
    }
    // Final contact polish: neighbouring faces re-penetrate slightly when one
    // face's vertices are pushed, so run a few extra face passes after the
    // solver — what remains at render time is what the eye sees.
    if (ballContact) {
        for (let k = 0; k < 3; k++) collideFacesWithBall(ballR);
    }

    // Tearing: a link snaps when its strain exceeds the material threshold
    // (jittered per link, weakened by cascade). Where and when it tears is a
    // property of the material, not a scripted depth.
    if (phase === Phase.APPROACH || phase === Phase.PIERCED) {
        const tearAt = mat.tearStrain;
        for (let ci = 0; ci < structCount; ci++) {
            const c = constraints[ci];
            if (c.broken) continue;
            const ja = c.a * 3, jb = c.b * 3;
            const dx = pos[jb] - pos[ja];
            const dy = pos[jb + 1] - pos[ja + 1];
            const dz = pos[jb + 2] - pos[ja + 2];
            const strain = (Math.hypot(dx, dy, dz) - c.rest) / c.rest;
            if (strain > tearAt * c.tearScale) snapConstraint(ci, strain, dt);
        }
    }

    // Re-knitting: a torn link heals only when both of its ends have actually
    // come home — the hole closes unevenly, licking shut from all sides.
    if (phase === Phase.HEAL && mem.brokenCount > 0) {
        const snap2 = mat.healSnap * mat.healSnap;
        for (let ci = 0; ci < structCount; ci++) {
            const c = constraints[ci];
            if (!c.broken) continue;
            if (homeDist2(c.a) > snap2 || homeDist2(c.b) > snap2) continue;
            c.broken = false;
            c.tearScale = c.tearBase;
            brokenTouch[c.a]--; brokenTouch[c.b]--;
            if (c.spoke) mem.spokesBroken--;
            mem.brokenCount--;
            mem.needIndexRebuild = true;
        }
        if (mem.brokenCount === 0) healedAt = phaseTime;
    }
}

// ----------------------------------------------------------------------------
// Tear mechanics: snap, cascade, recoil
// ----------------------------------------------------------------------------
function snapConstraint(ci, strain, dt) {
    const { constraints, vertexCons, brokenTouch, pos } = mem;
    const mat = CONFIG.material;
    const c = constraints[ci];
    c.broken = true;
    brokenTouch[c.a]++; brokenTouch[c.b]++;
    if (c.spoke) mem.spokesBroken++;
    mem.brokenCount++;
    mem.needIndexRebuild = true;

    // Cascade: a snap overloads the neighbours — their thresholds drop.
    for (const ni of vertexCons[c.a]) {
        const n = constraints[ni];
        if (!n.broken) n.tearScale = Math.max(0.3, n.tearScale * mat.tearCascade);
    }
    for (const ni of vertexCons[c.b]) {
        const n = constraints[ni];
        if (!n.broken) n.tearScale = Math.max(0.3, n.tearScale * mat.tearCascade);
    }

    // Recoil: the stored stretch snaps both ends apart, with seeded noise —
    // the hole's edges flap back unevenly.
    const ja = c.a * 3, jb = c.b * 3;
    const dx = pos[jb] - pos[ja];
    const dy = pos[jb + 1] - pos[ja + 1];
    const dz = pos[jb + 2] - pos[ja + 2];
    const d = Math.hypot(dx, dy, dz) || 1;
    const mag = mat.recoil * Math.max(0, strain);
    kick(c.a, -dx / d, -dy / d, -dz / d, mag, dt);
    kick(c.b, dx / d, dy / d, dz / d, mag, dt);
}

// Add an impulse (velocity change) to a vertex, with seeded magnitude noise
// and a random sideways component.
function kick(i, ux, uy, uz, mag, dt) {
    if (mem.pinned[i]) return;
    const rng = mem.tearRng;
    const noise = CONFIG.imperfection.recoilNoise;
    const w = mem.jitInvMass[i] * mem.geoInvMass[i] / Math.max(0.05, CONFIG.material.massScale);
    const g = mag * (1 + noise * (rng() * 2 - 1));
    let px = rng() * 2 - 1, py = rng() * 2 - 1, pz = rng() * 2 - 1;
    const dot = px * ux + py * uy + pz * uz;
    px -= dot * ux; py -= dot * uy; pz -= dot * uz;
    const pl = Math.hypot(px, py, pz) || 1;
    const s = mag * noise * rng();
    let vx = (ux * g + (px / pl) * s) * w;
    let vy = (uy * g + (py / pl) * s) * w;
    let vz = (uz * g + (pz / pl) * s) * w;
    const vl = Math.hypot(vx, vy, vz);
    const vMax = 5; // safety cap: light hole-edge vertices must not explode
    if (vl > vMax) { const f = vMax / vl; vx *= f; vy *= f; vz *= f; }
    const j = i * 3;
    mem.prev[j] -= vx * dt;
    mem.prev[j + 1] -= vy * dt;
    mem.prev[j + 2] -= vz * dt;
}

// Failsafe: if the material is too tough to tear by strain before `maxDepth`,
// rip the innermost region so the cycle always completes.
function forceTear(dt) {
    const { constraints, structCount, ringOf, pos } = mem;
    for (let ci = 0; ci < structCount; ci++) {
        const c = constraints[ci];
        if (c.broken) continue;
        if (Math.min(ringOf[c.a], ringOf[c.b]) < 2) {
            const ja = c.a * 3, jb = c.b * 3;
            const dx = pos[jb] - pos[ja];
            const dy = pos[jb + 1] - pos[ja + 1];
            const dz = pos[jb + 2] - pos[ja + 2];
            const strain = (Math.hypot(dx, dy, dz) - c.rest) / c.rest;
            snapConstraint(ci, Math.max(0.5, strain), dt);
        }
    }
}

// ----------------------------------------------------------------------------
// Stretch-based darkening: deeper deflection → darker, as on the logo —
// bright rim, near-black funnel tip. Depth per vertex, curve per fragment.
// ----------------------------------------------------------------------------
function updateColors() {
    const { pos, home, depths, count, geometry, material } = mem;
    for (let i = 0; i < count; i++) {
        const j = i * 3;
        const dx = pos[j] - home[j];
        const dy = pos[j + 1] - home[j + 1];
        const dz = pos[j + 2] - home[j + 2];
        depths[i] = Math.hypot(dx, dy, dz);
    }
    geometry.attributes.aDepth.needsUpdate = true;
    material.uniforms.uColor.value.set(CONFIG.look.baseColor);
    material.uniforms.uBrightness.value = CONFIG.look.brightness;
    material.uniforms.uDarkenDepth.value = CONFIG.look.darkenDepth;
    material.uniforms.uDarkenPower.value = CONFIG.look.darkenPower;
    material.uniforms.uDarkenStrength.value = CONFIG.look.darkenStrength;
}

// ----------------------------------------------------------------------------
// Main loop
// ----------------------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();

function tick(now) {
    requestAnimationFrame(tick);
    const rawDt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    const dt = rawDt * CONFIG.timing.timeScale;
    accumulator += dt;
    phaseTime += dt;

    while (accumulator >= FIXED_DT) {
        accumulator -= FIXED_DT;
        physicsStep(FIXED_DT);

        if (phase === Phase.APPROACH) {
            // Punch-through: enough of the center has let go — the point passes.
            if (mem.spokesBroken >= mem.S * 0.5 || mem.brokenCount >= mem.S * 2) {
                ballStuck = false;
                setPhase(Phase.PIERCED);
            } else if (-mem.pos[1] >= CONFIG.rupture.maxDepth) {
                forceTear(FIXED_DT); // failsafe for materials too tough to tear
                ballStuck = false;
                setPhase(Phase.PIERCED);
            }
        } else if (phase === Phase.PIERCED) {
            if (phaseTime >= CONFIG.rupture.healDelay) setPhase(Phase.HEAL);
        }
    }
    if (mem.needIndexRebuild) { rebuildIndex(); mem.needIndexRebuild = false; }

    // Phase transitions driven by wall-clock phase time
    if (phase === Phase.REST && phaseTime >= CONFIG.timing.restPause) {
        const ang = cycleRng() * Math.PI * 2;
        const off = CONFIG.imperfection.entryOffset * (0.25 + 0.75 * cycleRng());
        ballPos.set(Math.cos(ang) * off, CONFIG.ball.startHeight, Math.sin(ang) * off);
        ballEngaged = true;      // physics runs and the sphere is drawn as it falls
        ballMesh.visible = true;  // the film now wraps it, so it stays visible from any angle
        cycleIndex++;
        mem.tearRng = mulberry32(((Math.round(CONFIG.imperfection.seed) * 2654435761) ^ (cycleIndex * 40503)) >>> 0);
        setPhase(Phase.APPROACH);
    } else if (phase === Phase.PIERCED || phase === Phase.HEAL) {
        if (ballEngaged && ballPos.y < -CONFIG.ball.exitDistance) {
            ballMesh.visible = false;
            ballEngaged = false;
        }
        if (phase === Phase.HEAL) {
            const healed = mem.brokenCount === 0 && healedAt >= 0;
            if (healed && !ballMesh.visible && phaseTime - healedAt >= CONFIG.oscillation.settleTime) {
                setPhase(Phase.REST); // no reset: residual sway carries into the next cycle
            } else if (phaseTime > CONFIG.rupture.healDuration * 4 + CONFIG.oscillation.settleTime) {
                restartCycle(); // failsafe if some link never made it home
            }
        }
    }

    if (ballEngaged) ballMesh.position.copy(ballPos);
    mem.geometry.attributes.position.needsUpdate = true;
    updateColors();
    updateContactDebug();
    renderer.render(scene, camera);
}

// ----------------------------------------------------------------------------
// GUI (press H to toggle)
// Schema-driven: every tunable is declared once with its range and apply hook.
// The same schema powers the controllers, per-section/global randomization,
// randomize-locks and config copy/paste.
// ----------------------------------------------------------------------------
const PARAM_SCHEMA = [
    { id: 'scene', title: 'scene / camera', obj: () => CONFIG.scene, params: [
        { key: 'cameraFov', min: 15, max: 90, step: 1, apply: applyCamera },
        { key: 'cameraDistance', min: 2, max: 20, step: 0.1, apply: applyCamera },
        { key: 'cameraHeight', min: -5, max: 5, step: 0.05, apply: applyCamera },
        { key: 'lookAtY', min: -4, max: 4, step: 0.05, apply: applyCamera },
        { key: 'membraneTilt', min: -80, max: 80, step: 1, apply: applyTilt },
        { key: 'background', color: true, apply: applyCamera },
    ] },
    { id: 'membrane', title: 'membrane mesh / solver', obj: () => CONFIG.membrane, params: [
        { key: 'radius', min: 0.5, max: 4, step: 0.05, rebuild: true },
        { key: 'rings', min: 6, max: 60, step: 1, rebuild: true },
        { key: 'segments', min: 12, max: 128, step: 1, rebuild: true },
        { key: 'iterations', min: 1, max: 20, step: 1 },
        { key: 'damping', min: 0.9, max: 1, step: 0.001 },
        { key: 'gravity', min: 0, max: 5, step: 0.05 },
    ] },
    { id: 'material', title: 'material', obj: () => CONFIG.material, markCustom: true, params: [
        { key: 'baseStiffness', min: 0.005, max: 1, step: 0.005 },
        { key: 'stiffenStart', min: 0, max: 1, step: 0.01 },
        { key: 'stiffenSpan', min: 0.05, max: 2, step: 0.01 },
        { key: 'stiffenPower', min: 0.5, max: 4, step: 0.05 },
        { key: 'maxStiffness', min: 0.05, max: 1, step: 0.01 },
        { key: 'compressResist', min: 0, max: 1, step: 0.01 },
        { key: 'bendStiffness', min: 0, max: 0.5, step: 0.005 },
        { key: 'damping', min: 0.95, max: 1, step: 0.0005 },
        { key: 'massScale', min: 0.3, max: 3, step: 0.05 },
        { key: 'grip', min: 0, max: 1, step: 0.01 },
        { key: 'tearStrain', min: 0.1, max: 9, step: 0.05 },
        { key: 'tearCascade', min: 0.3, max: 1, step: 0.01 },
        { key: 'recoil', min: 0, max: 2, step: 0.01 },
        { key: 'healSpring', min: 1, max: 60, step: 0.5 },
        { key: 'healSnap', min: 0.02, max: 0.4, step: 0.005 },
    ] },
    { id: 'ball', title: 'ball', obj: () => CONFIG.ball, params: [
        { key: 'radius', min: 0.02, max: 0.5, step: 0.01, apply: applyBallLook },
        { key: 'startHeight', min: 0.5, max: 8, step: 0.1 },
        { key: 'speed', min: 0.05, max: 3, step: 0.01 },
        { key: 'exitDistance', min: 1, max: 10, step: 0.1 },
        { key: 'color', color: true, apply: applyBallLook },
    ] },
    { id: 'rupture', title: 'rupture / healing', obj: () => CONFIG.rupture, params: [
        { key: 'maxDepth', min: 0.5, max: 4, step: 0.05 },
        { key: 'healDelay', min: 0, max: 5, step: 0.1 },
        { key: 'healDuration', min: 0.5, max: 10, step: 0.1 },
    ] },
    { id: 'oscillation', title: 'oscillation', obj: () => CONFIG.oscillation, params: [
        { key: 'damping', min: 0.85, max: 1, step: 0.0005 },
        { key: 'settleTime', min: 0, max: 10, step: 0.1 },
    ] },
    { id: 'imperfection', title: 'imperfection', obj: () => CONFIG.imperfection, params: [
        { key: 'seed', min: 1, max: 9999, step: 1, applyFinish: buildJitter },
        { key: 'massJitter', min: 0, max: 0.3, step: 0.005, applyFinish: buildJitter },
        { key: 'stiffnessJitter', min: 0, max: 0.3, step: 0.005, applyFinish: buildJitter },
        { key: 'dampingJitter', min: 0, max: 0.5, step: 0.01, applyFinish: buildJitter },
        { key: 'tearJitter', min: 0, max: 0.5, step: 0.01, applyFinish: buildJitter },
        { key: 'entryOffset', min: 0, max: 0.4, step: 0.005 },
        { key: 'recoilNoise', min: 0, max: 1, step: 0.01 },
    ] },
    { id: 'look', title: 'look', obj: () => CONFIG.look, params: [
        { key: 'baseColor', color: true },
        { key: 'darkenDepth', min: 0.2, max: 4, step: 0.05 },
        { key: 'darkenPower', min: 0.3, max: 4, step: 0.05 },
        { key: 'darkenStrength', min: 0, max: 1, step: 0.01 },
        { key: 'brightness', min: 0.2, max: 2, step: 0.01 },
    ] },
    { id: 'timing', title: 'timing', obj: () => CONFIG.timing, params: [
        { key: 'timeScale', min: 0.05, max: 3, step: 0.05 },
        { key: 'restPause', min: 0, max: 5, step: 0.1 },
    ] },
];

// Randomize-locks. A lock only excludes a parameter (or a whole section) from
// randomization and config paste — manual editing always stays available.
const randLocks = new Set();
const lockButtons = new Map(); // lock key → toggle element
function isLocked(secId, key) {
    return randLocks.has(secId) || (key !== undefined && randLocks.has(`${secId}.${key}`));
}
function makeLockToggle(lockKey, what) {
    const el = document.createElement('span');
    el.className = 'rand-lock';
    const sync = () => {
        const locked = randLocks.has(lockKey);
        el.textContent = locked ? '\u{1F512}' : '\u{1F3B2}';
        el.classList.toggle('locked', locked);
        el.title = locked
            ? `${what} is LOCKED: excluded from randomize / paste (click to include)`
            : `${what} is randomizable (click to lock: exclude from randomize / paste)`;
    };
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (randLocks.has(lockKey)) randLocks.delete(lockKey); else randLocks.add(lockKey);
        sync();
    });
    sync();
    lockButtons.set(lockKey, { el, sync });
    return el;
}
function syncLockButtons() { for (const { sync } of lockButtons.values()) sync(); }

function randomValueFor(p) {
    if (p.color) {
        const c = new THREE.Color().setHSL(Math.random(), 0.4 + 0.6 * Math.random(), 0.25 + 0.5 * Math.random());
        return `#${c.getHexString()}`;
    }
    let v = p.min + Math.random() * (p.max - p.min);
    if (p.step) v = p.min + Math.round((v - p.min) / p.step) * p.step;
    return Math.min(p.max, Math.max(p.min, v));
}

function buildGUI() {
    const gui = new GUI({ title: 'membrane lab' });
    injectGuiStyles();
    let presetCtrl = null;

    // Runs the apply hooks after a batch change (randomize / paste): rebuild
    // once if any structural parameter changed, then refresh everything else.
    const structSnapshot = () => [CONFIG.membrane.radius, CONFIG.membrane.rings, CONFIG.membrane.segments].join('|');
    function applyBatch(before) {
        if (structSnapshot() !== before) restartAll(); // buildMembrane re-seeds jitter too
        else buildJitter();
        applyCamera(); applyTilt(); applyBallLook();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        syncLockButtons();
    }

    function randomizeSections(sections) {
        const before = structSnapshot();
        for (const sec of sections) {
            if (randLocks.has(sec.id)) continue;
            let touched = false;
            for (const p of sec.params) {
                if (isLocked(sec.id, p.key)) continue;
                sec.obj()[p.key] = randomValueFor(p);
                touched = true;
            }
            if (sec.markCustom && touched) CONFIG.materialPreset = 'custom';
        }
        applyBatch(before);
    }

    function serializeConfig() {
        const out = { materialPreset: CONFIG.materialPreset, locks: [...randLocks].sort() };
        for (const sec of PARAM_SCHEMA) {
            out[sec.id] = {};
            for (const p of sec.params) out[sec.id][p.key] = sec.obj()[p.key];
        }
        return JSON.stringify(out, null, 2);
    }

    // Applies a parsed config: unknown keys are ignored, numbers are clamped
    // to their GUI ranges, and currently locked parameters are left untouched.
    function applyConfigData(data) {
        if (!data || typeof data !== 'object') return;
        const before = structSnapshot();
        for (const sec of PARAM_SCHEMA) {
            const src = data[sec.id];
            if (!src || typeof src !== 'object' || randLocks.has(sec.id)) continue;
            for (const p of sec.params) {
                if (isLocked(sec.id, p.key) || !(p.key in src)) continue;
                const v = src[p.key];
                if (p.color) {
                    if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) sec.obj()[p.key] = v;
                } else if (typeof v === 'number' && Number.isFinite(v)) {
                    sec.obj()[p.key] = Math.min(p.max, Math.max(p.min, v));
                }
            }
        }
        if (typeof data.materialPreset === 'string'
            && (data.materialPreset === 'custom' || MATERIALS[data.materialPreset])) {
            CONFIG.materialPreset = data.materialPreset;
        }
        if (Array.isArray(data.locks)) {
            randLocks.clear();
            for (const k of data.locks) if (typeof k === 'string') randLocks.add(k);
        }
        applyBatch(before);
    }

    async function copyConfig() {
        const json = serializeConfig();
        try {
            await navigator.clipboard.writeText(json);
        } catch {
            window.prompt('Copy the configuration below:', json);
        }
    }

    async function pasteConfig() {
        let text = null;
        try { text = await navigator.clipboard.readText(); } catch { /* blocked → prompt */ }
        if (!text) text = window.prompt('Paste configuration JSON:', '');
        if (!text) return;
        try {
            applyConfigData(JSON.parse(text));
        } catch {
            console.warn('membrane: could not parse pasted configuration');
        }
    }

    // Folder title extras: a dice button (randomize this section now) and a
    // lock toggle (exclude the whole section from randomize / paste).
    function decorateFolder(folder, sec) {
        const dice = document.createElement('span');
        dice.className = 'rand-go';
        dice.textContent = '\u{1F3B2}\u2192';
        dice.title = `randomize "${sec.title}" (unlocked params only)`;
        dice.addEventListener('click', (e) => { e.stopPropagation(); randomizeSections([sec]); });
        folder.$title.appendChild(dice);
        folder.$title.appendChild(makeLockToggle(sec.id, `section "${sec.title}"`));
    }

    for (const sec of PARAM_SCHEMA) {
        const folder = gui.addFolder(sec.title);
        decorateFolder(folder, sec);
        if (sec.markCustom) {
            presetCtrl = folder.add(CONFIG, 'materialPreset', [...Object.keys(MATERIALS), 'custom'])
                .name('preset')
                .onChange((name) => {
                    const p = MATERIALS[name];
                    if (!p) return;
                    Object.assign(CONFIG.material, p);
                    folder.controllers.forEach((ctrl) => ctrl.updateDisplay());
                });
        }
        for (const p of sec.params) {
            const obj = sec.obj();
            const ctrl = p.color
                ? folder.addColor(obj, p.key)
                : folder.add(obj, p.key, p.min, p.max, p.step);
            if (p.apply) ctrl.onChange(p.apply);
            if (p.rebuild) ctrl.onFinishChange(restartAll);
            if (p.applyFinish) ctrl.onFinishChange(p.applyFinish);
            if (sec.markCustom) {
                ctrl.onChange((v) => {
                    CONFIG.materialPreset = 'custom';
                    presetCtrl.updateDisplay();
                    if (p.apply) p.apply(v);
                });
            }
            ctrl.$name.appendChild(makeLockToggle(`${sec.id}.${p.key}`, `"${p.key}"`));
        }
        if (sec.id !== 'material') folder.close();
    }

    // Debug folder — outside PARAM_SCHEMA: never randomized, never pasted.
    const dbg = gui.addFolder('debug');
    dbg.add(CONFIG.debug, 'showContact').name('show contact');
    dbg.add(debugState, 'maxPenetration').name('max face penetration').listen().disable();
    dbg.close();

    gui.add({ 'randomize all': () => randomizeSections(PARAM_SCHEMA) }, 'randomize all');
    gui.add({ 'copy config': copyConfig }, 'copy config');
    gui.add({ 'paste config': pasteConfig }, 'paste config');
    gui.add({ restart: restartAll }, 'restart');

    window.addEventListener('keydown', (e) => {
        if (e.key === 'h' || e.key === 'H') gui.show(gui._hidden);
    });
    return gui;
}

// Visual hierarchy + lock styling. The root "membrane lab" panel contains all
// section folders; child folders are inset with a guide line so the container
// reads as the parent. Lock icons live inline: dice = randomizable, padlock =
// excluded from randomization.
function injectGuiStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .lil-gui.root > .children > .lil-gui {
            margin-left: 10px;
            border-left: 1px solid #3a3a3a;
        }
        .lil-gui .rand-lock, .lil-gui .rand-go {
            margin-left: auto;
            padding: 0 3px;
            cursor: pointer;
            font-size: 11px;
            opacity: 0.55;
            user-select: none;
        }
        .lil-gui .name .rand-lock { float: right; }
        .lil-gui .rand-lock:hover, .lil-gui .rand-go:hover { opacity: 1; }
        .lil-gui .rand-lock.locked { opacity: 1; color: #e0b52e; }
        .lil-gui .title { display: flex; align-items: center; }
        .lil-gui .title .rand-go { margin-left: auto; }
        .lil-gui .title .rand-lock { margin-left: 0; }
    `;
    document.head.appendChild(style);
}

function restartAll() {
    buildMembrane();
    restartCycle();
}

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

applyCamera();
applyTilt();
applyBallLook();
buildMembrane();
restartCycle();
const gui = buildGUI();
requestAnimationFrame(tick);

// Console handle for quick tweaking: MEMBRANE.CONFIG.…, MEMBRANE.restart()
window.MEMBRANE = { CONFIG, MATERIALS, gui, restart: restartAll, get phase() { return phase; }, get mem() { return mem; }, get ballPos() { return ballPos; } };
