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
//
// Iteration 3 — contact quality:
//   • center-densified rings (power-law radial distribution) → the contact
//     patch has enough resolution to actually wrap the sphere
//   • sticky adhesion contacts: vertices latch onto fixed spots on the sphere
//     (bilateral PBD projection) and detach only when tension exceeds
//     `adhesionStrength` → the film clings and follows the ball's shape
//   • bend links relax inside the contact patch so the film can take the
//     sphere's curvature
//   • avalanche release at rupture: the first tear in the patch pops every
//     sticky contact at once with a recoil impulse → a sharp, snappy burst
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
        damping: 0.99992,      // internal velocity keep-factor (very near-1 → near-lossless sway)
        massScale: 1.0,        // node inertia vs impulses (recoil, heal springs)
        grip: 0.6,             // tangential drag on non-stuck contact vertices 0..1
        adhesionStrength: 0.14, // sticky-contact detach threshold (drift, units); 0 = no sticking — strong cling: the film drapes the sphere instead of slipping off, so the pre-burst stretch runs deep (~2.5)
        adhesionZone: 0.8,     // fraction of the leading hemisphere where vertices may latch on
        tearStrain: 11,        // strain that snaps a link — paired with the stronger adhesion this puts the natural spoke-avalanche burst at ~2.5 depth
        tearCascade: 0.8,      // neighbour threshold multiplier after a snap (unzip)
        recoil: 0.55,          // snap-back impulse per unit strain
        healSpring: 14,        // home-spring stiffness at full heal ramp (1/s²)
        healSnap: 0.12,        // re-knit distance from rest position
    },
    rubber: {
        baseStiffness: 0.10, stiffenStart: 0.05, stiffenSpan: 0.40, stiffenPower: 1.7,
        maxStiffness: 0.97, compressResist: 0.30, bendStiffness: 0.07, damping: 0.997,
        massScale: 1.5, grip: 0.5, adhesionStrength: 0.035, adhesionZone: 0.6,
        tearStrain: 2.6, tearCascade: 0.8, recoil: 0.45,
        healSpring: 18, healSnap: 0.12,
    },
    silicone: {
        baseStiffness: 0.06, stiffenStart: 0.12, stiffenSpan: 0.70, stiffenPower: 1.5,
        maxStiffness: 0.90, compressResist: 0.25, bendStiffness: 0.05, damping: 0.985,
        massScale: 1.2, grip: 0.85, adhesionStrength: 0.09, adhesionZone: 0.95,
        tearStrain: 3.4, tearCascade: 0.85, recoil: 0.3,
        healSpring: 10, healSnap: 0.14,
    },
    film: { // polyethylene: stiff from the start, near-cone, tears sharply
        baseStiffness: 0.65, stiffenStart: 0.0, stiffenSpan: 0.12, stiffenPower: 1.0,
        maxStiffness: 0.99, compressResist: 0.50, bendStiffness: 0.01, damping: 0.996,
        massScale: 0.8, grip: 0.2, adhesionStrength: 0.008, adhesionZone: 0.25,
        tearStrain: 1.3, tearCascade: 0.7, recoil: 0.9,
        healSpring: 22, healSnap: 0.10,
    },
    spandex: { // fabric: floppy, folds freely, almost never tears by strain
        baseStiffness: 0.02, stiffenStart: 0.25, stiffenSpan: 0.90, stiffenPower: 2.0,
        maxStiffness: 0.80, compressResist: 0.05, bendStiffness: 0.005, damping: 0.997,
        massScale: 0.9, grip: 0.7, adhesionStrength: 0.06, adhesionZone: 0.85,
        tearStrain: 7.0, tearCascade: 0.9, recoil: 0.4,
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
        membraneTilt: -20,        // deg; matched to the logo rim ellipse aspect (~2.97 w/h)
    },
    membrane: {
        radius: 1.6,              // disc radius
        rings: 34,                // radial resolution
        segments: 56,             // angular resolution
        centerDensity: 2.0,       // ring distribution exponent: 1 = uniform, >1 packs rings toward the center (contact patch)
        iterations: 6,            // constraint solver iterations
        damping: 0.996,           // velocity keep-factor before rupture (× material damping)
        gravity: 0.0,             // optional sag (units/s², along -normal)
    },
    materialPreset: 'latex',
    material: { ...MATERIALS.latex }, // live-editable copy (edited sliders → "custom")
    ball: {
        radius: 0.10,
        startHeight: 8,           // spawn height above the film (along +normal)
        speed: 0.72,              // units/s along -normal (slow, comet-like) — cruise speed near the film
        startBoost: 8.0,          // launch speed multiplier ("thrown drop"): ×speed at spawn, decays to 1× while falling
        boostFadeEnd: 0.0,        // height above the film (units) where the boost has fully decayed to cruise speed
        boostCurve: 2.5,          // decay shape: 1 = linear, >1 = keeps speed longer and brakes harder near the end
        exitDistance: 10.0,       // despawn this far below the film — large enough so the ball keeps falling until it's clearly off-screen
        capWrap: 0.0,             // fraction of the ball's footprint kept on the sphere surface (with slip). 0 = off — natural drape via collision + tension
        centerPin: false,         // hard-pin the film's center vertex to the ball's leading pole. OFF: the film drapes the sphere naturally — the tip mirrors the ball instead of pinching into the pole point
        color: '#05b2d3',         // matches the sphere as drawn in the logo art
    },
    // rupture.maxDepth is a hard failsafe. With tougher material we need more room to stretch
    // before the failsafe fires or the depth-limit tears prematurely.

    rupture: {
        maxDepth: 3.4,            // failsafe: force-tear if the centre ever gets this deep
        healDelay: 1.2,           // s after rupture before healing starts (ignored in oneShot)
        healDuration: 3.0,        // s for the home-springs to reach full strength (ignored in oneShot)
    },
    oscillation: {
        damping: 0.99995,         // post-rupture damping (very near-1 → sustained sloshing)
        settleTime: 5.0,          // s of oscillation after full re-knit before the next cycle (unused in oneShot)
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
        baseColor: '#1bd0e4',     // film color at rest / at the rim — matches the logo art
        darkenDepth: 1.9,         // deflection at which darkening saturates
        darkenPower: 0.7,         // curve exponent (higher = darkening stays near tip)
        darkenStrength: 0.78,     // 0..1 max darkening at full stretch — capped below 1 so the tip stays a deep blue, never a vanishing black hole
        brightness: 1.0,          // global film brightness multiplier
        alphaMode: 0,             // 0 = RGB darken (the classic logo look), 1 = alpha drop (experiment — abandoned: reads ambiguously)
    },
    timing: {
        timeScale: 1.0,           // global slow-motion factor
        restPause: 0.0,           // the drop is falling from the very first frame — no calm pause
        restartPause: 0.0,        // manual restart: also instant
    },
    debug: {
        showContact: false,       // wireframe contact sphere + penetrating faces in red
    },
    // ------------------------------------------------------------------------
    // INTRO ATTRACTOR (dev)
    // Pulls every membrane node toward a target funnel shape — the static
    // logo silhouette. Activated after the ball punches through: instead of
    // healing back to flat, the film settles into the logo funnel.
    // ------------------------------------------------------------------------
    intro: {
        enabled: true,            // master switch for the attractor machinery (physics hook + manual snap)
        endAttractor: false,      // engage the attractor at the very end of parking. OFF: the film keeps free physics to the last frame
        endAttractorLead: 1.6,    // s before landing when the attractor starts ramping in (covers attractorRamp)
        attractorRamp: 1.2,       // s to ramp attractor strength from 0 → full
        strength: 32,             // full attractor spring constant (1/s^2)
        damping: 0.965,           // node damping during attract mode (kills residual sway)
        funnelDepth: 1.7,         // depth of the funnel neck (units along -Y) — matched to the logo art (tip ≈ half the rim width below the rim)
        funnelNeckRadius: 0.06,   // radius (units) of the funnel bottom before it goes vertical
        funnelSharpness: 1.4,     // curve exponent — measured from the logo art profile (≈1.2–1.35)
        funnelRimFlat: 0.05,      // fraction of radius that stays near-flat before the drop begins
        oneShot: true,            // after the ball leaves the frame, block any new drop — restart requires the user
        // -- static start framing (computed ONCE in zoomInit, camera does not move until parking) --
        edgePadFrac: 0.03,        // safety pad (fraction of the SHORT viewport side) around the physics envelope
        envDownFrac: 1.0,         // fraction of rupture.maxDepth reserved BELOW the rim (down-stretch)
        envUpUnits: 2.0,          // world units reserved ABOVE the rim plane for the post-pierce upswing (measured peak ≈1.9 before parking)
        // === CAMERA / PARKING (event-anchored timeline) ===
        // Three phases:
        //   1. FLIGHT (variable length — depends on viewport height): ball falls,
        //      touches the film, stretches it. Camera HOLDS at Z0 the whole time.
        //   2. OSCILLATIONS (fixed): pierce → recoil → one FULL upswing. Measured
        //      on the reference run: the upswing peaks ~0.9s after the pierce.
        //   3. PARKING (fixed): starts on the way DOWN from that full upswing, at
        //      pierce + postPierceHold. One symmetric S-curve takes the camera
        //      from Z0 to the logo (Z=1) in sDuration seconds. The film keeps its
        //      free physics all the way; only at the very end (endAttractorLead
        //      before landing) the attractor may grab it — right before fadeout.
        startDrift: 0.015,        // pre-parking camera drift: fraction of zoom shed per second (0.01 = 1%/s). 0 = camera fully static until parking. The drift moves ALONG the parking path (zoom-out only — no mobile crop risk); parking takes over seamlessly from wherever it got to
        startDriftRamp: 0.0,      // s to ease the drift in from standstill. 0 = constant-speed pan from the very first frame
        postPierceHold: 1.05,     // s after the pierce before parking starts — let the film live through a full swing cycle or two
        sDuration: 8.0,           // s — length of the parking S-curve (ends exactly on the logo, p=1)
        sEase: 3,                 // 2..6 — ease exponent (2=quadratic, 3=cubic, 5=smootherstep-like)
        edgePadPx: 1,             // ball spawn: how many px BELOW the top screen edge (visible immediately)
        layoutLiftPx: 11,         // lift of .center-block to balance the logo art's internal top padding
        logoRimWidthFrac: 0.86,   // rim ellipse width as a fraction of the logo image square — hand-tuned compromise: slightly wider than the pixel-measured 0.827 to split the bottom-arc gap (art ellipse is rounder than the film's projection)
        logoRimTopFrac: 0.17,     // rim top edge as a fraction of the logo image square height (pixel-measured 0.1667, hand-tuned)
        crossfade: true,          // after landing the canvas fades OUT while the static logo fades IN (set false for tuning: both layers visible)
        fadeDelay: 0.0,           // s after landing (Z=1) before the crossfade starts
        fadeDuration: 4.32,       // s of the crossfade (3.6 + 20%) — a bit over two full oscillation cycles: the sloshing film dissolves into the static logo
    },
};

