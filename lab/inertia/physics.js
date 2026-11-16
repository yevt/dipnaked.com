"use strict";

// Coordinates are in simulation units. The last two columns give mass and contact radius.
const REST_POSE = {
  crown:     [  0,   0, 1.45, 11],
  neck:      [  0,  45, 1.25,  8],
  shoulderL: [-31,  54, 1.25, 11],
  shoulderR: [ 31,  54, 1.25, 11],
  waist:     [  0, 106, 2.20, 13],
  hipL:      [-20, 129, 1.55, 12],
  hipR:      [ 20, 129, 1.55, 12],
  elbowL:    [-67,  82, 0.80,  7],
  wristL:    [-90,  52, 0.49,  5],
  handL:     [-97,  39, 0.32,  5],
  elbowR:    [ 67,  83, 0.80,  7],
  wristR:    [ 58, 121, 0.49,  5],
  handR:     [ 56, 136, 0.32,  5],
  kneeL:     [-43, 189, 1.15, 10],
  ankleL:    [-40, 252, 0.72,  6],
  toeL:      [-61, 260, 0.40,  5],
  kneeR:     [ 49, 186, 1.15, 10],
  ankleR:    [ 83, 237, 0.72,  6],
  toeR:      [105, 242, 0.40,  5],
};

// Bind landmarks on the 893 × 1589 drawing. Physics and texture deformation
// both use these coordinates, so the grip, face, fingertips and feet agree.
const DRAWING_JOINTS = {
  crown: [402, 207], neck: [395, 402],
  shoulderL: [242, 88], shoulderR: [577, 165], waist: [398, 581],
  hipL: [343, 765], hipR: [476, 784],
  elbowL: [229, 410], wristL: [248, 686], handL: [245, 877],
  elbowR: [553, 455], wristR: [535, 724], handR: [565, 909],
  kneeL: [369, 1105], ankleL: [414, 1500], toeL: [487, 1557],
  kneeR: [523, 1116], ankleR: [600, 1503], toeR: [657, 1557],
};
const DRAWING_SCALE = 0.225;
const DRAWING_POSE = Object.fromEntries(Object.entries(DRAWING_JOINTS).map(([name, [x, y]]) => {
  const [, , mass, radius] = REST_POSE[name];
  return [name, [x * DRAWING_SCALE, y * DRAWING_SCALE, mass, radius]];
}));

// Triangles hold the chest and pelvis together. Limbs and the waist have more give.
const SKELETON = [
  ["crown", "neck", 2.2],
  ["neck", "shoulderL", 2.4], ["neck", "shoulderR", 2.4],
  ["shoulderL", "shoulderR", 2.5], ["neck", "waist", 1.6],
  ["shoulderL", "waist", 1.9], ["shoulderR", "waist", 1.9],
  ["waist", "hipL", 1.8], ["waist", "hipR", 1.8], ["hipL", "hipR", 2.4],
  ["shoulderL", "hipL", 0.30], ["shoulderR", "hipR", 0.30],
  ["shoulderL", "elbowL", 1], ["elbowL", "wristL", 1], ["wristL", "handL", 1.4],
  ["shoulderR", "elbowR", 1], ["elbowR", "wristR", 1], ["wristR", "handR", 1.4],
  ["hipL", "kneeL", 1], ["kneeL", "ankleL", 1], ["ankleL", "toeL", 1.4],
  ["hipR", "kneeR", 1], ["kneeR", "ankleR", 1], ["ankleR", "toeR", 1.4],
];

// Each hinge has a preferred local angle, a natural frequency and a soft travel limit.
const HINGES = [
  ["crown", "neck", "waist", 6.8, 0.72],
  ["neck", "waist", "hipL", 5.5, 0.65], ["neck", "waist", "hipR", 5.5, 0.65],
  ["waist", "shoulderL", "elbowL", 4.0, 1.65], ["waist", "shoulderR", "elbowR", 4.0, 1.65],
  ["shoulderL", "elbowL", "wristL", 4.4, 1.55], ["shoulderR", "elbowR", "wristR", 4.4, 1.55],
  ["elbowL", "wristL", "handL", 6.0, 0.70], ["elbowR", "wristR", "handR", 6.0, 0.70],
  ["waist", "hipL", "kneeL", 4.6, 1.25], ["waist", "hipR", "kneeR", 4.6, 1.25],
  ["hipL", "kneeL", "ankleL", 4.2, 1.35], ["hipR", "kneeR", "ankleR", 4.2, 1.35],
  ["kneeL", "ankleL", "toeL", 6.0, 0.75], ["kneeR", "ankleR", "toeR", 6.0, 0.75],
];

