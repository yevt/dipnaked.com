// SVG units / second². Every disc falls with the same acceleration.
export const gravity = 1000;
export const originalGravity = 1800;

// Preserve the first puzzle study alongside the slower reverse-fall version.
export function originalFallPose(piece, elapsed) {
  const t = Math.max(0, elapsed - piece.dropDelay);
  return {x: piece.drift * t, y: originalGravity * t * t / 2, angle: piece.spin * t};
}

export function originalRisePose(piece, elapsed) {
  const progress = Math.max(0, Math.min(1, (elapsed - piece.riseDelay) / piece.riseDuration));
  const remaining = (1 - progress) ** 2;
  return {x: piece.startX * remaining, y: piece.startY * remaining, angle: piece.tilt * remaining};
}

export function fallPose(piece, elapsed) {
  const t = Math.max(0, elapsed - piece.dropDelay);
  const displacement = t * t / 2;
  return {x: piece.sideAcceleration * displacement, y: gravity * displacement,
    angle: piece.angularAcceleration * displacement};
}

export function risePose(piece, elapsed) {
  const progress = Math.max(0, Math.min(1, (elapsed - piece.riseDelay) / piece.riseDuration));
  // A fast lift with a longer, softer finish; velocity and acceleration reach zero.
  const remaining = (1 - progress) ** 4;
  return {x: piece.startX * remaining, y: piece.startY * remaining, angle: piece.tilt * remaining};
}

export function createPuzzle(svg, variant, floor = 272) {
  const original = variant === 'original';
  const acceleration = original ? originalGravity : gravity;
  const rise = original ? originalRisePose : risePose;
  const fall = original ? originalFallPose : fallPose;
  const pieces = [];
  const glyphs = new Map([...svg.querySelectorAll('[data-hints] > [data-cell]')]
    .map(glyph => [glyph.getAttribute('data-cell'), glyph]));
  // The demo's lower edge is 272; the site supplies its actual viewport edge.
  const signed = range => (Math.random() * 2 - 1) * range;
  function wrap(node, x, y, radius, kind, glyph) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.dataset.piece = kind;
    node.before(group);
    group.append(node);
    if (glyph) group.append(glyph);
    const motion = original ? {
      riseDelay: Math.random() * .14,
      riseDuration: .58 + Math.random() * .14,
      startX: signed(36), startY: floor + radius + 16 + Math.random() * 48 - y,
      tilt: signed(55), dropDelay: Math.random() * .09,
      drift: signed(65), spin: signed(140),
    } : parkingPiece(y, radius);
    pieces.push({element: group, x, y, radius, ...motion});
  }
  function parkingPiece(y, radius) {
    const startY = floor + radius + 16 + Math.random() * 48 - y;
    const riseDelay = Math.random() * .08;
    const landingTime = .85 + Math.random() * .18;
    return {
      riseDelay, riseDuration: landingTime - riseDelay,
      startX: signed(36), startY,
      tilt: signed(55), dropDelay: Math.random() * .04,
      sideAcceleration: signed(130), angularAcceleration: signed(220),
    };
  }
  for (const circle of svg.querySelectorAll('[data-backing] > circle')) {
    const x = Number(circle.getAttribute('cx')), y = Number(circle.getAttribute('cy'));
    wrap(circle, x, y, Number(circle.getAttribute('r')), 'black', glyphs.get(`${x},${y}`));
  }
  svg.querySelector('[data-hints]').remove();
  for (const rotor of svg.querySelectorAll('[data-rotor]')) {
    const circle = rotor.querySelector('circle');
    wrap(rotor, Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy')),
      Number(circle.getAttribute('r')), 'white');
  }

  let frame = 0;
  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  function apply(pose, elapsed) {
    for (const piece of pieces) {
      const p = pose(piece, elapsed);
      piece.element.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${p.angle} ${piece.x} ${piece.y})`);
    }
  }
  function play(pose, duration, finish) {
    cancel();
    apply(pose, 0);
    const start = performance.now();
    function tick(now) {
      const elapsed = (now - start) / 1000;
      apply(pose, elapsed);
      if (elapsed < duration) frame = requestAnimationFrame(tick);
      else { frame = 0; finish(); }
    }
    frame = requestAnimationFrame(tick);
  }
  return {
    cancel,
    show(finish) {
      play(rise, Math.max(...pieces.map(p => p.riseDelay + p.riseDuration)), () => {
        for (const piece of pieces) piece.element.removeAttribute('transform');
        finish();
      });
    },
    hide(finish, exitFloor = floor) {
      const duration = Math.max(...pieces.map(p =>
        p.dropDelay + Math.sqrt(2 * (exitFloor + p.radius + 12 - p.y) / acceleration)));
      play(fall, duration, finish);
    },
  };
}