// ----------------------------------------------------------------------------
// INTRO ATTRACTOR STATE
// ----------------------------------------------------------------------------
const introState = {
    active: false,        // attractor engaged
    startTime: 0,         // performance.now()/1000 when engaged
    triggeredAt: -1,      // phaseTime of PIERCED at which we scheduled activation
};

// Target funnel profile: depth as a function of normalized radius t = r/R.
// t = 0 at the center, t = 1 at the rim.
// Logo silhouette: wide near-flat rim, then a smooth accelerating drop to a
// deep narrow neck. Depth is returned as a POSITIVE number — the caller
// applies it along -normal.
function funnelDepth(t) {
    const cfg = CONFIG.intro;
    if (t >= 1) return 0;
    if (t <= 0) return cfg.funnelDepth;
    const rimFlat = Math.min(0.95, Math.max(0, cfg.funnelRimFlat)); // 0..1 as fraction of R
    const dropStartT = 1 - rimFlat; // t below this = we are in the drop zone (near center)
    if (t >= dropStartT) {
        // Near the rim: near-flat with a tiny cove so the transition isn't a crease.
        const u = (t - dropStartT) / (1 - dropStartT); // 0 at drop edge, 1 at rim
        return cfg.funnelDepth * 0.03 * (1 - u * u);
    }
    // Drop zone: t in [0, dropStartT] mapped to u in [1, 0] (u=1 at center, u=0 at drop edge)
    const u = 1 - t / Math.max(1e-6, dropStartT);
    // Bias toward deep-at-center with adjustable knee sharpness
    const p = Math.max(0.5, cfg.funnelSharpness);
    return cfg.funnelDepth * Math.pow(u, p);
}

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
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0); // transparent: the landing layout shows through
renderer.domElement.id = 'membrane-canvas';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
    CONFIG.scene.cameraFov, window.innerWidth / window.innerHeight, 0.1, 100);