const STEP_MS = 1000 / 120;
const SUBSTEPS = 8;
const SUBSTEP_MS = STEP_MS / SUBSTEPS;
const DT = SUBSTEP_MS / 1000;
const DEFAULT_SETTINGS = { cord: 0.55, joints: 0.55, damping: 0 };
const clamp = (value, lower, upper) => Math.max(lower, Math.min(value, upper));
// Matter reports velocity per reference frame (1/60 s) and integrates force in ms².
const VELOCITY_TO_SECONDS = 60;
const FORCE_TO_MATTER = 1e-6;
const WALL_FREQUENCY = 480;
const MAX_HAND_FORCE = 100000;
const BEND_CORE = 0.30;
const LINK_HARDENING = 7;

function createHinge(nodes, [from, joint, to, frequency, limit]) {
  const a = nodes[from], b = nodes[joint], c = nodes[to];
  const ux = a.position.x - b.position.x, uy = a.position.y - b.position.y;
  const vx = c.position.x - b.position.x, vy = c.position.y - b.position.y;
  const u2 = ux * ux + uy * uy, v2 = vx * vx + vy * vy;
  const uv = Math.sqrt(u2 * v2);
  const ax = uy / u2, ay = -ux / u2;
  const cx = -vy / v2, cy = vx / v2;
  const bx = -ax - cx, by = -ay - cy;
  const inertia = 1 / (a.inverseMass * (ax * ax + ay * ay)
    + b.inverseMass * (bx * bx + by * by) + c.inverseMass * (cx * cx + cy * cy));
  return {
    a, b, c, inertia, frequency,
    cos: (ux * vx + uy * vy) / uv, sin: (ux * vy - uy * vx) / uv,
    uCore2: BEND_CORE ** 2 * u2, vCore2: BEND_CORE ** 2 * v2,
    travel: (1 - Math.cos(limit)) / (1 + BEND_CORE ** 2),
  };
}

function applyLink(link) {
  const { a, b, rest, stiffness, friction } = link;
  const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy + link.core2);
  const nx = dx / distance, ny = dy / distance;
  const speed = VELOCITY_TO_SECONDS * ((b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny);
  // Smoothly increasing stiffness resists large strains without a discontinuity
  // in acceleration when a spring crosses a length threshold.
  const stretch = distance - rest;
  const stretch2 = stretch * stretch;
  const hardening = 1 + LINK_HARDENING * stretch2 / (stretch2 + link.range2);
  const force = (stiffness * stretch * hardening + friction * speed) * FORCE_TO_MATTER;
  a.force.x += force * nx; a.force.y += force * ny;
  b.force.x -= force * nx; b.force.y -= force * ny;
}

function applyHinge(hinge) {
  const { a, b, c, cos, sin, friction } = hinge;
  const ux = a.position.x - b.position.x, uy = a.position.y - b.position.y;
  const vx = c.position.x - b.position.x, vy = c.position.y - b.position.y;
  const u2 = ux * ux + uy * uy, v2 = vx * vx + vy * vy;
  const invU = 1 / Math.sqrt(u2 + hinge.uCore2), invV = 1 / Math.sqrt(v2 + hinge.vCore2);
  const unx = ux * invU, uny = uy * invU, vnx = vx * invV, vny = vy * invV;
  // Compare the two limb directions after rotating the first by the rest angle.
  // The soft normalization keeps the potential smooth even when a limb folds flat.
  const dx = cos * unx - sin * uny - vnx, dy = sin * unx + cos * uny - vny;
  const bend = 0.5 * (dx * dx + dy * dy);
  const gain = -hinge.stiffness * (1 + 4 * Math.max(0, bend - hinge.travel));
  const rx = cos * dx + sin * dy, ry = -sin * dx + cos * dy;
  const alongU = unx * rx + uny * ry, alongV = vnx * dx + vny * dy;
  let fax = gain * invU * (rx - unx * alongU), fay = gain * invU * (ry - uny * alongU);
  let fcx = gain * invV * (vnx * alongV - dx), fcy = gain * invV * (vny * alongV - dy);

  if (friction > 0) {
    // Relative angular velocity vanishes for a common translation or rotation.
    const weight = (invU * invV) ** 2;
    const ax = uy * v2 * weight, ay = -ux * v2 * weight;
    const cx = -vy * u2 * weight, cy = vx * u2 * weight;
    const rate = VELOCITY_TO_SECONDS * (ax * (a.velocity.x - b.velocity.x) + ay * (a.velocity.y - b.velocity.y)
      + cx * (c.velocity.x - b.velocity.x) + cy * (c.velocity.y - b.velocity.y));
    fax -= friction * rate * ax; fay -= friction * rate * ay;
    fcx -= friction * rate * cx; fcy -= friction * rate * cy;
  }
  a.force.x += fax * FORCE_TO_MATTER; a.force.y += fay * FORCE_TO_MATTER;
  c.force.x += fcx * FORCE_TO_MATTER; c.force.y += fcy * FORCE_TO_MATTER;
  b.force.x -= (fax + fcx) * FORCE_TO_MATTER; b.force.y -= (fay + fcy) * FORCE_TO_MATTER;
}

