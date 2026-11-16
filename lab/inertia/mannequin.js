"use strict";

// All visible parts follow the physical joints, including the elastic gaps at a stretched joint.
const MAPLE = { edge: "#503e30", shade: "#ac8053", mid: "#d3ab78", light: "#f2dcb2", rim: "#e6c797" };
const FAR_MAPLE = { edge: "#494036", shade: "#937650", mid: "#b99a70", light: "#dbc39a", rim: "#cfb487" };

function onBone(ctx, a, b, paint) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(-dx, dy));
  paint(length);
  ctx.restore();
}

function onTrunk(ctx, origin, left, right, end, paint) {
  const width = Math.max(0.01, Math.hypot(right.x - left.x, right.y - left.y));
  const length = Math.max(0.01, Math.hypot(end.x - origin.x, end.y - origin.y));
  ctx.save();
  ctx.transform((right.x - left.x) / width, (right.y - left.y) / width,
    (end.x - origin.x) / length, (end.y - origin.y) / length, origin.x, origin.y);
  paint(width / 2, length);
  ctx.restore();
}

function finishWood(ctx, width, wood) {
  const light = ctx.createLinearGradient(-width, 0, width, width * 0.14);
  light.addColorStop(0, wood.shade);
  light.addColorStop(0.21, wood.rim);
  light.addColorStop(0.38, wood.light);
  light.addColorStop(0.63, wood.mid);
  light.addColorStop(1, wood.shade);
  ctx.fillStyle = light;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = wood.edge;
  ctx.stroke();
}

function joint(ctx, point, radius, wood) {
  const { x, y } = point;
  const light = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.43, 0, x, y, radius);
  light.addColorStop(0, wood.rim);
  light.addColorStop(0.60, wood.mid);
  light.addColorStop(0.86, wood.shade);
  light.addColorStop(1, wood.edge);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = light;
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = "#413b31";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "#6c5b46";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.15, y + radius * 0.10);
  ctx.lineTo(x + radius * 0.15, y - radius * 0.10);
  ctx.lineWidth = Math.max(0.8, radius * 0.10);
  ctx.strokeStyle = "#ceba98";
  ctx.stroke();
}

function segment(ctx, a, b, restLength, topWidth, bottomWidth, wood) {
  onBone(ctx, a, b, length => {
    const give = Math.max(0, length - restLength) * 0.75;
    const top = Math.min(length * 0.34, topWidth * 0.48 + give * 0.48);
    const bottom = Math.max(length * 0.66, length - bottomWidth * 0.50 - give * 0.52);
    const height = bottom - top;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, length);
    ctx.strokeStyle = "#706a59";
    ctx.lineWidth = Math.min(topWidth, bottomWidth) * 0.96;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-topWidth * 0.65, top);
    ctx.bezierCurveTo(-topWidth * 1.09, top + height * 0.14, -topWidth, top + height * 0.36, -bottomWidth * 0.83, bottom - height * 0.14);
    ctx.quadraticCurveTo(-bottomWidth * 0.98, bottom + 1, 0, bottom + 0.6);
    ctx.quadraticCurveTo(bottomWidth * 0.96, bottom + 1, bottomWidth * 0.89, bottom - height * 0.10);
    ctx.bezierCurveTo(bottomWidth * 0.9, top + height * 0.55, topWidth * 1.18, top + height * 0.23, topWidth * 0.72, top);
    ctx.quadraticCurveTo(0, top - 1.6, -topWidth * 0.65, top);
    ctx.closePath();
    finishWood(ctx, topWidth, wood);
    ctx.strokeStyle = "#6b4b2b45";
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.moveTo(topWidth * 0.52, top + 3);
    ctx.bezierCurveTo(topWidth * 0.88, top + height * 0.28, bottomWidth * 0.47, top + height * 0.75, bottomWidth * 0.54, bottom - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-topWidth * 0.43, top + 4);
    ctx.quadraticCurveTo(-topWidth * 0.71, top + height * 0.32, -bottomWidth * 0.37, bottom - 4);
    ctx.strokeStyle = "#fff1cf60";
    ctx.stroke();
  });
}

function extremity(ctx, start, end, isFoot, side, wood) {
  onBone(ctx, start, end, length => {
    const w = isFoot ? 8.2 : 5.7;
    const heel = isFoot ? -4.5 : 0;
    const tip = length + (isFoot ? 3.5 : 3);
    ctx.beginPath();
    ctx.moveTo(-w * 0.70, heel);
    ctx.bezierCurveTo(-w * 1.1, length * 0.20, -w * 0.93, length * 0.74, -w * 0.59, tip - 1);
    ctx.quadraticCurveTo(0, tip + 2, w * 0.68, tip - 0.6);
    ctx.bezierCurveTo(w, length * 0.76, w * 0.90, length * 0.42, w * 0.64, heel + 0.6);
    ctx.quadraticCurveTo(0, heel - 1.6, -w * 0.70, heel);
    ctx.closePath();
    finishWood(ctx, w, wood);
    ctx.beginPath();
    if (isFoot) {
      ctx.moveTo(-w * 0.78, length * 0.74);
      ctx.quadraticCurveTo(0, length * 0.84, w * 0.74, length * 0.70);
    } else {
      // A carved thumb separates the palm from the forearm at a glance.
      ctx.moveTo(side * w * 0.74, length * 0.28);
      ctx.quadraticCurveTo(side * w * 1.30, length * 0.43, side * w * 0.46, length * 0.65);
    }
    ctx.lineWidth = 0.75; ctx.strokeStyle = "#765a3e99"; ctx.stroke();
  });
}

