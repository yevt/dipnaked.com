const radians = 180 / Math.PI;

export function angleDelta(from, to) {
  return ((to - from + 180) % 360 + 360) % 360 - 180;
}

export function followAngle(angle, target, dt) {
  return angle + angleDelta(angle, target) * (1 - Math.exp(-dt / .1));
}

export function coast(angle, speed, dt) {
  const decay = Math.exp(-dt / .65);
  return { angle: angle + speed * .65 * (1 - decay), speed: speed * decay };
}

// One quadratic Bezier in the (vertical position, scale) plane:
// below (130%, 1), control point (-32%, 1.2), resting place (0%, 1).
export function panelPose(progress) {
  const remaining = 1 - progress;
  return {
    y: 130 * remaining * remaining - 64 * remaining * progress,
    scale: 1 + .4 * remaining * progress,
  };
}

export function entryImpulse(vx, vy) {
  const direction = Math.abs(vx) >= Math.abs(vy) ? Math.sign(vx) : -Math.sign(vy);
  const speed = direction * Math.hypot(vx, vy) * 1.2;
  return [1, .9, 1.08, .96].map(factor => speed * factor);
}

// Coordinates are local to the 256 x 64 button; all four discs have radius 32.
export function discContact(x, y) {
  const index = Math.max(0, Math.min(3, Math.floor(x / 64)));
  const rx = x - (32 + index * 64), ry = y - 32;
  return rx * rx + ry * ry <= 32 * 32 ? {index, rx, ry} : null;
}

export class EntryTracker {
  index = null;
  constructor(mode) { this.mode = mode; }
  sample(contact) {
    const index = contact?.index ?? null;
    const entered = index !== null && (this.index === null || (this.mode === 'disc' && index !== this.index));
    // In button mode, gaps do not re-arm entry; leaving the whole button does.
    if (this.mode === 'disc' || index !== null) this.index = index;
    return entered;
  }
  leave() { this.index = null; }
}

// Tangential motion determines the sign. Radial strokes give no spin.
// The fixed radius makes strokes near the centre weaker.
export function contactSpin(rx, ry, vx, vy) {
  return (rx * vy - ry * vx) / (32 * 32) * radians;
}

export function canCatchSpin(currentSpeed, pointerSpeed) {
  // Degrees/second: let a stronger stroke catch the barely moving discs.
  return Math.abs(currentSpeed) <= 20 && Math.abs(pointerSpeed) > Math.abs(currentSpeed);
}

export function linkedSpeeds(index, speed) {
  return [0, 1, 2, 3].map(i => (i - index) % 2 === 0 ? speed : -speed);
}

export function tapSpin(rx, ry) {
  const speed = 90 + 330 * Math.min(1, Math.hypot(rx, ry) / 32);
  // The nearest edge chooses direction: right/top clockwise, left/bottom counter-clockwise.
  const direction = Math.abs(rx) >= Math.abs(ry) ? (rx < 0 ? -1 : 1) : (ry < 0 ? 1 : -1);
  return direction * speed;
}

export class PointerMotion {
  point = null;
  vx = 0;
  vy = 0;
  heading = 0;
  sample(x, y, time) {
    if (this.point) {
      const dt = (time - this.point.time) / 1000;
      if (dt <= 0) return;
      const dx = x - this.point.x, dy = y - this.point.y;
      const mix = 1 - Math.exp(-dt / .055);
      this.vx += (dx / dt - this.vx) * mix;
      this.vy += (dy / dt - this.vy) * mix;
      if (dx || dy) this.heading = Math.atan2(this.vy, this.vx) * radians;
    }
    this.point = {x, y, time};
  }
}
