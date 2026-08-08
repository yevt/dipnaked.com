// ============================================================================
// dipnaked — membrane lab
// A point pierces a stretched circular film: real-time 3D mass–spring (Verlet)
// membrane simulation. The maximum-stretch frame reproduces the static logo.
// All tweakable constants live in CONFIG below (live-editable via GUI, press H).
// ============================================================================

import * as THREE from 'three';
import GUI from 'lil-gui';

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
        stiffness: 0.35,          // constraint stiffness 0..1 (lower = stretchier)
        iterations: 6,            // constraint solver iterations
        damping: 0.995,           // velocity keep-factor during stretch
        gravity: 0.0,             // optional sag (units/s², along -normal)
    },
    ball: {
        radius: 0.10,
        startHeight: 3.2,         // spawn height above the film (along +normal)
        speed: 0.55,              // units/s along -normal (slow, comet-like)
        exitDistance: 4.5,        // despawn this far below the film
        color: '#2ec8e0',
    },
    rupture: {
        depth: 1.9,               // center deflection that tears the film (≈ logo frame)
        holeRings: 5,             // how many inner rings tear free
        healDelay: 1.2,           // s after rupture before healing starts
        healDuration: 3.0,        // s for the hole to close
    },
    oscillation: {
        damping: 0.990,           // velocity keep-factor after rupture (string-like settle)
        settleTime: 4.0,          // s of oscillation before the cycle can restart
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
};

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

    const idx = (ring, seg) => ring === 0 ? 0 : 1 + (ring - 1) * S + ((seg % S + S) % S);

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

    // Constraints: radial, circumferential, diagonal (shear)
    const constraints = []; // {a, b, rest, broken}
    const addC = (a, b) => {
        const dx = home[a * 3] - home[b * 3];
        const dy = home[a * 3 + 1] - home[b * 3 + 1];
        const dz = home[a * 3 + 2] - home[b * 3 + 2];
        constraints.push({ a, b, rest: Math.hypot(dx, dy, dz), broken: false });
    };
    for (let s = 0; s < S; s++) addC(0, idx(1, s));                     // center spokes
    for (let r = 1; r <= R; r++) {
        for (let s = 0; s < S; s++) {
            addC(idx(r, s), idx(r, s + 1));                             // circumferential
            if (r < R) {
                addC(idx(r, s), idx(r + 1, s));                         // radial
                addC(idx(r, s), idx(r + 1, s + 1));                     // diagonal
            }
        }
    }

    // Triangles (with ring metadata for the tear/heal hole)
    const tris = []; // {a, b, c, minRing}
    for (let s = 0; s < S; s++) tris.push({ a: 0, b: idx(1, s + 1), c: idx(1, s), minRing: 0 });
    for (let r = 1; r < R; r++) {
        for (let s = 0; s < S; s++) {
            const a = idx(r, s), b = idx(r, s + 1), c = idx(r + 1, s), d = idx(r + 1, s + 1);
            tris.push({ a, b: d, c, minRing: r });
            tris.push({ a, b, c: d, minRing: r });
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

    mem = { R, S, count, home, pos, prev, ringOf, pinned, constraints, tris, geometry, mesh, material, depths, indexArr, holeOpenRings: 0 };
    rebuildIndex();
    updateColors();
}

// Rebuild triangle index, hiding triangles inside the currently open hole.
function rebuildIndex() {
    const { tris, indexArr, geometry, holeOpenRings } = mem;
    let n = 0;
    for (const t of tris) {
        if (t.minRing < holeOpenRings) continue;
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
// State machine
// ----------------------------------------------------------------------------
const Phase = { REST: 'rest', APPROACH: 'approach', PIERCED: 'pierced', HEAL: 'heal' };
let phase = Phase.REST;
let phaseTime = 0;
let ballContacted = false; // the point has touched the film's center

function setPhase(p) { phase = p; phaseTime = 0; }

function restartCycle() {
    mem.pos.set(mem.home);
    mem.prev.set(mem.home);
    for (const c of mem.constraints) c.broken = false;
    mem.holeOpenRings = 0;
    rebuildIndex();
    ballMesh.visible = false;
    ballContacted = false;
    setPhase(Phase.REST);
}

// ----------------------------------------------------------------------------
// Physics step (fixed dt, local tiltGroup space; membrane normal = +Y)
// ----------------------------------------------------------------------------
const FIXED_DT = 1 / 120;

function physicsStep(dt) {
    const { pos, prev, pinned, count, constraints } = mem;
    const damping = (phase === Phase.PIERCED || phase === Phase.HEAL)
        ? CONFIG.oscillation.damping : CONFIG.membrane.damping;
    const gdy = -CONFIG.membrane.gravity * dt * dt;
    let centerStuck = false;

    // Verlet integration
    for (let i = 0; i < count; i++) {
        if (pinned[i]) continue;
        const j = i * 3;
        const vx = (pos[j] - prev[j]) * damping;
        const vy = (pos[j + 1] - prev[j + 1]) * damping;
        const vz = (pos[j + 2] - prev[j + 2]) * damping;
        prev[j] = pos[j]; prev[j + 1] = pos[j + 1]; prev[j + 2] = pos[j + 2];
        pos[j] += vx; pos[j + 1] += vy + gdy; pos[j + 2] += vz;
    }

    // Ball motion + collision (push vertices out of the sphere)
    if (ballMesh.visible) {
        ballPos.y -= CONFIG.ball.speed * dt;
        const collide = phase === Phase.APPROACH; // once torn, the point passes through
        if (collide) {
            const r = CONFIG.ball.radius * 1.05;
            const r2 = r * r;
            // The point flies exactly along the film's central normal: once it
            // reaches the center vertex, the contact holds (the point presses
            // the film in front of it) until rupture.
            if (!ballContacted && ballPos.y - r <= pos[1]) ballContacted = true;
            if (ballContacted) {
                centerStuck = true;
                pos[0] = prev[0] = ballPos.x;
                pos[1] = prev[1] = ballPos.y - r;
                pos[2] = prev[2] = ballPos.z;
            }
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
                }
            }
        }
    }

    // Constraint relaxation (PBD distance constraints)
    const stiffness = CONFIG.membrane.stiffness;
    const iters = Math.max(1, Math.round(CONFIG.membrane.iterations));
    for (let it = 0; it < iters; it++) {
        for (const c of constraints) {
            if (c.broken) continue;
            const ja = c.a * 3, jb = c.b * 3;
            const dx = pos[jb] - pos[ja];
            const dy = pos[jb + 1] - pos[ja + 1];
            const dz = pos[jb + 2] - pos[ja + 2];
            const d = Math.hypot(dx, dy, dz);
            if (d < 1e-9) continue;
            const diff = ((d - c.rest) / d) * 0.5 * stiffness;
            const ox = dx * diff, oy = dy * diff, oz = dz * diff;
            const pa = pinned[c.a] || (centerStuck && c.a === 0);
            const pb = pinned[c.b] || (centerStuck && c.b === 0);
            if (!pa && !pb) {
                pos[ja] += ox; pos[ja + 1] += oy; pos[ja + 2] += oz;
                pos[jb] -= ox; pos[jb + 1] -= oy; pos[jb + 2] -= oz;
            } else if (!pa) {
                pos[ja] += 2 * ox; pos[ja + 1] += 2 * oy; pos[ja + 2] += 2 * oz;
            } else if (!pb) {
                pos[jb] -= 2 * ox; pos[jb + 1] -= 2 * oy; pos[jb + 2] -= 2 * oz;
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Tear / heal
// ----------------------------------------------------------------------------
function tear() {
    const holeRings = Math.max(1, Math.round(CONFIG.rupture.holeRings));
    for (const c of mem.constraints) {
        if (mem.ringOf[c.a] < holeRings || mem.ringOf[c.b] < holeRings) c.broken = true;
    }
    mem.holeOpenRings = holeRings;
    rebuildIndex();
}

// Healing: pull torn vertices back home, re-enable their constraints and
// triangles progressively (hole closes from its edge toward the center).
function healStep(progress) {
    const holeRings = Math.max(1, Math.round(CONFIG.rupture.holeRings));
    const closedDownTo = Math.round(holeRings * (1 - progress)); // rings still open
    const { pos, prev, home, ringOf, count } = mem;

    // Pull torn vertices toward their rest positions
    const pull = 0.06 * progress;
    for (let i = 0; i < count; i++) {
        if (ringOf[i] >= holeRings) continue;
        const j = i * 3;
        pos[j] += (home[j] - pos[j]) * pull;
        pos[j + 1] += (home[j + 1] - pos[j + 1]) * pull;
        pos[j + 2] += (home[j + 2] - pos[j + 2]) * pull;
        prev[j] += (pos[j] - prev[j]) * 0.5;
        prev[j + 1] += (pos[j + 1] - prev[j + 1]) * 0.5;
        prev[j + 2] += (pos[j + 2] - prev[j + 2]) * 0.5;
    }

    // Re-knit constraints/triangles outside the still-open core
    for (const c of mem.constraints) {
        if (c.broken && ringOf[c.a] >= closedDownTo && ringOf[c.b] >= closedDownTo) c.broken = false;
    }
    if (closedDownTo !== mem.holeOpenRings) {
        mem.holeOpenRings = closedDownTo;
        rebuildIndex();
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
            const centerDepth = -mem.pos[1]; // center vertex deflection along -normal
            if (centerDepth >= CONFIG.rupture.depth) {
                tear();
                setPhase(Phase.PIERCED);
            }
        } else if (phase === Phase.PIERCED) {
            if (phaseTime >= CONFIG.rupture.healDelay) setPhase(Phase.HEAL);
        } else if (phase === Phase.HEAL) {
            const progress = Math.min(1, phaseTime / CONFIG.rupture.healDuration);
            healStep(progress);
        }
    }

    // Phase transitions driven by wall-clock phase time
    if (phase === Phase.REST && phaseTime >= CONFIG.timing.restPause) {
        ballPos.set(0, CONFIG.ball.startHeight, 0);
        ballMesh.visible = true;
        setPhase(Phase.APPROACH);
    } else if (phase === Phase.HEAL) {
        if (ballMesh.visible && ballPos.y < -CONFIG.ball.exitDistance) ballMesh.visible = false;
        const healed = phaseTime >= CONFIG.rupture.healDuration;
        const settled = phaseTime >= Math.max(CONFIG.rupture.healDuration, CONFIG.oscillation.settleTime);
        if (healed && settled && !ballMesh.visible) restartCycle();
    }

    if (ballMesh.visible) ballMesh.position.copy(ballPos);
    mem.geometry.attributes.position.needsUpdate = true;
    updateColors();
    renderer.render(scene, camera);
}

// ----------------------------------------------------------------------------
// GUI (press H to toggle)
// ----------------------------------------------------------------------------
function buildGUI() {
    const gui = new GUI({ title: 'membrane' });

    const fScene = gui.addFolder('scene / camera');
    fScene.add(CONFIG.scene, 'cameraFov', 15, 90, 1).onChange(applyCamera);
    fScene.add(CONFIG.scene, 'cameraDistance', 2, 20, 0.1).onChange(applyCamera);
    fScene.add(CONFIG.scene, 'cameraHeight', -5, 5, 0.05).onChange(applyCamera);
    fScene.add(CONFIG.scene, 'lookAtY', -4, 4, 0.05).onChange(applyCamera);
    fScene.add(CONFIG.scene, 'membraneTilt', -80, 80, 1).onChange(applyTilt);
    fScene.addColor(CONFIG.scene, 'background').onChange(applyCamera);
    fScene.close();

    const fMem = gui.addFolder('membrane');
    fMem.add(CONFIG.membrane, 'radius', 0.5, 4, 0.05).onFinishChange(restartAll);
    fMem.add(CONFIG.membrane, 'rings', 6, 60, 1).onFinishChange(restartAll);
    fMem.add(CONFIG.membrane, 'segments', 12, 128, 1).onFinishChange(restartAll);
    fMem.add(CONFIG.membrane, 'stiffness', 0.02, 1, 0.01);
    fMem.add(CONFIG.membrane, 'iterations', 1, 20, 1);
    fMem.add(CONFIG.membrane, 'damping', 0.9, 1, 0.001);
    fMem.add(CONFIG.membrane, 'gravity', 0, 5, 0.05);
    fMem.close();

    const fBall = gui.addFolder('ball');
    fBall.add(CONFIG.ball, 'radius', 0.02, 0.5, 0.01).onChange(applyBallLook);
    fBall.add(CONFIG.ball, 'startHeight', 0.5, 8, 0.1);
    fBall.add(CONFIG.ball, 'speed', 0.05, 3, 0.01);
    fBall.add(CONFIG.ball, 'exitDistance', 1, 10, 0.1);
    fBall.addColor(CONFIG.ball, 'color').onChange(applyBallLook);
    fBall.close();

    const fRup = gui.addFolder('rupture / healing');
    fRup.add(CONFIG.rupture, 'depth', 0.3, 4, 0.05);
    fRup.add(CONFIG.rupture, 'holeRings', 1, 15, 1);
    fRup.add(CONFIG.rupture, 'healDelay', 0, 5, 0.1);
    fRup.add(CONFIG.rupture, 'healDuration', 0.5, 10, 0.1);
    fRup.close();

    const fOsc = gui.addFolder('oscillation');
    fOsc.add(CONFIG.oscillation, 'damping', 0.85, 1, 0.001);
    fOsc.add(CONFIG.oscillation, 'settleTime', 0, 10, 0.1);
    fOsc.close();

    const fLook = gui.addFolder('look');
    fLook.addColor(CONFIG.look, 'baseColor');
    fLook.add(CONFIG.look, 'darkenDepth', 0.2, 4, 0.05);
    fLook.add(CONFIG.look, 'darkenPower', 0.3, 4, 0.05);
    fLook.add(CONFIG.look, 'darkenStrength', 0, 1, 0.01);
    fLook.add(CONFIG.look, 'brightness', 0.2, 2, 0.01);
    fLook.close();

    const fTime = gui.addFolder('timing');
    fTime.add(CONFIG.timing, 'timeScale', 0.05, 3, 0.05);
    fTime.add(CONFIG.timing, 'restPause', 0, 5, 0.1);
    fTime.close();

    gui.add({ restart: restartAll }, 'restart');

    window.addEventListener('keydown', (e) => {
        if (e.key === 'h' || e.key === 'H') gui.show(gui._hidden);
    });
    return gui;
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
buildGUI();
requestAnimationFrame(tick);

// Console handle for quick tweaking: MEMBRANE.CONFIG.…, MEMBRANE.restart()
window.MEMBRANE = { CONFIG, restart: restartAll, get phase() { return phase; }, get mem() { return mem; } };