function drawLimb(ctx, world, side, leg, wood) {
  const keys = leg ? ["hip", "knee", "ankle", "toe"] : ["shoulder", "elbow", "wrist", "hand"];
  const names = keys.map(key => key + side);
  const [a, b, c, tip] = names.map(name => world.point(name));
  const [p, q, r] = names.map(name => REST_POSE[name]);
  const widths = leg ? [13.7, 9.7, 11.0, 6.3] : [9.6, 7.3, 8.4, 4.9];
  segment(ctx, a, b, Math.hypot(q[0] - p[0], q[1] - p[1]), widths[0], widths[1], wood);
  segment(ctx, b, c, Math.hypot(r[0] - q[0], r[1] - q[1]), widths[2], widths[3], wood);
  extremity(ctx, c, tip, leg, side === "L" ? -1 : 1, wood);
  joint(ctx, a, leg ? 11 : 9.4, wood);
  joint(ctx, b, leg ? 8.8 : 6.9, wood);
  joint(ctx, c, leg ? 5.7 : 4.3, wood);
}

function drawTrunk(ctx, world) {
  const neck = world.point("neck"), waist = world.point("waist");
  const hipL = world.point("hipL"), hipR = world.point("hipR");
  const hips = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  joint(ctx, waist, 12.4, FAR_MAPLE);
  onTrunk(ctx, waist, hipL, hipR, hips, (w, h) => {
    ctx.beginPath();
    ctx.moveTo(-w * 0.59, h * 0.08);
    ctx.bezierCurveTo(-w * 0.91, h * 0.14, -w * 1.15, h * 0.57, -w, h * 0.94);
    ctx.bezierCurveTo(-w * 0.78, h * 1.24, -w * 0.39, h * 1.34, 0, h * 1.35);
    ctx.bezierCurveTo(w * 0.49, h * 1.33, w, h * 1.16, w * 1.03, h * 0.87);
    ctx.quadraticCurveTo(w * 1.06, h * 0.32, w * 0.63, h * 0.06);
    ctx.quadraticCurveTo(0, h * 0.16, -w * 0.59, h * 0.08);
    ctx.closePath(); finishWood(ctx, w, MAPLE);
    ctx.beginPath();
    ctx.moveTo(-w * 0.87, h * 0.55);
    ctx.bezierCurveTo(-w * 0.34, h * 0.68, w * 0.22, h * 1.0, w * 0.37, h * 1.18);
    ctx.strokeStyle = "#81613f73"; ctx.lineWidth = 0.85; ctx.stroke();
  });
  onTrunk(ctx, neck, world.point("shoulderL"), world.point("shoulderR"), waist, (w, h) => {
    ctx.beginPath();
    ctx.moveTo(-w * 0.23, h * 0.03);
    ctx.bezierCurveTo(-w * 0.44, h * 0.03, -w * 0.80, h * 0.08, -w * 0.90, h * 0.19);
    ctx.bezierCurveTo(-w * 1.01, h * 0.37, -w * 0.82, h * 0.57, -w * 0.61, h * 0.75);
    ctx.quadraticCurveTo(-w * 0.46, h * 0.90, -w * 0.43, h * 0.94);
    ctx.quadraticCurveTo(0, h * 1.03, w * 0.47, h * 0.94);
    ctx.bezierCurveTo(w * 0.48, h * 0.76, w * 0.96, h * 0.55, w * 0.96, h * 0.30);
    ctx.quadraticCurveTo(w * 0.96, h * 0.11, w * 0.65, h * 0.07);
    ctx.quadraticCurveTo(w * 0.24, h * 0.045, w * 0.23, h * 0.02);
    ctx.quadraticCurveTo(0, h * 0.09, -w * 0.23, h * 0.03);
    ctx.closePath(); finishWood(ctx, w, MAPLE);
    ctx.lineWidth = 0.85; ctx.strokeStyle = "#906c4787";
    ctx.beginPath();
    ctx.moveTo(-w * 0.78, h * 0.24);
    ctx.quadraticCurveTo(-w * 0.38, h * 0.10, 0, h * 0.23);
    ctx.quadraticCurveTo(w * 0.40, h * 0.12, w * 0.73, h * 0.19);
    ctx.moveTo(0, h * 0.26); ctx.quadraticCurveTo(w * 0.10, h * 0.42, w * 0.055, h * 0.53);
    ctx.moveTo(-w * 0.62, h * 0.71); ctx.quadraticCurveTo(-w * 0.23, h * 0.62, 0, h * 0.66);
    ctx.quadraticCurveTo(w * 0.24, h * 0.60, w * 0.65, h * 0.65);
    ctx.stroke();
  });
}