function applyCamera() {
    camera.fov = CONFIG.scene.cameraFov;
    camera.position.set(0, CONFIG.scene.cameraHeight, CONFIG.scene.cameraDistance);
    camera.lookAt(0, CONFIG.scene.lookAtY, 0);
    // lookAt() refreshes matrixWorldInverse BEFORE applying the new quaternion
    // (three.js quirk): force a recompute so projections done before the first
    // render (boot-time calibration!) don't see a camera without its pitch.
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    scene.background = null; // transparent over the DOM page
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
    const stick = new Uint8Array(count);         // sticky adhesion: vertex latched onto the ball
    const stickBan = new Uint8Array(count);      // detached by force this cycle → no re-latch
    const stickDir = new Float32Array(count * 3); // unit dir (ball center → contact spot)
    const capFlag = new Uint8Array(count);       // leading-cap wrap: vertex stays on the sphere surface (with slip)

    const idx = (ring, seg) => ring === 0 ? 0 : 1 + (ring - 1) * S + ((seg % S + S) % S);

    // Geometric weights. Each vertex owns a share of the disc area and each
    // link a share of the material cross-section it represents. On a polar
    // grid radial "strips" get narrower toward the center (width ∝ r), so
    // strain piles up near a point load (∝ 1/r) — that is what bends the
    // profile into concave arcs. Without these weights every ring strains
    // equally and the deflection is a straight cone regardless of material.
    //
    // Ring radii pack toward the center (`centerDensity` exponent) so the
    // ball's contact patch spans several cells and the film can actually wrap
    // the sphere instead of tenting over it on 1–2 coarse rings. A linear
    // blend keeps the innermost spacing bounded (a pure power law would give
    // microscopic rest lengths → strain blow-ups). All shares/weights are
    // computed from the true (non-uniform) ring radii, so the physics stays
    // homogeneous.
    const cd = Math.max(1, CONFIG.membrane.centerDensity || 1);
    const CD_BLEND = 0.8; // power-law share; (1 - CD_BLEND) linear floor caps center fineness
    const rrOf = (r) => {
        const t = Math.max(0, r) / R;
        return radius * ((1 - CD_BLEND) * t + CD_BLEND * Math.pow(t, cd));
    };
    const dr = radius / R;                                // uniform-grid reference spacing
    const shareRef = 2 * Math.PI * (radius / 2) * dr / S; // mid-disc vertex share
    const gwRef = (2 * Math.PI * (radius / 2) / S) / dr;  // mid-disc radial link

    for (let r = 0; r <= R; r++) {
        if (r === 0) { ringOf[0] = 0; continue; }
        const rr = rrOf(r);
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
        const r = ringOf[i];
        let share;
        if (r === 0) {
            const rOut = rrOf(1) / 2;
            share = Math.PI * rOut * rOut;
        } else {
            const rIn = (rrOf(r - 1) + rrOf(r)) / 2;
            const rOut = r < R ? (rrOf(r) + rrOf(r + 1)) / 2 : rrOf(R);
            share = Math.PI * (rOut * rOut - rIn * rIn) / S;
        }
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
        const rest = restOf(a, b);
        constraints.push({ a, b, rest, broken: false, bend: false, h0: -1, h1: -1,
                           spoke: a === 0 || b === 0, tearBase: 1, tearScale: 1, k: 0,
                           // Tear gauge: strain for tearing is measured over at
                           // least a fraction of the uniform-grid spacing, so
                           // the tiny links of the densified center don't snap
                           // from microscopic absolute displacements.
                           gauge: Math.max(rest, dr * 0.6),
                           gw: Math.min(4, Math.max(0.1, gw)) });
        conAt.set(pairKey(a, b), ci);
        vertexCons[a].push(ci);
        vertexCons[b].push(ci);
    };
    // Cross-section per link type (normalized to a mid-disc radial link):
    // radial ∝ arc width at its mid radius per local ring spacing,
    // circumferential ∝ owned radial extent per arc length, diagonals get the
    // geometric mean with a shear discount. All use the true power-law radii.
    const gwRad = (r) => ((2 * Math.PI * rrOf(r + 0.5) / S) / Math.max(1e-6, rrOf(r + 1) - rrOf(r))) / gwRef;
    const gwCirc = (r) => (((rrOf(Math.min(R, r + 1)) - rrOf(Math.max(0, r - 1))) / 2)
        / (2 * Math.PI * rrOf(r) / S)) / gwRef;
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

    // Physically: the same non-linear curve that used to DARKEN the stretched
    // fabric now DROPS ITS ALPHA. On a dark background this reads the same as
    // darkening (transparent × black = black), but the ball inside the funnel
    // shows through the thin, stretched film instead of being lost in a black
    // core. `darkenDepth/Power/Strength` are re-used as alpha-drop controls.
    const material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: false, // fully OPAQUE: the bright ball must not show through the film,
        depthWrite: true,   // and depth hides the far side of the ring — unambiguous geometry
        uniforms: {
            uColor: { value: new THREE.Color(CONFIG.look.baseColor) },
            uBrightness: { value: CONFIG.look.brightness },
            uDarkenDepth: { value: CONFIG.look.darkenDepth },
            uDarkenPower: { value: CONFIG.look.darkenPower },
            uDarkenStrength: { value: CONFIG.look.darkenStrength },
            uAlphaMode: { value: CONFIG.look.alphaMode },
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
            uniform float uAlphaMode; // 0 = RGB darken (film stays opaque, gets darker), 1 = alpha drop (film goes transparent)
            varying float vDepth;
            void main() {
                // t: 0 at rest, 1 fully stretched.
                float t = pow(clamp(vDepth / uDarkenDepth, 0.0, 1.0), uDarkenPower);
                float fade = 1.0 - t * uDarkenStrength;
                vec3 col = uColor * uBrightness * mix(fade, 1.0, uAlphaMode);
                float a = mix(1.0, fade, uAlphaMode);
                gl_FragColor = vec4(col, a);
            }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1; // draw the membrane AFTER the ball so it blends over
    tiltGroup.add(mesh);

    mem = { R, S, count, home, pos, prev, ringOf, pinned, constraints, structCount, vertexCons,
            jitInvMass, geoInvMass, dampJit, stiffJit, wArr, brokenTouch, brokenCount: 0, spokesBroken: 0,
            stick, stickBan, stickDir, stickCount: 0, capFlag,
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
// Ball is drawn BEFORE the transparent membrane and the membrane blends over.
// Where the film is stretched (low alpha) the ball shows through; where it is
// dense (alpha near 1) the film covers the ball, exactly like a real latex.
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), ballMat);
ballMesh.renderOrder = 0;
tiltGroup.add(ballMesh);
ballMesh.visible = false;
// Once the ball has FULLY left the viewport (after having actually been seen
// on screen), it never comes back — regardless of the scenario phase.
let ballSeen = false;
let ballGone = false;
const _ballProj = new THREE.Vector3();
const ballPos = new THREE.Vector3(); // local (tiltGroup) space
// Debug handles: window.__mem.ballMesh / ballMat / ballPos / camera / CONFIG / THREE
window.__mem = { get ballMesh(){return ballMesh;}, get ballMat(){return ballMat;},
                 get ballPos(){return ballPos;}, get camera(){return camera;},
                 get CONFIG(){return CONFIG;}, get THREE(){return THREE;} };

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
const debugState = { maxPenetration: 0, stuckVertices: 0 };
const debugSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#ff3355', wireframe: true, depthTest: false, transparent: true, opacity: 0.8 }));
debugSphere.renderOrder = 2;
debugSphere.visible = false;
tiltGroup.add(debugSphere);
let debugFaceMesh = null;
let debugStickPoints = null;

function rebuildDebugOverlay() {
    if (debugFaceMesh) {
        tiltGroup.remove(debugFaceMesh);
        debugFaceMesh.geometry.dispose();
        debugFaceMesh.material.dispose();
    }
    if (debugStickPoints) {
        tiltGroup.remove(debugStickPoints);
        debugStickPoints.geometry.dispose();
        debugStickPoints.material.dispose();
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
    // Sticky-contact markers: yellow points on every vertex currently latched
    // onto the sphere — the patch is visible growing and (at rupture) popping.
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', mem.geometry.attributes.position); // shared, live
    pg.setIndex(new THREE.BufferAttribute(new Uint32Array(mem.count), 1));
    pg.setDrawRange(0, 0);
    debugStickPoints = new THREE.Points(pg, new THREE.PointsMaterial({
        color: '#ffd23e', size: 5, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.9 }));
    debugStickPoints.renderOrder = 4;
    debugStickPoints.visible = false;
    debugStickPoints.frustumCulled = false;
    tiltGroup.add(debugStickPoints);
}

// Per-frame diagnostic: closest point of every intact face vs the visible
// radius. Highlights penetrating faces and reports the deepest cut.
function updateContactDebug() {
    const on = CONFIG.debug.showContact && ballEngaged && phase === Phase.APPROACH;
    debugSphere.visible = on;
    if (debugFaceMesh) debugFaceMesh.visible = on;
    if (debugStickPoints) debugStickPoints.visible = on;
    if (!on) { debugState.maxPenetration = 0; debugState.stuckVertices = 0; return; }
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
    // Sticky patch markers
    const sIdx = debugStickPoints.geometry.index.array;
    let sn = 0;
    for (let i = 0; i < mem.count; i++) if (mem.stick[i]) sIdx[sn++] = i;
    debugState.stuckVertices = sn;
    debugStickPoints.geometry.setDrawRange(0, sn);
    debugStickPoints.geometry.index.needsUpdate = true;
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
let dropUsed = false;         // one-shot guard: once the ball fires, no auto-repeat

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
    clearSticky();
    rebuildIndex();
    ballMesh.visible = false;
    ballEngaged = false;
    ballStuck = false;
    ballSeen = false;
    ballGone = false;
    dropUsed = false;
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
            jitInvMass, geoInvMass, dampJit, stiffJit, wArr, brokenTouch, home, ringOf, R } = mem;
    const post = phase === Phase.PIERCED || phase === Phase.HEAL;
    const introCfg = CONFIG.intro;
    const introActive = introCfg.enabled && introState.active;
    // During attractor: switch damping to intro.damping (kills residual sway toward the target).
    const baseKeep = introActive
        ? introCfg.damping * mat.damping
        : (post ? CONFIG.oscillation.damping : CONFIG.membrane.damping) * mat.damping;
    const gdy = -CONFIG.membrane.gravity * dt * dt;
    const invMassScale = 1 / Math.max(0.05, mat.massScale);

    // Healing home-springs grow over the heal ramp. Forces, not lerp: the film
    // keeps its inertia, overshoots the rest plane and rings while closing.
    // Fully disabled during the intro run — the attractor owns the shape and
    // must not fight home-springs pulling back to the flat rest plane.
    let healK = 0;
    if (phase === Phase.HEAL && !introCfg.enabled) {
        const ramp = Math.min(1, phaseTime / Math.max(0.01, CONFIG.rupture.healDuration));
        healK = mat.healSpring * ramp * ramp;
    }

    // Intro attractor: ramp its strength from 0 → full over attractorRamp.
    let attractK = 0;
    if (introActive) {
        const elapsed = (performance.now() / 1000) - introState.startTime;
        const ramp = Math.min(1, Math.max(0, elapsed / Math.max(0.01, introCfg.attractorRamp)));
        // Smoothstep for a soft take-off (no visible knee when it engages).
        const s = ramp * ramp * (3 - 2 * ramp);
        attractK = introCfg.strength * s;
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
        if (attractK > 0) {
            // Target: same (x, z) as home (rest ring position), depth along -Y as a
            // function of normalized radius. Pinned rim stays home (funnelDepth(1)=0).
            const tR = ringOf[i] / R;
            const depth = funnelDepth(tR);
            const tx = home[j];
            const ty = home[j + 1] - depth;
            const tz = home[j + 2];
            const s = attractK * wArr[i] * dt * dt;
            ax += (tx - pos[j]) * s;
            ay += (ty - pos[j + 1]) * s;
            az += (tz - pos[j + 2]) * s;
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
    // sphere: vertices entering the adhesion zone latch onto a fixed spot on
    // its surface (sticky contact) and ride along until the tension exceeds
    // `adhesionStrength` — the film clings, follows the sphere's shape, and
    // free tension arcs start past the shrinking edge of the contact patch.
    if (ballEngaged) {
        // Launch boost: the ball is THROWN in — startBoost× cruise speed at spawn,
        // easing down to exactly 1× by boostFadeEnd units above the film. The
        // tension/adhesion mechanics below never see anything but ballPos deltas.
        const bb = CONFIG.ball;
        let speed = bb.speed;
        if (bb.startBoost > 1 && phase === Phase.APPROACH && !ballStuck) {
            const h0 = Math.max(bb.boostFadeEnd + 0.01, zoomCtl.spawnH || bb.startHeight);
            const t = Math.min(1, Math.max(0, (ballPos.y - bb.boostFadeEnd) / (h0 - bb.boostFadeEnd)));
            speed *= 1 + (bb.startBoost - 1) * Math.pow(t, Math.max(0.1, bb.boostCurve));
        }
        const step = speed * dt;
        ballPos.y -= step;
        if (phase === Phase.APPROACH) {
            const r = ballCollisionRadius();
            const r2 = r * r;
            // Once the point reaches the center vertex, that contact holds
            // (the point presses the film in front of it) until punch-through.
            if (!ballStuck && ballPos.y - r <= pos[1]) { ballStuck = true; buildCapWrap(r); }
            if (ballStuck && CONFIG.ball.centerPin) {
                pos[0] = prev[0] = ballPos.x;
                pos[1] = prev[1] = ballPos.y - r;
                pos[2] = prev[2] = ballPos.z;
                wArr[0] = 0;
            }
            const { stick, stickBan, stickDir, capFlag } = mem;
            const capOn = ballStuck;
            const grip = mat.grip;
            const sticky = mat.adhesionStrength > 0 && mat.adhesionZone > 0;
            const rAtt2 = r * r * 1.05 * 1.05; // latch-on proximity (film sits on the surface)
            const zoneCos = Math.cos(Math.min(1, Math.max(0, mat.adhesionZone)) * Math.PI * 0.5);
            const detach2 = mat.adhesionStrength * mat.adhesionStrength;
            for (let i = 1; i < count; i++) {
                if (pinned[i]) continue;
                const j = i * 3;
                if (capOn && capFlag[i]) {
                    // Surface-attach with slip: film over the leading cap stays
                    // ON the sphere (pulled in if it sags off, pushed out if it
                    // penetrates) but slides tangentially — real latex feeds
                    // around the ball, so tear timing stays natural and the tip
                    // silhouette is the sphere itself, never a pinched disc.
                    const cdx = pos[j] - ballPos.x;
                    const cdy = pos[j + 1] - ballPos.y;
                    const cdz = pos[j + 2] - ballPos.z;
                    const cd2 = cdx * cdx + cdy * cdy + cdz * cdz;
                    if (cd2 > 1e-12 && cdy < 0) {
                        const cd = Math.sqrt(cd2);
                        const ck = r / cd;
                        pos[j] = ballPos.x + cdx * ck;
                        pos[j + 1] = ballPos.y + cdy * ck;
                        pos[j + 2] = ballPos.z + cdz * ck;
                        if (grip > 0) {
                            const stickV = grip * Math.max(0, -cdy / cd);
                            prev[j] += (pos[j] - prev[j]) * stickV;
                            prev[j + 1] += (pos[j + 1] + step - prev[j + 1]) * stickV;
                            prev[j + 2] += (pos[j + 2] - prev[j + 2]) * stickV;
                        }
                        continue;
                    }
                }
                if (sticky && stick[i]) {
                    // Detach test before re-projection: the drift accumulated
                    // since last step is the net pull of the springs against
                    // the adhesion. Past the threshold the contact lets go.
                    const tx = ballPos.x + stickDir[j] * r;
                    const ty = ballPos.y + stickDir[j + 1] * r;
                    const tz = ballPos.z + stickDir[j + 2] * r;
                    const ex = pos[j] - tx, ey = pos[j + 1] - ty, ez = pos[j + 2] - tz;
                    if (ex * ex + ey * ey + ez * ez > detach2) {
                        stick[i] = 0; stickBan[i] = 1; mem.stickCount--;
                    } else {
                        // Snap to the spot and co-move with the ball (Verlet
                        // velocity = ball velocity) — true adhesion, not drag.
                        pos[j] = tx; pos[j + 1] = ty; pos[j + 2] = tz;
                        prev[j] = tx; prev[j + 1] = ty + step; prev[j + 2] = tz;
                        continue;
                    }
                }
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
                        // Tangential drag, strongest at the leading pole:
                        // blend the vertex velocity toward co-moving.
                        const stickV = grip * Math.max(0, -dy / d);
                        prev[j] += (pos[j] - prev[j]) * stickV;
                        prev[j + 1] += (pos[j + 1] + step - prev[j + 1]) * stickV;
                        prev[j + 2] += (pos[j + 2] - prev[j + 2]) * stickV;
                    }
                }
                // Latch on: close to the surface, inside the adhesion zone
                // (a cap around the leading pole), not banned this cycle.
                if (sticky && !stick[i] && !stickBan[i] && d2 < rAtt2 && d2 > 1e-12) {
                    const d = Math.sqrt(d2);
                    if (-dy / d >= zoneCos) {
                        stick[i] = 1; mem.stickCount++;
                        stickDir[j] = dx / d; stickDir[j + 1] = dy / d; stickDir[j + 2] = dz / d;
                    }
                }
            }
        }
    }

    // Cache per-link stiffness from current strain (once per step): near the
    // ball the film is strained and stiff, near the rim slack and compliant →
    // the profile bows in arcs instead of a straight cone. Bend links whose
    // ends are stuck to the ball relax so the film can take its curvature.
    const stickArr = mem.stick;
    for (let ci = 0; ci < constraints.length; ci++) {
        const c = constraints[ci];
        if (c.bend) {
            c.k = (constraints[c.h0].broken || constraints[c.h1].broken)
                ? 0 : Math.min(1, mat.bendStiffness * c.gw) * 0.5 * (stiffJit[c.a] + stiffJit[c.b]);
            if (c.k > 0 && (stickArr[c.a] || stickArr[c.b])) c.k = 0;
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
            const { stick, stickDir } = mem;
            for (let i = 1; i < count; i++) {
                if (pinned[i]) continue;
                const j = i * 3;
                if (stick[i]) {
                    // Bilateral sticky projection: pull the vertex toward its
                    // spot on the sphere from either side (partial, so the
                    // residual reflects tension for the detach test).
                    const tx = ballPos.x + stickDir[j] * ballR;
                    const ty = ballPos.y + stickDir[j + 1] * ballR;
                    const tz = ballPos.z + stickDir[j + 2] * ballR;
                    pos[j] += (tx - pos[j]) * 0.5;
                    pos[j + 1] += (ty - pos[j + 1]) * 0.5;
                    pos[j + 2] += (tz - pos[j + 2]) * 0.5;
                    continue;
                }
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
    // property of the material, not a scripted depth. Strain for tearing is
    // measured over the gauge length (≥ a fraction of the uniform spacing) so
    // the fine center links need a comparable absolute stretch to snap.
    if (phase === Phase.APPROACH || phase === Phase.PIERCED) {
        const tearAt = mat.tearStrain;
        for (let ci = 0; ci < structCount; ci++) {
            const c = constraints[ci];
            if (c.broken) continue;
            const ja = c.a * 3, jb = c.b * 3;
            const dx = pos[jb] - pos[ja];
            const dy = pos[jb + 1] - pos[ja + 1];
            const dz = pos[jb + 2] - pos[ja + 2];
            const strain = (Math.hypot(dx, dy, dz) - c.rest) / c.gauge;
            if (strain > tearAt * c.tearScale) snapConstraint(ci, strain, dt);
        }
    }

    // Re-knitting: a torn link heals only when both of its ends have actually
    // come home — the hole closes unevenly, licking shut from all sides.
    // Fully disabled during the intro run — the tear must persist so the
    // final frame matches the logo silhouette (funnel with an open neck).
    if (phase === Phase.HEAL && mem.brokenCount > 0 && !introCfg.enabled) {
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

    // Avalanche: the first snap inside the contact patch pops every sticky
    // contact at once — the film bursts and flies off the sphere in one beat
    // instead of peeling away gradually.
    if (mem.stickCount > 0 && (mem.stick[c.a] || mem.stick[c.b])) releaseSticky(dt);

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

// Drop all sticky state without impulses (cycle reset / new drop).
function clearSticky() {
    mem.stick.fill(0);
    mem.stickBan.fill(0);
    mem.stickCount = 0;
    if (mem.capFlag) mem.capFlag.fill(0);
}

// Mark the leading cap: every vertex whose rest position lies inside the
// ball's footprint is film that should drape over the sphere. During the
// approach these vertices are kept on the ball's surface (with tangential
// slip), so the film tip mirrors the ball's curvature instead of pinching
// into the pole point once the sticky latches let go.
function buildCapWrap(r) {
    const { home, capFlag, count } = mem;
    capFlag.fill(0);
    const maxHr = r * Math.max(0, CONFIG.ball.capWrap);
    if (maxHr <= 0) return;
    for (let i = 1; i < count; i++) {
        const j = i * 3;
        if (Math.hypot(home[j], home[j + 2]) <= maxHr) capFlag[i] = 1;
    }
}

// Avalanche release: every stuck vertex lets go at once. The stored adhesion
// energy pops the film off the sphere (impulse along the outward normal) and
// links around the patch weaken further — the burst is short and snappy.
function releaseSticky(dt) {
    const { stick, stickBan, stickDir, stickCount, constraints, vertexCons } = mem;
    if (stickCount <= 0) return;
    const mat = CONFIG.material;
    const pop = mat.recoil * (0.4 + 4 * mat.adhesionStrength);
    for (let i = 0; i < mem.count; i++) {
        if (!stick[i]) continue;
        stick[i] = 0;
        stickBan[i] = 1;
        const j = i * 3;
        kick(i, stickDir[j], stickDir[j + 1], stickDir[j + 2], pop, dt);
        // Stress concentration at the patch edge: links that were glued to
        // the sphere carry the burst — lower their thresholds locally.
        for (const ni of vertexCons[i]) {
            const n = constraints[ni];
            if (!n.broken) n.tearScale = Math.max(0.3, n.tearScale * 0.75);
        }
    }
    mem.stickCount = 0;
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
    material.uniforms.uAlphaMode.value = CONFIG.look.alphaMode;
}

// ----------------------------------------------------------------------------
// Main loop
// ----------------------------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();

// Debug: ?hold=<depth> freezes the physics as soon as the center vertex
// reaches that depth during APPROACH — a deterministic still of the deep tip.
const HOLD_DEPTH = (() => {
    const v = parseFloat(new URLSearchParams(location.search).get('hold'));
    return Number.isFinite(v) && v > 0 ? v : 0;
})();

// Debug: ?ts / ?adh / ?grip override material params at load (sweep tooling).
(() => {
    const q = new URLSearchParams(location.search);
    const ts = parseFloat(q.get('ts'));
    if (Number.isFinite(ts) && ts > 0) CONFIG.material.tearStrain = ts;
    const adh = parseFloat(q.get('adh'));
    if (Number.isFinite(adh) && adh >= 0) CONFIG.material.adhesionStrength = adh;
    const grip = parseFloat(q.get('grip'));
    if (Number.isFinite(grip) && grip >= 0) CONFIG.material.grip = grip;
})();

// Debug overlay for ?hold stills: numbers readable straight off a screenshot.
function holdOverlay(text) {
    let el = document.getElementById('hold-overlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'hold-overlay';
        el.style.cssText = 'position:fixed;left:12px;top:12px;z-index:99;' +
            'font:16px/1.4 monospace;color:#9ff;background:rgba(0,0,0,.55);' +
            'padding:6px 10px;pointer-events:none;white-space:pre';
        document.body.appendChild(el);
    }
    el.textContent = text;
}

function tick(now) {
    requestAnimationFrame(tick);
    // dt cap 33ms: a load-time hitch (shader compile, image decode, GC) reads
    // as a barely-visible slow-mo instead of teleporting the ball 2-6 frames.
    const rawDt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    const dt = rawDt * CONFIG.timing.timeScale;
    if (HOLD_DEPTH > 0 && phase === Phase.APPROACH) {
        // Fast-forward synchronously to the hold depth (immune to RAF throttling),
        // then freeze: render only, no physics, no phase clocks. Also stops at
        // the punch-through conditions so we never simulate past the rupture.
        // Work is chunked per frame and capped by a total budget so a
        // never-reached target can't livelock the page.
        window.__holdSpent = window.__holdSpent || 0;
        let guard = 0;
        if (!window.__holdDone) {
            while (-mem.pos[1] < HOLD_DEPTH
                && mem.spokesBroken < mem.S * 0.5 && mem.brokenCount < mem.S * 2
                && -mem.pos[1] < CONFIG.rupture.maxDepth
                && guard < 300 && window.__holdSpent < 12000) { physicsStep(FIXED_DT); guard++; window.__holdSpent++; }
            if (guard < 300 || window.__holdSpent >= 12000) window.__holdDone = true;
        }
        if (mem.needIndexRebuild) { rebuildIndex(); mem.needIndexRebuild = false; }
        if (ballEngaged) ballMesh.position.copy(ballPos);
        mem.geometry.attributes.position.needsUpdate = true;
        updateColors();
        renderer.render(scene, camera);
        if (!window.__holdLogged) {
            window.__holdLogged = true;
            console.log('[hold] frozen', { depth: +(-mem.pos[1]).toFixed(3), target: HOLD_DEPTH,
                spokes: mem.spokesBroken, broken: mem.brokenCount, steps: guard });
        }
        holdOverlay('ts ' + CONFIG.material.tearStrain.toFixed(2)
            + '  depth ' + (-mem.pos[1]).toFixed(3) + ' / ' + HOLD_DEPTH.toFixed(2)
            + '\nspokes ' + mem.spokesBroken + '/' + mem.S
            + '  broken ' + mem.brokenCount + '  spent ' + window.__holdSpent
            + (window.__holdDone ? ' done' : ' ...'));
        return;
    }
    accumulator += dt;
    phaseTime += dt;

    while (accumulator >= FIXED_DT) {
        accumulator -= FIXED_DT;
        physicsStep(FIXED_DT);

        if (phase === Phase.APPROACH) {
            // Punch-through: enough of the center has let go — the point passes.
            if (mem.spokesBroken >= mem.S * 0.5 || mem.brokenCount >= mem.S * 2) {
                releaseSticky(FIXED_DT); // any leftover glue pops with the burst
                ballStuck = false;
                setPhase(Phase.PIERCED);
            } else if (-mem.pos[1] >= CONFIG.rupture.maxDepth) {
                releaseSticky(FIXED_DT);
                forceTear(FIXED_DT); // failsafe for materials too tough to tear
                ballStuck = false;
                setPhase(Phase.PIERCED);
            }
        } else if (phase === Phase.PIERCED) {
            // PARKING starts on the way down from the full upswing: pierce + postPierceHold.
            // (No attractor here — the film keeps its free physics; only the camera moves.)
            if (zoomCtl.phase === 'slow' && zoomCtl.parkingT0 < 0
                && phaseTime >= CONFIG.intro.postPierceHold) {
                zoomCtl.parkingT0 = zoomCtl.tGlobal;
                zoomCtl.lnZPark = zoomCtl.lnZ; // parking S-curve starts from the drifted zoom
            }
            // In one-shot / intro modes we never re-knit — the film keeps sloshing (or attractor holds).
            const suppressHeal = CONFIG.intro.enabled || CONFIG.intro.oneShot;
            if (!suppressHeal && phaseTime >= CONFIG.rupture.healDelay) setPhase(Phase.HEAL);
        }
    }
    if (mem.needIndexRebuild) { rebuildIndex(); mem.needIndexRebuild = false; }

    // Phase transitions driven by wall-clock phase time
    // One-shot: once the ball has fired this session, REST never spawns a new drop.
    // The user must hit the external restart button to arm the next cycle.
    if (phase === Phase.REST && phaseTime >= CONFIG.timing.restPause
        && bootReady && !(CONFIG.intro.oneShot && dropUsed)) {
        const ang = cycleRng() * Math.PI * 2;
        const off = CONFIG.imperfection.entryOffset * (0.25 + 0.75 * cycleRng());
        const startH = zoomCtl.spawnH > 0 ? zoomCtl.spawnH : CONFIG.ball.startHeight;
        ballPos.set(Math.cos(ang) * off, startH, Math.sin(ang) * off);
        clearSticky();           // fresh drop: no leftover latches or bans
        ballEngaged = true;      // physics runs and the sphere is drawn as it falls
        ballMesh.visible = true;  // the film now wraps it, so it stays visible from any angle
        console.log('[ball spawn]', { startH, ang: ang.toFixed(3), off: off.toFixed(3),
            pos: [ballPos.x.toFixed(3), ballPos.y.toFixed(3), ballPos.z.toFixed(3)],
            memR: mem?.R, speed: CONFIG.ball.speed });
        cycleIndex++;
        dropUsed = true;
        mem.tearRng = mulberry32(((Math.round(CONFIG.imperfection.seed) * 2654435761) ^ (cycleIndex * 40503)) >>> 0);
        setPhase(Phase.APPROACH);
    } else if (phase === Phase.PIERCED || phase === Phase.HEAL) {
        if (ballEngaged && ballPos.y < -CONFIG.ball.exitDistance) {
            // Keep the ball engaged (physics runs) and VISIBLE all the way down
            // until it has clearly left the viewport. This makes rupture-time
            // debugging much easier — the ball never mysteriously vanishes.
            if (ballPos.y < -CONFIG.ball.exitDistance * 3) {
                ballMesh.visible = false;
                ballEngaged = false;
            }
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
    // Debug telemetry — enable with `window.__ballDebug = true`.
    if (window.__ballDebug && (performance.now() - (window.__ballDbgT || 0)) > 250) {
        window.__ballDbgT = performance.now();
        const wp = ballMesh.getWorldPosition(new THREE.Vector3());
        const ndc = wp.clone().project(camera);
        console.log(`[ball] phase=${phase} vis=${ballMesh.visible} engaged=${ballEngaged}`
            + ` local=(${ballPos.x.toFixed(2)},${ballPos.y.toFixed(2)},${ballPos.z.toFixed(2)})`
            + ` ndc=(${ndc.x.toFixed(2)},${ndc.y.toFixed(2)},${ndc.z.toFixed(3)})`
            + ` broken=${mem?.brokenCount} spokes=${mem?.spokesBroken}`);
    }
    mem.geometry.attributes.position.needsUpdate = true;
    updateColors();
    updateContactDebug();
    updateZoom(dt);
    // Once the ball has FULLY left the viewport (after having been seen on
    // screen), it disappears for good — no matter which phase of the scenario
    // it happens in. Reset only by a restart.
    if (!ballGone && ballMesh.visible) {
        ballMesh.getWorldPosition(_ballProj).project(camera);
        const off = Math.abs(_ballProj.x) > 1.3 || Math.abs(_ballProj.y) > 1.3 || _ballProj.z > 1;
        if (!off) ballSeen = true;
        else if (ballSeen) ballGone = true;
    }
    if (ballGone) ballMesh.visible = false;
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
        { key: 'centerDensity', min: 1, max: 4, step: 0.05, rebuild: true },
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
        { key: 'adhesionStrength', min: 0, max: 0.2, step: 0.002 },
        { key: 'adhesionZone', min: 0, max: 1, step: 0.01 },
        { key: 'tearStrain', min: 0.1, max: 30, step: 0.05 },
        { key: 'tearCascade', min: 0.3, max: 1, step: 0.01 },
        { key: 'recoil', min: 0, max: 2, step: 0.01 },
        { key: 'healSpring', min: 1, max: 60, step: 0.5 },
        { key: 'healSnap', min: 0.02, max: 0.4, step: 0.005 },
    ] },
    { id: 'ball', title: 'ball', obj: () => CONFIG.ball, params: [
        { key: 'radius', min: 0.02, max: 0.5, step: 0.01, apply: applyBallLook },
        { key: 'startHeight', min: 0.5, max: 8, step: 0.1 },
        { key: 'startBoost', min: 1, max: 16, step: 0.1, tip: 'launch speed multiplier at spawn (1 = off)' },
        { key: 'boostFadeEnd', min: 0, max: 3, step: 0.05, tip: 'height above the film where speed is back to 1x' },
        { key: 'boostCurve', min: 0.3, max: 4, step: 0.05, tip: '1 = linear decay; higher = brake later and harder' },
        { key: 'speed', min: 0.05, max: 3, step: 0.01 },
        { key: 'exitDistance', min: 1, max: 20, step: 0.5, tip: 'World-units below the membrane at which the ball is despawned. Larger = it keeps falling further past the bottom of the screen before disappearing.' },
        { key: 'capWrap', min: 0, max: 1.2, step: 0.05, tip: 'Fraction of the ball footprint kept on the sphere surface during approach (tangential slip allowed). 0 = off: natural drape via collision + tension. Applies from the next drop.' },
        { key: 'centerPin', bool: true, tip: 'Hard-pin the film center to the ball\u2019s leading pole. OFF lets the film drape the sphere naturally — round tip. Applies from the next drop.' },
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
        { key: 'baseColor', color: true, tip: 'Base film color at rest (rim / unstretched areas).' },
        { key: 'darkenDepth', min: 0.2, max: 4, step: 0.05, tip: 'Vertex depth (in world units) at which the darken/alpha curve reaches its peak. Larger = the effect saturates only in the deepest part of the funnel.' },
        { key: 'darkenPower', min: 0.3, max: 4, step: 0.05, tip: 'Curve exponent. >1 keeps the effect concentrated near the tip; <1 spreads it toward the rim.' },
        { key: 'darkenStrength', min: 0, max: 1, step: 0.01, tip: 'Max amount of darken (mode 0) or transparency (mode 1) at full stretch. 1.0 = fully dark / fully transparent at the tip.' },
        { key: 'brightness', min: 0.2, max: 2, step: 0.01, tip: 'Global film brightness multiplier applied to baseColor.' },
        { key: 'alphaMode', min: 0, max: 1, step: 1, tip: '0 = RGB darken (film stays opaque, gets darker toward the tip — the classic logo look). 1 = alpha drop (film becomes TRANSPARENT toward the tip so the ball shows through). Switch live to compare.' },
    ] },
    { id: 'timing', title: 'timing', obj: () => CONFIG.timing, params: [
        { key: 'timeScale', min: 0.05, max: 3, step: 0.05 },
        { key: 'restPause', min: 0, max: 5, step: 0.1 },
    ] },
    { id: 'intro', title: 'intro (attractor → logo)', obj: () => CONFIG.intro, params: [
        { key: 'startDrift', min: 0, max: 0.05, step: 0.001, tip: 'Slow pre-parking zoom-out: fraction of zoom shed per second (0.01 = 1%/s). 0 = static start frame. Parking takes over from wherever the drift got to.' },
        { key: 'startDriftRamp', min: 0, max: 6, step: 0.1, tip: 'Seconds to ease the drift in from standstill after load/restart.' },
        { key: 'endAttractorLead', min: 0, max: 5, step: 0.1 },
        { key: 'attractorRamp', min: 0.1, max: 5, step: 0.05 },
        { key: 'strength', min: 1, max: 200, step: 1 },
        { key: 'damping', min: 0.85, max: 1, step: 0.001 },
        { key: 'funnelDepth', min: 0.2, max: 3, step: 0.05 },
        { key: 'funnelNeckRadius', min: 0, max: 0.5, step: 0.01 },
        { key: 'funnelSharpness', min: 0.5, max: 8, step: 0.1 },
        { key: 'funnelRimFlat', min: 0, max: 0.9, step: 0.02 },
        { key: 'edgePadFrac', min: 0, max: 0.25, step: 0.01, tip: 'Safety pad around the physics envelope, as a fraction of the SHORT viewport side. Larger = the whole tension cone sits further from the screen edges.' },
        { key: 'envDownFrac', min: 0.5, max: 1.2, step: 0.02, tip: 'Fraction of rupture.maxDepth reserved BELOW the rim in the start frame. 1.0 = the full tear depth always fits.' },
        { key: 'envUpUnits', min: 0, max: 3, step: 0.05, tip: 'World units reserved ABOVE the rim plane for the post-pierce upswing. Bigger = camera starts further out, more top headroom.' },
        { key: 'postPierceHold', min: 0, max: 4, step: 0.05, tip: 'Seconds after the pierce before parking (the zoom-out) starts. Measured: the full upswing peaks ≈0.9s after the pierce — parking begins on the way down.' },
        { key: 'sDuration', min: 1, max: 15, step: 0.1, tip: 'How long (seconds) the symmetric S-curve tail lasts. The S ALWAYS ends on the logo, so this only reshapes the tail’s pace.' },
        { key: 'sEase', min: 2, max: 6, step: 1, tip: 'Symmetric ease exponent for the S-curve. 2 = quadratic in/out (softest), 3 = cubic (default), 5 = smootherstep-like (steepest middle).' },
        { key: 'edgePadPx', min: 0, max: 30, step: 1, tip: 'How far below the top viewport edge the ball spawns, in CSS pixels. 1 = just barely visible at the very first frame.' },

        { key: 'layoutLiftPx', min: -60, max: 60, step: 1, apply: applyLayoutLift },
        { key: 'logoRimWidthFrac', min: 0.5, max: 1, step: 0.01 },
        { key: 'logoRimTopFrac', min: 0, max: 0.5, step: 0.01 },
        { key: 'crossfade', tip: 'When ON: after landing the canvas fades OUT while the static logo layout fades IN. When OFF (tuning mode): the logo layout is visible from the start so you can align the camera curve against the final target.' },
        { key: 'fadeDelay', min: 0, max: 5, step: 0.1, tip: 'Seconds to wait after landing (Z=1) before the crossfade starts. Only used when crossfade is ON.' },
        { key: 'fadeDuration', min: 0.2, max: 10, step: 0.1, tip: 'Length of the crossfade (seconds). Only used when crossfade is ON.' },
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
    if (p.bool) return Math.random() < 0.5;
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
    const structSnapshot = () => [CONFIG.membrane.radius, CONFIG.membrane.rings,
        CONFIG.membrane.segments, CONFIG.membrane.centerDensity].join('|');
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
            if (p.tip && ctrl.domElement) { // native browser tooltip — hover the row for context
                ctrl.domElement.title = p.tip;
                if (ctrl.$name) ctrl.$name.title = p.tip;
            }
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
    dbg.add(debugState, 'stuckVertices').name('stuck vertices').listen().disable();
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

// Manual restart from the external button — fresh drop with the short pause.
function restartAll(manual = true) {
    buildMembrane();
    restartCycle();
    disengageIntro();
    zoomInit();
    // If the manual restartPause is shorter than restPause, pre-advance phaseTime
    // so the next auto-drop fires almost immediately after the click.
    if (manual) {
        const pause = Math.max(0, CONFIG.timing.restartPause ?? 0);
        const rest = Math.max(0, CONFIG.timing.restPause ?? 0);
        if (pause < rest) phaseTime = rest - pause;
    }
}

// ----------------------------------------------------------------------------
// Intro attractor control
// ----------------------------------------------------------------------------
function engageIntro() {
    introState.active = true;
    introState.startTime = performance.now() / 1000;
    introState.triggeredAt = phaseTime;
}
function disengageIntro() {
    introState.active = false;
    introState.triggeredAt = -1;
}

// ----------------------------------------------------------------------------
// Continuous zoom-out (the "reverse dolly").
// The world = the final page layout at scale 1; the membrane's world rect is
// the logo rim rect (T_land maps canvas px -> world px). One time-varying
// similarity W(t): q -> Z(t)*q + O(t) is applied to BOTH the layout (CSS
// transform on #layout-zoom) and the membrane render. The canvas itself is
// never CSS-scaled: the mapping is folded into the camera's view offset, so
// the membrane renders at full native resolution at every zoom level.
// ----------------------------------------------------------------------------
const zoomCtl = {
    phase: 'idle',             // idle | slow | fast | landed
    Z: 1, Z0: 1,               // current and initial zoom
    lnZ: 0, lnZ0: 0,           // ln(Z) tracked directly — zoom moves in log space
    C0: { x: 0, y: 0 },        // rim center on screen at t=0
    Mw: { x: 0, y: 0 },        // rim center in world (= final layout) px
    sL: 1, tL: { x: 0, y: 0 }, // T_land: canvas px -> world px
    rimWw: 1,                  // rim width in world px
    spawnH: 0,                 // computed ball spawn height (world units)
    wrapO: { x: 0, y: 0 },     // layout wrap's untransformed page origin (body padding)
    canvasPxPerUnit: 0,        // native canvas px per world unit at membrane center (unzoomed)
    parkingT0: -1,             // tGlobal at which parking (the S-curve flight) started; -1 = still holding at Z0
    tGlobal: 0,                // seconds since zoomInit
    fadeTimer: 0,
    fadeDoneTimer: 0,          // fires at the END of the crossfade — flips the intro button to "replay"
};

// Project the pinned outer ring of the membrane to canvas CSS pixels.
// useHome: project the REST (flat) ring positions instead of the current ones —
// calibration must not depend on the membrane's momentary shape (e.g. the
// funnel left over from the previous cycle at restart time).
function computeRimScreenBBox(useHome = false) {
    tiltGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld(true); // never project through a stale camera matrix
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const { pos, home, ringOf, count, R } = mem;
    const src = useHome ? home : pos;
    for (let i = 0; i < count; i++) {
        if (ringOf[i] !== R) continue; // outer (pinned) ring only
        const j = i * 3;
        v.set(src[j], src[j + 1], src[j + 2]);
        v.applyMatrix4(tiltGroup.matrixWorld);
        v.project(camera);
        const px = (v.x + 1) / 2 * w;
        const py = (1 - v.y) / 2 * h;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
    }
    return { left: minX, right: maxX, top: minY, bottom: maxY,
             width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2 };
}

// Where the logo rim sits on screen, in CSS pixels.
// The logo image is square, rendered with object-fit: contain / object-position: left center.
function computeLogoRimRect() {
    const img = document.getElementById('logo-img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const side = Math.min(r.width, r.height);          // rendered square side
    const imgX = r.left;                                // left-aligned
    const imgY = r.top + (r.height - side) / 2;         // vertically centered
    const rimW = side * CONFIG.intro.logoRimWidthFrac;
    return {
        cx: imgX + side / 2,                            // mark is centered in the square
        top: imgY + side * CONFIG.intro.logoRimTopFrac,
        width: rimW,
    };
}

function layoutWrap() { return document.getElementById('layout-zoom'); }

function applyLayoutLift() {
    const block = document.querySelector('.center-block');
    if (block) block.style.transform = `translateY(${-CONFIG.intro.layoutLiftPx}px)`;
}

// Measure the base geometry with everything at identity: the logo rect in
// final-layout coordinates and the membrane rim bbox in raw canvas pixels.
function measureBaseGeometry() {
    const wrap = layoutWrap();
    const prev = wrap ? wrap.style.transform : '';
    if (wrap) wrap.style.transform = 'none';
    const target = computeLogoRimRect();
    // The wrap's own layout origin (body padding etc.): the CSS transform
    // scales about THIS point, not the viewport corner — applyZoom compensates.
    const wr = wrap ? wrap.getBoundingClientRect() : null;
    if (wrap) wrap.style.transform = prev;
    if (!target || !mem) return false;
    zoomCtl.wrapO = wr ? { x: wr.left, y: wr.top } : { x: 0, y: 0 };
    camera.clearViewOffset();
    const rim = computeRimScreenBBox(true);
    if (!isFinite(rim.width) || rim.width <= 0) return false;
    zoomCtl.sL = target.width / rim.width;
    zoomCtl.tL = { x: target.cx - zoomCtl.sL * rim.cx,
                   y: target.top - zoomCtl.sL * rim.top };
    const rimCy = (rim.top + rim.bottom) / 2;
    zoomCtl.Mw = { x: zoomCtl.sL * rim.cx + zoomCtl.tL.x,
                   y: zoomCtl.sL * rimCy + zoomCtl.tL.y };
    zoomCtl.rimWw = target.width;
    return true;
}

// Screen y of a point h units above the membrane center under mapping sigma/tau
// (projected with the base camera — call only while the view offset is clear).
function screenYAtHeight(h, sigma, tauY) {
    tiltGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const v = new THREE.Vector3(0, h, 0).applyMatrix4(tiltGroup.matrixWorld);
    v.project(camera);
    return sigma * ((1 - v.y) / 2 * window.innerHeight) + tauY;
}

// Native canvas px per world unit around the membrane center (view offset cleared).
function canvasPxPerUnitAtCenter() {
    tiltGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const p0 = new THREE.Vector3(0, 0, 0).applyMatrix4(tiltGroup.matrixWorld);
    const p1 = new THREE.Vector3(0, 1, 0).applyMatrix4(tiltGroup.matrixWorld);
    p0.project(camera); p1.project(camera);
    return Math.abs((p0.y - p1.y) / 2 * window.innerHeight);
}

// Choose Z0 and the on-screen rim-center Y so the entire motion envelope fits
// in the viewport with a small pad on the constraining side. All measurements
// are in SCREEN CSS-px at Z=1 (i.e. how big the rim/ball/tension would appear
// with no CSS zoom), which is what the applyZoom multiplier acts on.
//
//   Horizontal:  Z * rimFullWidthPx  <= viewport_w - 2 padPx
//   Vertical:    Z * (rimHalfHeightPx + envUpPx + envDeepPx) <= viewport_h - 2 padPx
//
// The FULL vertical envelope is reserved up front: down-stretch to the tear
// depth (envDeepPx) PLUS the post-pierce upswing (envUpPx). The frame is
// computed once and the camera does NOT move until parking starts.
function computeStartFit(rimFullWidthPx, rimHalfHeightPx, envDeepPx, envUpPx) {
    const cfg = CONFIG.intro;
    const vw = window.innerWidth, vh = window.innerHeight;
    const shortSide = Math.min(vw, vh);
    const padPx = shortSide * cfg.edgePadFrac;
    const availW = vw - 2 * padPx;
    const availH = vh - 2 * padPx;
    const Zw = availW / Math.max(1, rimFullWidthPx);
    const Zh = availH / Math.max(1, rimHalfHeightPx + envUpPx + envDeepPx);
    const Z = Math.max(1, Math.min(Zw, Zh));
    // Vertical placement: bottom of the deep excursion lands exactly on the
    // bottom pad. Whatever is left over (when width constrains Z) becomes
    // EXTRA headroom above the rim — the upswing never as high as the stretch
    // is deep, so the top gap naturally reads a bit larger. That's intended.
    const cy = vh - padPx - Z * envDeepPx;
    return { Z, cy };
}

// Solve for the spawn height that puts the ball's BOTTOM edge exactly edgePadPx
// BELOW the top of the viewport at start zoom Z0 — the ball's top edge just
// clips the top of the screen, its full circle is visible immediately.
function computeSpawnHeight() {
    const { Z0, sL, tL, C0, Mw } = zoomCtl;
    const sigma = Z0 * sL;
    const tauY = Z0 * tL.y + (C0.y - Z0 * Mw.y);
    const pxPerUnit = Math.abs(screenYAtHeight(0, sigma, tauY) - screenYAtHeight(1, sigma, tauY));
    // Ball center at screen y = edgePadPx + ballRadiusPx (ball fully inside viewport).
    const targetY = CONFIG.intro.edgePadPx + CONFIG.ball.radius * pxPerUnit;
    let lo = 0.2, hi = 60;
    for (let i = 0; i < 48; i++) {
        const mid = (lo + hi) / 2;
        if (screenYAtHeight(mid, sigma, tauY) > targetY) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

// Apply the current similarity W: layout via CSS transform, membrane via the
// camera view offset (canvas stays untransformed -> native-resolution render).
function applyZoom() {
    const { Z, Z0, C0, Mw, sL, tL } = zoomCtl;
    const u = Z0 > 1
        ? THREE.MathUtils.clamp(1 - Math.log(Math.max(Z, 1)) / Math.log(Z0), 0, 1)
        : 1;
    const C = { x: C0.x + (Mw.x - C0.x) * u, y: C0.y + (Mw.y - C0.y) * u };
    // NO live clamps here: the start frame already reserves the full vertical
    // envelope (down-stretch + upswing), so the camera path is a pure similarity
    // interpolation — zero vertical wobble during flight and oscillations.
    const O = { x: C.x - Z * Mw.x, y: C.y - Z * Mw.y };
    const wrap = layoutWrap();
    // The CSS transform acts about the wrap's layout origin (body padding
    // offsets it from the viewport corner by wrapO), while O is derived in
    // page coordinates — shift the translate so both mappings agree:
    // page-space  p -> O + Z*p  ==  css translate O + (Z-1)*wrapO.
    if (wrap) {
        const wo = zoomCtl.wrapO;
        wrap.style.transform = `translate(${O.x + (Z - 1) * wo.x}px, ${O.y + (Z - 1) * wo.y}px) scale(${Z})`;
    }
    const sigma = Z * sL;
    const tau = { x: Z * tL.x + O.x, y: Z * tL.y + O.y };
    const w = window.innerWidth, h = window.innerHeight;
    camera.setViewOffset(w, h, -tau.x / sigma, -tau.y / sigma, w / sigma, h / sigma);
}

// ----------------------------------------------------------------------------
// Layout telemetry — one-line snapshots of every number that decides where the
// funnel lands on the logo. Logged at init / fonts / resize / landed; manual:
// MEMBRANE.layoutReport() in the console.
// ----------------------------------------------------------------------------
function layoutSnapshot(tag) {
    try {
        const zc = zoomCtl;
        const f2 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : v;
        // Final-layout (identity-transform) coordinates of the logo target.
        const wrap = layoutWrap();
        const prev = wrap ? wrap.style.transform : '';
        if (wrap) wrap.style.transform = 'none';
        const img = document.getElementById('logo-img');
        const ir = img ? img.getBoundingClientRect() : null;
        const tgt = computeLogoRimRect();
        if (wrap) wrap.style.transform = prev;
        // Actual on-screen positions right now: live logo target (with the
        // current CSS transform) vs the projected pinned ring (canvas CSS px).
        const liveTgt = computeLogoRimRect();
        const rim = computeRimScreenBBox();
        const snap = {
            tag, t: f2(zc.tGlobal), zoomPhase: zc.phase, physPhase: phase,
            vp: { w: window.innerWidth, h: window.innerHeight,
                  clientW: document.documentElement.clientWidth,
                  dpr: f2(window.devicePixelRatio),
                  vvScale: f2(window.visualViewport ? window.visualViewport.scale : 1) },
            logoRect: ir ? { x: f2(ir.left), y: f2(ir.top), w: f2(ir.width), h: f2(ir.height) } : null,
            target: tgt ? { cx: f2(tgt.cx), top: f2(tgt.top), w: f2(tgt.width) } : null,
            calib: { sL: f2(zc.sL), tLx: f2(zc.tL.x), tLy: f2(zc.tL.y),
                     Mwx: f2(zc.Mw.x), Mwy: f2(zc.Mw.y),
                     wox: f2(zc.wrapO.x), woy: f2(zc.wrapO.y) },
            fit: { Z0: f2(zc.Z0), C0x: f2(zc.C0.x), C0y: f2(zc.C0.y),
                   spawnH: f2(zc.spawnH), ppu: f2(zc.pxPerUnitScreen), pad: f2(zc.padPx) },
            now: { Z: f2(zc.Z),
                   rim: { cx: f2(rim.cx), top: f2(rim.top), w: f2(rim.width) },
                   err: (liveTgt && isFinite(rim.cx))
                       ? { dx: f2(rim.cx - liveTgt.cx), dy: f2(rim.top - liveTgt.top),
                           dw: f2(rim.width - liveTgt.width) }
                       : null },
        };
        console.log('[layout]', JSON.stringify(snap));
        return snap;
    } catch (e) { console.warn('[layout] snapshot failed', e); return null; }
}

// Deepest free-vertex excursion below the rim plane, in world units (>= 0).
function deepestFreeDepth() {
    const { pos, pinned, count } = mem;
    let minY = 0;
    for (let i = 0; i < count; i++) {
        if (pinned[i]) continue;
        const y = pos[i * 3 + 1];
        if (y < minY) minY = y;
    }
    return -minY;
}

function meanFreeY() {
    const { pos, pinned, count } = mem;
    let s = 0, n = 0;
    for (let i = 0; i < count; i++) {
        if (pinned[i]) continue;
        s += pos[i * 3 + 1]; n++;
    }
    return n ? s / n : 0;
}

// ----------------------------------------------------------------------------
// Intro persistence + button state — one transparent state machine.
//
//   'playing'  intro flight is running → button reads "skip intro"
//   'done'     intro finished / skipped / already seen → button reads "replay intro"
//
// Transitions:
//   boot (first visit) / replay click ............... → 'playing'
//   crossfade end / skip click / boot (already seen) . → 'done'
//
// "Already seen" is a version-keyed localStorage flag written the moment the
// intro lands (or is skipped). Bump INTRO_VERSION to re-show the intro to
// everyone. NOTE: keep INTRO_VERSION / the key in sync with the head script
// in /index.html (it decides whether to arm the intro before this module loads).
// ----------------------------------------------------------------------------
const INTRO_VERSION = '1';
const INTRO_LS_KEY = 'dipnaked.introPlayedVersion';

function introAlreadyPlayed() {
    try { return localStorage.getItem(INTRO_LS_KEY) === INTRO_VERSION; } catch (_) { return false; }
}

function markIntroPlayed() {
    try { localStorage.setItem(INTRO_LS_KEY, INTRO_VERSION); } catch (_) { /* private mode — intro will just replay next visit */ }
}

// Production intro button (#replay-btn on the main page): visible for the whole
// session; its label/role follows the state machine above.
// The lab page's dev restart button (body[data-intro-dev]) is never touched.
let introUiState = 'playing';

function replayBtnEl() {
    return document.body.hasAttribute('data-intro-dev') ? null : document.getElementById('replay-btn');
}

function setIntroUiState(state) {
    introUiState = state;
    // No scrollbars while the flight is running: the CSS-scaled layout
    // overflows the viewport during the zoom. The head script's .intro-armed
    // guard only covers the first (armed) play — this class covers replays too.
    document.documentElement.classList.toggle('intro-playing', state === 'playing');
    const btn = replayBtnEl();
    if (!btn) return;
    if (state === 'playing') {
        btn.textContent = 'skip intro';
        btn.title = 'Skip the intro';
    } else {
        btn.textContent = 'replay intro';
        btn.title = 'Replay the intro';
    }
    btn.style.transition = 'none';
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
}

function scheduleCrossfade() {
    clearTimeout(zoomCtl.fadeTimer);
    clearTimeout(zoomCtl.fadeDoneTimer);
    // Landing IS the end of the intro flight — remember it now, regardless of
    // whether the cosmetic crossfade runs (it's off in tuning mode).
    markIntroPlayed();
    if (!CONFIG.intro.crossfade) { setIntroUiState('done'); return; }
    const canvas = renderer.domElement;
    const block = document.querySelector('.center-block');
    zoomCtl.fadeTimer = setTimeout(() => {
        const dur = CONFIG.intro.fadeDuration;
        // Both ramps are LINEAR so the opacities always sum to 1: the film and
        // the logo art practically coincide, and a linear cross-dissolve keeps
        // the combined brightness constant — no dip in the middle of the fade.
        canvas.style.transition = `opacity ${dur}s linear`;
        canvas.style.opacity = '0';
        if (block) {
            block.style.transition = `opacity ${dur}s linear`;
            block.style.opacity = '1';
        }
        // The button flips to "replay intro" only when the fade completes —
        // until then a click still counts as "skip" (fast-forwards the fade).
        zoomCtl.fadeDoneTimer = setTimeout(() => setIntroUiState('done'), dur * 1000);
    }, CONFIG.intro.fadeDelay * 1000);
}

// Skip: land the camera instantly, snap the film into the logo funnel and run
// a short crossfade — the exact same end state as a fully played intro.
function skipIntro() {
    clearTimeout(zoomCtl.fadeTimer);
    clearTimeout(zoomCtl.fadeDoneTimer);
    zoomCtl.lnZ = 0; zoomCtl.Z = 1;
    zoomCtl.phase = 'landed';
    applyZoom();
    snapToFunnel();
    markIntroPlayed();
    const dur = 0.6; // quick dissolve — a skip should feel immediate, not abrupt
    const canvas = renderer.domElement;
    canvas.style.transition = `opacity ${dur}s linear`;
    canvas.style.opacity = '0';
    const block = document.querySelector('.center-block');
    if (block) {
        block.style.transition = `opacity ${dur}s linear`;
        block.style.opacity = '1';
    }
    setIntroUiState('done');
}

// Boot path for returning visitors: no flight at all — canvas hidden, layout
// visible, button reads "replay intro". Replay (restartAll → zoomInit) restores
// everything the flight needs.
function bootIntroDone() {
    clearTimeout(zoomCtl.fadeTimer);
    clearTimeout(zoomCtl.fadeDoneTimer);
    const canvas = renderer.domElement;
    canvas.style.transition = 'none';
    canvas.style.opacity = '0';
    canvas.style.display = 'none'; // zoomInit resets display on replay
    const block = document.querySelector('.center-block');
    if (block) { block.style.transition = 'none'; block.style.opacity = '1'; }
    applyLayoutLift();
    zoomCtl.lnZ = 0; zoomCtl.Z = 1;
    zoomCtl.phase = 'landed';
    if (measureBaseGeometry()) applyZoom();
    setIntroUiState('done');
}

// (Re)initialize the whole zoom flight. Called on boot and on manual restart.
function zoomInit() {
    clearTimeout(zoomCtl.fadeTimer);
    clearTimeout(zoomCtl.fadeDoneTimer);
    const canvas = renderer.domElement;
    canvas.style.transition = 'none';
    canvas.style.opacity = '1';
    const block = document.querySelector('.center-block');
    // When crossfade is off, the DOM layout (logo + text) is visible from the start
    // so you can tune the camera curve against the final target directly.
    // ?bare=1 — debug: hide the HTML logo layout entirely so only the WebGL film is visible
    const q = new URLSearchParams(location.search);
    const bare = q.has('bare');
    // ?film=0 — debug: hide the WebGL film entirely so only the DOM art layer is visible
    canvas.style.display = q.get('film') === '0' ? 'none' : '';
    if (block) { block.style.transition = 'none'; block.style.opacity = (bare || CONFIG.intro.crossfade) ? '0' : '1'; }
    setIntroUiState('playing'); // the flight is (re)starting → button offers "skip intro"
    applyLayoutLift();
    if (!measureBaseGeometry()) { zoomCtl.phase = 'idle'; return; }
    // Measure geometry needed for the auto-fit envelope, in world (unzoomed) px.
    zoomCtl.canvasPxPerUnit = canvasPxPerUnitAtCenter();
    // Everything below is in SCREEN CSS-px at Z=1 (i.e. as it would render
    // with no CSS zoom). pxPerUnitScreen = how many CSS-px correspond to 1
    // world unit at the membrane center under the base layout scale sL.
    const pxPerUnitScreen = zoomCtl.sL * zoomCtl.canvasPxPerUnit;
    zoomCtl.pxPerUnitScreen = pxPerUnitScreen;
    zoomCtl.padPx = Math.min(window.innerWidth, window.innerHeight) * CONFIG.intro.edgePadFrac;
    const R = CONFIG.membrane.radius;
    const rimFullWidthPx = 2 * R * pxPerUnitScreen;
    const rimHalfHeightPx = R * pxPerUnitScreen * Math.abs(Math.sin(
        THREE.MathUtils.degToRad(CONFIG.scene.membraneTilt)
    ));
    const envDeepPx = CONFIG.rupture.maxDepth * CONFIG.intro.envDownFrac * pxPerUnitScreen;
    const envUpPx = CONFIG.intro.envUpUnits * pxPerUnitScreen;
    const vw = window.innerWidth, vh = window.innerHeight;
    const fit = computeStartFit(rimFullWidthPx, rimHalfHeightPx, envDeepPx, envUpPx);
    zoomCtl.Z0 = fit.Z;
    zoomCtl.C0 = { x: vw / 2, y: fit.cy };
    zoomCtl.lnZ0 = Math.log(zoomCtl.Z0);
    zoomCtl.lnZ = zoomCtl.lnZ0;
    zoomCtl.Z = zoomCtl.Z0;
    zoomCtl.parkingT0 = -1;
    zoomCtl.lnZPark = -1;
    zoomCtl.tGlobal = 0;
    zoomCtl.spawnH = computeSpawnHeight();
    zoomCtl.phase = 'slow';
    applyZoom();
    layoutSnapshot('init');
}

const smoothstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// Symmetric ease-in-out over x∈[0,1] with adjustable exponent — the parking
// S-curve: starts and ends with zero slope, steepest in the middle.
function symmetricEase(x, e) {
    // Piecewise symmetric ease: 2^(e-1) * x^e  for x<0.5,  1 - 2^(e-1)*(1-x)^e  for x>=0.5.
    // e=2 -> quadratic in/out, e=3 -> cubic, e=5 -> near-smootherstep.
    x = Math.max(0, Math.min(1, x));
    const k = Math.pow(2, e - 1);
    return x < 0.5 ? k * Math.pow(x, e) : 1 - k * Math.pow(1 - x, e);
}

function updateZoom(dt) {
    const zc = zoomCtl, cfg = CONFIG.intro;
    if (zc.phase === 'idle') return;
    zc.tGlobal += dt;
    // Before parking: HOLD at Z0. The flight phase has variable length (screen
    // height decides when the ball reaches the film), so nothing is clocked
    // from page load — parking is armed by the physics (pierce + postPierceHold).
    if (zc.parkingT0 < 0) {
        // Optional slow drift: the "static" start frame breathes — a gentle
        // zoom-out along the SAME flight path the parking will later follow
        // (applyZoom derives the pan from Z), so parking takes over seamlessly.
        if (cfg.startDrift > 0 && zc.lnZ > 0) {
            const ramp = Math.min(1, zc.tGlobal / Math.max(0.01, cfg.startDriftRamp));
            zc.lnZ = Math.max(0, zc.lnZ - cfg.startDrift * ramp * dt);
            zc.Z = Math.exp(zc.lnZ);
        }
        applyZoom(); return;
    }
    const sT = Math.max(0.5, cfg.sDuration);
    const x = Math.min(1, (zc.tGlobal - zc.parkingT0) / sT);
    // Parking starts from wherever the drift left the camera (lnZPark), not
    // from the boot-time Z0 — otherwise the takeover would jump.
    const lnFrom = (zc.lnZPark != null && zc.lnZPark >= 0) ? zc.lnZPark : zc.lnZ0;
    // Velocity-continuous takeover: the S-curve is given the drift's speed as
    // its initial slope (s0, normalized), so the camera NEVER stalls — constant
    // pan → seamless accel into parking → decel only at the logo itself.
    const s0 = (cfg.startDrift > 0 && lnFrom > 1e-6)
        ? Math.min(2, cfg.startDrift * sT / lnFrom) : 0;
    const p = Math.min(1, symmetricEase(x, cfg.sEase) + s0 * x * (1 - x) * (1 - x));
    zc.lnZ = Math.max(0, lnFrom * (1 - p));
    zc.Z = Math.exp(zc.lnZ);
    // End-of-parking attractor: engage just before landing so the film settles
    // into the logo funnel right before the fadeout — not a moment earlier.
    if (cfg.enabled && cfg.endAttractor && !introState.active
        && (sT - (zc.tGlobal - zc.parkingT0)) <= Math.max(0, cfg.endAttractorLead)) {
        engageIntro();
    }
    if (x >= 1 && zc.phase !== 'landed') {
        zc.lnZ = 0; zc.Z = 1;
        zc.phase = 'landed';
        scheduleCrossfade();
        layoutSnapshot('landed');
        setTimeout(() => layoutSnapshot('landed+3s'), 3000);
    }
    applyZoom();
}

// Webfont load can reflow the layout target — refresh T_land, but keep the
// current Z (no visible jump). New Z0 only matters for the next zoomInit.
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
        if (zoomCtl.phase === 'idle') return;
        measureBaseGeometry();
        applyZoom();
        layoutSnapshot('fonts');
    });
}

// On resize: same rule — refresh geometry but do not snap Z.
window.addEventListener('resize', () => {
    if (zoomCtl.phase === 'idle') { applyZoom(); return; }
    if (!measureBaseGeometry()) return;
    if (zoomCtl.phase === 'landed') { zoomCtl.lnZ = 0; zoomCtl.Z = 1; }
    applyZoom();
    layoutSnapshot('resize');
});

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
// Dev overlay: always on, fixed — out of the layout flow, doesn't affect body sizing.
try {
    const g = gui.domElement;
    g.style.position = 'fixed';
    g.style.top = '0';
    g.style.right = '0';
    g.style.zIndex = '9999';
    g.style.maxHeight = '100vh';
    g.style.overflowY = 'auto';
    g.style.pointerEvents = 'auto';
    gui.close(); // collapsed by default — one click opens; never covers the tagline (esp. portrait)
    // GUI visibility: dev pages (body[data-intro-dev]) show it by default,
    // production pages hide it. ?gui=1 forces it on anywhere, ?gui=0 — off.
    const guiQ = new URLSearchParams(location.search).get('gui');
    const devPage = document.body.hasAttribute('data-intro-dev');
    if (guiQ === '0' || (!devPage && guiQ !== '1')) g.style.display = 'none';
} catch (_) { /* noop */ }
// Returning visitor on the production page: the intro has already played for
// this INTRO_VERSION → boot straight into the done state (the head script in
// index.html also skipped arming the intro, so the layout was never hidden).
// Dev pages always play — tuning must not depend on a browser flag.
if (introAlreadyPlayed() && !document.body.hasAttribute('data-intro-dev')) {
    bootIntroDone();
} else {
    zoomInit(); // arms the zoom flight (measures geometry, computes the spawn height)
}

// Boot warm-up gate: on a COLD load the first frames are expensive one-offs
// (three.js shader compile, 1254px logo decode, GUI build, webfonts). The drop
// is released only after those are done + two warm frames, hard-capped at 1s.
// Meanwhile the film idles on screen — a calm beat, not a black screen or a
// loader. Manual restart is unaffected (everything is warm by then).
let bootReady = false;
(async () => {
    try {
        const tasks = [];
        if (document.fonts && document.fonts.ready) tasks.push(document.fonts.ready);
        const logoImg = document.getElementById('logo-img');
        if (logoImg && logoImg.decode) tasks.push(logoImg.decode().catch(() => {}));
        try { renderer.compile(scene, camera); } catch (_) { /* noop */ }
        await Promise.race([Promise.all(tasks), new Promise(r => setTimeout(r, 1000))]);
    } catch (_) { /* noop */ }
    requestAnimationFrame(() => requestAnimationFrame(() => { bootReady = true; }));
})();
requestAnimationFrame(tick);

// Dev helper: ?frozen=1 in URL → force the mesh straight into the funnel target
// so screenshots and layout checks don't have to wait for the whole cycle.
// Applies target positions to pos/prev, sets phase to PIERCED, engages intro.
function snapToFunnel() {
    const { pos, prev, home, ringOf, count, R } = mem;
    for (let i = 0; i < count; i++) {
        const j = i * 3;
        const tR = ringOf[i] / R;
        const d = funnelDepth(tR);
        pos[j]     = home[j];
        pos[j + 1] = home[j + 1] - d;
        pos[j + 2] = home[j + 2];
        prev[j]     = pos[j];
        prev[j + 1] = pos[j + 1];
        prev[j + 2] = pos[j + 2];
    }
    setPhase(Phase.PIERCED);
    engageIntro();
    // Push the ramp past full so damping wins immediately.
    introState.startTime = (performance.now() / 1000) - (CONFIG.intro.attractorRamp + 0.5);
}
try {
    const q = new URLSearchParams(location.search);
    if (q.get('frozen') === '1') {
        // Wait one frame so buildMembrane has definitely populated buffers.
        requestAnimationFrame(() => requestAnimationFrame(snapToFunnel));
    }
    window.MEMBRANE_SNAP_TO_FUNNEL = snapToFunnel;
} catch (_) { /* noop */ }

// Console handle for quick tweaking: MEMBRANE.CONFIG.…, MEMBRANE.restart()
window.MEMBRANE = { CONFIG, MATERIALS, gui, restart: restartAll,
    engageIntro, disengageIntro, zoom: zoomCtl, layoutReport: layoutSnapshot,
    get phase() { return phase; }, get mem() { return mem; }, get ballPos() { return ballPos; },
    get phaseTime() { return phaseTime; },
    get introState() { return introState; } };

// Intro button on the production page (#replay-btn): skip while playing,
// replay when done. The lab pages' dev restart button always restarts.
const restartBtn = document.getElementById('restart-btn') || document.getElementById('replay-btn');
if (restartBtn) restartBtn.addEventListener('click', () => {
    if (restartBtn.id === 'replay-btn' && introUiState === 'playing') skipIntro();
    else restartAll();
});