class PuppetWorld {
  constructor(width, height, figure = "drawing") {
    this.width = width;
    this.height = height;
    this.settings = { ...DEFAULT_SETTINGS };
    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0, scale: 0 }, enableSleeping: false });
    this.reset(figure);
  }

  reset(figure = this.figure) {
    Matter.Composite.clear(this.engine.world, false, true);
    Matter.Engine.clear(this.engine);
    this.nodes = {};
    this.figure = figure;
    const drawing = figure === "drawing";
    const angle = drawing ? 0 : -0.54;
    const pose = Object.entries(drawing ? DRAWING_POSE : REST_POSE).map(([name, [x, y, mass, radius]]) => ({
      name, mass, radius,
      x: x * Math.cos(angle) - y * Math.sin(angle),
      y: x * Math.sin(angle) + y * Math.cos(angle),
    }));
    const xs = pose.map(p => p.x), ys = pose.map(p => p.y);
    const dx = (this.width - Math.min(...xs) - Math.max(...xs)) / 2;
    const dy = (this.height - Math.min(...ys) - Math.max(...ys)) / 2;

    for (const p of pose) {
      const node = Matter.Bodies.circle(p.x + dx, p.y + dy, p.radius, {
        label: p.name, frictionAir: 0, friction: 0, frictionStatic: 0, collisionFilter: { mask: 0 },
      });
      Matter.Body.setMass(node, p.mass);
      Matter.Body.setInertia(node, Infinity);
      this.nodes[p.name] = node;
    }
    this.particles = Object.values(this.nodes);
    Matter.Composite.add(this.engine.world, this.particles);
    this.anchor = { ...this.point("crown") };
    this.target = { ...this.anchor };
    this.quietTime = Infinity;
    this.gripTime = Infinity;
    // Elastic forces store energy in the links. Positional constraint corrections
    // would remove part of the relative motion on every tick, even in a vacuum.
    this.links = SKELETON.map(([from, to, firmness]) => {
      const a = this.nodes[from], b = this.nodes[to];
      const length = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
      const core = 0.40 * length;
      return {
        a, b, firmness, reducedMass: 1 / (a.inverseMass + b.inverseMass), core2: core * core,
        rest: Math.hypot(length, core), range2: (0.30 * length) ** 2,
      };
    });
    this.hinges = HINGES.map(spec => createHinge(this.nodes, spec));
    this.setSettings(this.settings);
  }

  point(name) {
    return this.nodes[name].position;
  }

  get cordLength() {
    const crown = this.point("crown");
    return Math.hypot(this.anchor.x - crown.x, this.anchor.y - crown.y);
  }

  setSettings(values) {
    Object.assign(this.settings, values);
    const { joints, damping } = this.settings;
    const axialFrequency = 42 + 58 * joints * joints;
    for (const link of this.links) {
      const omega = axialFrequency * Math.sqrt(link.firmness);
      link.stiffness = link.reducedMass * omega * omega;
      link.friction = link.reducedMass * omega * damping;
    }
    for (const hinge of this.hinges) {
      const omega = hinge.frequency * (0.48 + 1.24 * joints);
      hinge.stiffness = hinge.inertia * omega * omega * (1 + BEND_CORE ** 2);
      hinge.friction = hinge.inertia * omega * damping;
    }
    this.cordStiffness = 180 + 850 * this.settings.cord * this.settings.cord;
    this.gripDuration = 0.26 + 0.36 * (1 - this.settings.cord);
  }

  setTarget(x, y) {
    x = clamp(x, 0, this.width); y = clamp(y, 0, this.height);
    if (x === this.target.x && y === this.target.y) return;
    this.target.x = x; this.target.y = y;
    this.quietTime = 0; this.gripTime = 0;
  }

  step() {
    for (let n = 0; n < SUBSTEPS; n++) {
      this.advanceAnchor();
      for (const link of this.links) applyLink(link);
      for (const hinge of this.hinges) applyHinge(hinge);
      this.applyEdges();
      this.pullCrown();
      Matter.Engine.update(this.engine, SUBSTEP_MS);
    }
  }

  advanceAnchor() {
    this.quietTime += DT;
    const dx = this.target.x - this.anchor.x, dy = this.target.y - this.anchor.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.15 && this.quietTime >= 0.08) {
      this.anchor.x = this.target.x; this.anchor.y = this.target.y;
      this.gripTime += DT;
      return;
    }
    const blend = Math.min(-Math.expm1(-DT / 0.065), 2600 * DT / Math.max(distance, 1e-8));
    this.anchor.x += dx * blend; this.anchor.y += dy * blend;
  }

  pullCrown() {
    const crown = this.nodes.crown;
    const dx = this.anchor.x - crown.position.x;
    const dy = this.anchor.y - crown.position.y;
    if (this.gripTime === 0) {
      // Zero rest length: even the smallest separation pulls toward the mouse.
      const gain = Math.min(this.cordStiffness, MAX_HAND_FORCE / Math.max(1e-8, Math.hypot(dx, dy)));
      crown.force.x += gain * dx * FORCE_TO_MATTER;
      crown.force.y += gain * dy * FORCE_TO_MATTER;
      return;
    }

    // The stationary hand takes hold of the crown. Solve that one contact implicitly
    // as its compliance falls to zero. Every other mass keeps its own velocity.
    const remaining = this.gripDuration - this.gripTime;
    if (remaining <= 0) {
      this.gripTime = Infinity;
      Matter.Body.setPosition(crown, this.anchor);
      Matter.Body.setVelocity(crown, { x: 0, y: 0 });
    } else {
      const omega = Math.max(Math.sqrt(this.cordStiffness / crown.mass), 4 / remaining);
      const denominator = (1 + DT * omega) ** 2;
      const ax = crown.force.x * crown.inverseMass / FORCE_TO_MATTER + omega * omega * dx;
      const ay = crown.force.y * crown.inverseMass / FORCE_TO_MATTER + omega * omega * dy;
      Matter.Body.setVelocity(crown, {
        x: (crown.velocity.x + DT * ax / VELOCITY_TO_SECONDS) / denominator,
        y: (crown.velocity.y + DT * ay / VELOCITY_TO_SECONDS) / denominator,
      });
    }
    crown.force.x = 0; crown.force.y = 0;
  }

  applyEdges() {
    // Frictionless spring walls exchange kinetic and elastic energy on impact.
    for (const node of this.particles) {
      const r = node === this.nodes.crown ? 0 : node.circleRadius;
      const { x, y } = node.position;
      const stiffness = node.mass * WALL_FREQUENCY ** 2 * FORCE_TO_MATTER;
      node.force.x += stiffness * (clamp(x, r, this.width - r) - x);
      node.force.y += stiffness * (clamp(y, r, this.height - r) - y);
    }
  }

  resize(width, height) {
    const points = [this.anchor, this.target, ...Object.values(this.nodes).map(node => node.position)];
    function fit(axis, oldSize, newSize) {
      const values = points.map(point => point[axis]);
      const lower = 14 - Math.min(...values);
      const upper = newSize - 14 - Math.max(...values);
      return lower <= upper ? clamp((newSize - oldSize) / 2, lower, upper) : (lower + upper) / 2;
    }
    const shift = { x: fit("x", this.width, width), y: fit("y", this.height, height) };
    for (const node of Object.values(this.nodes)) Matter.Body.translate(node, shift);
    this.anchor.x += shift.x; this.anchor.y += shift.y;
    this.width = width; this.height = height;
    this.target.x += shift.x; this.target.y += shift.y;
    this.setTarget(this.target.x, this.target.y);
    return shift;
  }
}