function drawHead(ctx, world) {
  const crown = world.point("crown"), neck = world.point("neck");
  joint(ctx, neck, 7.6, FAR_MAPLE);
  onBone(ctx, crown, neck, length => {
    const w = 16.5;
    const h = Math.min(length, REST_POSE.neck[1] - REST_POSE.crown[1]);
    ctx.beginPath(); ctx.moveTo(0, h * 0.76); ctx.lineTo(0, length);
    ctx.strokeStyle = "#75664f"; ctx.lineWidth = 7.6; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-w * 0.69, 0, -w * 1.08, h * 0.16, -w, h * 0.41);
    ctx.bezierCurveTo(-w * 1.04, h * 0.59, -w * 0.68, h * 0.76, -w * 0.33, h * 0.85);
    ctx.quadraticCurveTo(w * 0.02, h * 0.92, w * 0.46, h * 0.84);
    ctx.quadraticCurveTo(w * 0.75, h * 0.77, w * 0.78, h * 0.65);
    ctx.quadraticCurveTo(w * 1.22, h * 0.63, w * 1.02, h * 0.55);
    ctx.quadraticCurveTo(w * 0.91, h * 0.46, w * 0.91, h * 0.36);
    ctx.bezierCurveTo(w * 0.95, h * 0.14, w * 0.58, h * 0.01, 0, 0);
    ctx.closePath(); finishWood(ctx, w, MAPLE);
    ctx.beginPath();
    ctx.moveTo(w * 0.33, h * 0.12);
    ctx.bezierCurveTo(w * 0.64, h * 0.27, w * 0.65, h * 0.35, w * 0.61, h * 0.43);
    ctx.quadraticCurveTo(w * 0.79, h * 0.52, w * 0.83, h * 0.56);
    ctx.quadraticCurveTo(w * 0.73, h * 0.61, w * 0.54, h * 0.61);
    ctx.moveTo(w * 0.48, h * 0.70); ctx.lineTo(w * 0.78, h * 0.69);
    ctx.moveTo(-w * 0.85, h * 0.44); ctx.quadraticCurveTo(-w * 0.50, h * 0.39, -w * 0.53, h * 0.53);
    ctx.quadraticCurveTo(-w * 0.62, h * 0.64, -w * 0.75, h * 0.59);
    ctx.strokeStyle = "#825f418c"; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.10, h * 0.41); ctx.quadraticCurveTo(w * 0.33, h * 0.37, w * 0.48, h * 0.40);
    ctx.strokeStyle = "#795c41"; ctx.stroke();
  });
}

function drawCord(ctx, world) {
  const a = world.anchor, b = world.point("crown");
  if (a.x === b.x && a.y === b.y) return;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = world.figure === "drawing" ? "#d95a35" : "#f98b60";
  ctx.lineCap = "butt";
  ctx.lineWidth = 1.8; ctx.stroke();
}

function drawRig(ctx, world, scale) {
  const chains = [
    ["crown", "neck", "waist"], ["shoulderL", "neck", "shoulderR"],
    ["shoulderL", "elbowL", "wristL", "handL"], ["shoulderR", "elbowR", "wristR", "handR"],
    ["waist", "hipL", "kneeL", "ankleL", "toeL"], ["waist", "hipR", "kneeR", "ankleR", "toeR"],
    ["hipL", "hipR"],
  ];
  ctx.save();
  ctx.beginPath();
  for (const names of chains) {
    const first = world.point(names[0]); ctx.moveTo(first.x, first.y);
    for (let i = 1; i < names.length; i++) {
      const p = world.point(names[i]); ctx.lineTo(p.x, p.y);
    }
  }
  ctx.strokeStyle = "#fff5eac9"; ctx.lineWidth = 2.8 / scale; ctx.stroke();
  ctx.strokeStyle = "#c24c2c"; ctx.lineWidth = 1.25 / scale; ctx.stroke();
  ctx.restore();
}

function renderScene(ctx, world, scale, dpr, showBones) {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.clearRect(0, 0, world.width, world.height);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (world.figure === "drawing") {
    if (drawingLayers) for (const layer of drawingLayers) drawDrawingLayer(ctx, layer, world);
  } else {
    drawLimb(ctx, world, "L", false, FAR_MAPLE);
    drawLimb(ctx, world, "L", true, FAR_MAPLE);
    drawLimb(ctx, world, "R", true, MAPLE);
    drawTrunk(ctx, world);
    drawLimb(ctx, world, "R", false, MAPLE);
    drawHead(ctx, world);
  }
  if (showBones) drawRig(ctx, world, scale);
  drawCord(ctx, world);
}
