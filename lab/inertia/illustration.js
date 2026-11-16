"use strict";

// Cut lines in source pixels. The original PNG is the texture for every piece.
// The chalk-white paper inside the silhouette is part of the drawing.
const FACE_OUTLINE =
  "M378 208 Q391 204 418 204 Q430 204 433 220 L439 246 Q443 257 452 257 L465 250 " +
  "Q472 267 468 291 Q463 320 454 350 L450 383 Q445 399 421 408 Q397 418 371 409 " +
  "Q343 407 337 388 Q329 368 326 339 L321 300 Q318 259 325 241 Q333 234 348 228 " +
  "L362 225 Q369 214 378 208 Z";

const DRAWING_PARTS = [
  {
    chain: ["hipL", "kneeL", "ankleL", "toeL"], box: [263, 687, 538, 1581],
    outline: "M276 715 Q314 687 361 696 Q403 701 413 758 L420 805 Q420 854 433 908 " +
      "Q440 970 446 1016 Q454 1088 467 1147 Q483 1207 494 1260 L505 1361 Q513 1426 520 1476 " +
      "L529 1518 Q535 1540 534 1555 Q529 1569 506 1574 Q458 1580 383 1576 " +
      "Q366 1571 361 1556 L357 1523 Q351 1487 346 1447 L337 1373 L330 1320 " +
      "Q322 1285 314 1259 L308 1199 Q310 1173 308 1145 L297 1081 Q288 1035 287 990 " +
      "L284 931 Q285 899 286 883 Q282 842 272 797 L266 746 Z",
  },
  {
    chain: ["hipR", "kneeR", "ankleR", "toeR"], box: [393, 690, 693, 1582],
    outline: "M405 718 Q452 690 500 714 Q511 755 525 793 L540 845 Q548 888 553 930 " +
      "Q560 958 566 977 L572 1033 Q576 1071 586 1090 L592 1176 Q594 1209 605 1239 " +
      "L616 1293 Q623 1319 630 1354 L643 1383 Q652 1399 664 1415 L677 1462 " +
      "Q682 1488 691 1501 L686 1518 L685 1549 Q685 1565 668 1574 Q635 1581 570 1577 " +
      "L545 1574 Q532 1562 526 1547 Q523 1517 515 1484 L504 1435 Q499 1398 492 1368 " +
      "L480 1280 Q476 1246 466 1208 L452 1150 Q441 1102 435 1056 L427 1000 " +
      "Q420 959 420 914 Q414 870 406 839 L396 806 Z",
  },
  {
    torso: true, box: [201, 10, 612, 868], paper: FACE_OUTLINE,
    outline: "M248 13 Q254 17 259 39 Q267 77 294 109 L318 145 Q327 193 338 215 " +
      "Q346 231 361 228 Q368 276 378 348 Q386 383 399 392 Q420 375 432 325 L449 259 " +
      "Q464 251 485 222 Q522 168 554 135 Q575 113 594 109 Q606 135 608 164 " +
      "Q581 205 558 252 Q543 278 537 302 Q535 369 529 426 L528 531 Q525 605 523 673 " +
      "L516 738 Q517 759 520 778 Q494 799 471 805 Q445 811 417 800 " +
      "Q393 807 365 812 Q328 815 297 799 Q282 792 276 778 Q263 743 265 713 " +
      "L266 666 Q256 607 254 548 L247 453 Q244 376 241 307 L239 224 " +
      "Q233 160 219 119 Q208 88 215 70 Q234 40 248 13 Z",
  },
  {
    chain: ["shoulderL", "elbowL", "wristL", "handL"], box: [194, 9, 283, 901],
    outline: "M248 13 Q256 21 264 64 Q254 115 250 168 L246 211 Q254 218 258 268 " +
      "L266 413 Q271 471 272 529 L272 608 Q269 649 266 679 Q264 714 275 752 " +
      "Q281 788 279 818 L278 854 Q277 870 270 872 Q257 874 247 860 " +
      "Q251 874 264 880 Q278 882 276 893 Q271 901 253 897 Q226 891 207 868 " +
      "Q204 820 206 768 Q208 748 230 700 L237 682 Q221 615 215 563 L203 519 " +
      "Q198 472 198 427 L196 368 L201 264 Q197 233 200 201 L200 127 " +
      "Q203 94 214 72 Q228 50 232 29 Z",
  },
  {
    chain: ["shoulderR", "elbowR", "wristR", "handR"], box: [495, 106, 614, 937],
    outline: "M591 109 Q603 112 606 146 Q614 172 611 196 L603 242 Q597 282 590 324 " +
      "L585 378 L585 451 Q586 494 580 532 Q578 572 572 605 L566 648 L561 710 " +
      "Q571 711 581 731 Q595 751 599 779 L605 822 Q608 851 603 873 Q600 889 592 895 " +
      "Q590 912 581 922 L575 922 Q571 939 558 936 Q549 934 548 923 L548 866 " +
      "Q543 846 535 830 Q529 842 517 851 Q505 857 502 849 L500 813 Q497 785 504 759 " +
      "Q508 736 506 704 L507 652 Q507 600 512 555 L513 478 Q512 414 515 356 " +
      "Q516 306 531 263 Q553 211 568 173 Q579 143 579 124 Z",
  },
  { head: true, box: [315, 201, 475, 418], outline: FACE_OUTLINE },
];

const TORSO_CAGE = [
  ["shoulderL", "shoulderR", "neck"], ["shoulderL", "neck", "waist"], ["neck", "shoulderR", "waist"],
  ["shoulderL", "waist", "hipL"], ["waist", "shoulderR", "hipR"], ["hipL", "waist", "hipR"],
];

function cutPaperLayer(image, part) {
  const [left, top, right, bottom] = part.box;
  const texture = document.createElement("canvas");
  texture.width = right - left; texture.height = bottom - top;
  const ctx = texture.getContext("2d");
  ctx.translate(-left, -top);
  ctx.clip(new Path2D(part.outline));
  ctx.drawImage(image, left, top, texture.width, texture.height, left, top, texture.width, texture.height);
  // The mask can turn separately. Give it clean paper behind the face on the chest.
  if (part.paper) { ctx.fillStyle = "white"; ctx.fill(new Path2D(part.paper)); }
  return texture;
}

function makeSkinBone(from, to) {
  const [x, y] = DRAWING_JOINTS[from], [bx, by] = DRAWING_JOINTS[to];
  const length = Math.hypot(bx - x, by - y);
  return { from, to, x, y, length, ux: (bx - x) / length, uy: (by - y) / length };
}

function poseBone(bone, world) {
  const a = world.point(bone.from), b = world.point(bone.to);
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  const nx = length > 1e-6 ? -dy / length : -bone.uy;
  const ny = length > 1e-6 ? dx / length :  bone.ux;
  // Stretch along the bone. The transverse dimension retains the drawn line width.
  bone.a = dx / bone.length * bone.ux - nx * DRAWING_SCALE * bone.uy;
  bone.b = dy / bone.length * bone.ux - ny * DRAWING_SCALE * bone.uy;
  bone.c = dx / bone.length * bone.uy + nx * DRAWING_SCALE * bone.ux;
  bone.d = dy / bone.length * bone.uy + ny * DRAWING_SCALE * bone.ux;
  bone.e = a.x - bone.a * bone.x - bone.c * bone.y;
  bone.f = a.y - bone.b * bone.x - bone.d * bone.y;
  bone.angle = Math.atan2(-bone.uy * ny - bone.ux * nx, bone.ux * ny - bone.uy * nx);
  bone.stretch = length / bone.length - DRAWING_SCALE;
}

function poseJointSection(section, world) {
  const { before, after, t } = section;
  // Interpolate rotation separately from axial stretch. Simply averaging two
  // opposing transforms would pinch the ink down to a line at a folded elbow.
  const delta = after.angle - before.angle;
  const angle = before.angle + t * Math.atan2(Math.sin(delta), Math.cos(delta));
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const k0 = (1 - t) * before.stretch, k1 = t * after.stretch;
  const xx = DRAWING_SCALE + k0 * before.ux ** 2 + k1 * after.ux ** 2;
  const xy = k0 * before.ux * before.uy + k1 * after.ux * after.uy;
  const yy = DRAWING_SCALE + k0 * before.uy ** 2 + k1 * after.uy ** 2;
  section.a = cos * xx - sin * xy; section.b = sin * xx + cos * xy;
  section.c = cos * xy - sin * yy; section.d = sin * xy + cos * yy;
  const p = world.point(after.from);
  section.e = p.x - section.a * after.x - section.c * after.y;
  section.f = p.y - section.b * after.x - section.d * after.y;
}

function bindToTorso(x, y) {
  let best, lowest = Infinity;
  for (const names of TORSO_CAGE) {
    const [[ax, ay], [bx, by], [cx, cy]] = names.map(name => DRAWING_JOINTS[name]);
    const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const wb = ((x - ax) * (cy - ay) - (y - ay) * (cx - ax)) / det;
    const wc = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / det;
    const weights = [1 - wb - wc, wb, wc];
    const outside = weights.reduce((sum, w) => sum + Math.min(0, w) ** 2, 0);
    if (outside < lowest) { lowest = outside; best = { names, weights }; }
    if (outside < 1e-12) break;
  }
  return best;
}

function makeLimbRows(part, bones, sections) {
  const [left, top, right, bottom] = part.box;
  const joints = part.chain.map(name => DRAWING_JOINTS[name]);
  const bands = [1, 2].map(i => 0.22 * Math.min(bones[i - 1].length, bones[i].length));
  const rootBand = Math.min(82, bones[0].length * 0.27);
  const ys = [top, joints[0][1], joints[0][1] + rootBand / 2, joints[0][1] + rootBand, bottom];
  for (let i = 1; i <= 2; i++) {
    const y = joints[i][1], band = bands[i - 1];
    ys.push(y - band, y - band / 2, y, y + band / 2, y + band);
  }
  return ys.sort((a, b) => a - b).map(y => {
    const segment = y <= joints[1][1] ? 0 : y <= joints[2][1] ? 1 : 2;
    const [ax, ay] = joints[segment], [bx, by] = joints[segment + 1];
    const center = clamp(ax + (bx - ax) * (y - ay) / (by - ay), left + 2, right - 2);
    let frame = bones[segment];
    for (let i = 1; i <= 2; i++) {
      const band = bands[i - 1], delta = y - joints[i][1];
      if (Math.abs(delta) < band) {
        const t = (delta / band + 1) / 2;
        frame = { before: bones[i - 1], after: bones[i], t: t * t * (3 - 2 * t) };
        sections.push(frame);
      }
    }
    // The peaks of the two shoulders and the tops of the thighs belong to the
    // torso until the limb clears its socket. Both layers share that deformation.
    const root = clamp((y - joints[0][1]) / rootBand, 0, 1);
    const limbWeight = root * root * (3 - 2 * root);
    return [left, center, right].map(x => ({
      x, y, frame, limbWeight, cage: limbWeight < 1 ? bindToTorso(x, y) : null,
    }));
  });
}

function makeTorsoRows(part) {
  const [left, top, right, bottom] = part.box;
  const xs = [left, 242, 343, 395, 476, 577, right];
  const ys = [top, 88, 165, 250, 402, 490, 581, 685, 765, 784, bottom];
  return ys.map(y => xs.map(x => ({ x, y, cage: bindToTorso(x, y) })));
}

function skinTriangle(p, q, r, box) {
  const qx = q.x - p.x, qy = q.y - p.y, rx = r.x - p.x, ry = r.y - p.y;
  const det = qx * ry - qy * rx;
  // Overlap adjacent clips by a fraction of a screen pixel to avoid hairline
  // cracks from Canvas antialiasing. The texture itself has a transparent edge.
  const lp = Math.hypot(q.x - r.x, q.y - r.y), lq = Math.hypot(rx, ry), lr = Math.hypot(qx, qy);
  const perimeter = lp + lq + lr;
  const ix = (lp * p.x + lq * q.x + lr * r.x) / perimeter;
  const iy = (lp * p.y + lq * q.y + lr * r.y) / perimeter;
  const expand = Math.min(0.4, 2 * perimeter / Math.abs(det));
  const clip = new Path2D();
  clip.moveTo(p.x + (p.x - ix) * expand, p.y + (p.y - iy) * expand);
  clip.lineTo(q.x + (q.x - ix) * expand, q.y + (q.y - iy) * expand);
  clip.lineTo(r.x + (r.x - ix) * expand, r.y + (r.y - iy) * expand);
  clip.closePath();
  const x = Math.max(box[0], Math.floor(Math.min(p.x, q.x, r.x)) - 4);
  const y = Math.max(box[1], Math.floor(Math.min(p.y, q.y, r.y)) - 4);
  const w = Math.min(box[2], Math.ceil(Math.max(p.x, q.x, r.x)) + 4) - x;
  const h = Math.min(box[3], Math.ceil(Math.max(p.y, q.y, r.y)) + 4) - y;
  return { p, q, r, clip, u: ry / det, v: -qy / det, s: -rx / det, t: qx / det, x, y, w, h };
}

function makeDrawingLayer(image, part) {
  const texture = cutPaperLayer(image, part);
  if (part.head) return { ...part, texture, bones: [makeSkinBone("crown", "neck")] };
  const bones = part.chain ? part.chain.slice(1).map((to, i) => makeSkinBone(part.chain[i], to)) : [];
  const sections = [];
  const rows = part.torso ? makeTorsoRows(part) : makeLimbRows(part, bones, sections);
  const triangles = [];
  for (let i = 1; i < rows.length; i++) {
    for (let j = 1; j < rows[i].length; j++) {
      const a = rows[i - 1][j - 1], b = rows[i - 1][j], c = rows[i][j], d = rows[i][j - 1];
      triangles.push(skinTriangle(a, b, c, part.box), skinTriangle(a, c, d, part.box));
    }
  }
  return { ...part, texture, bones, sections, vertices: rows.flat(), triangles };
}

function poseSkinVertex(vertex, world) {
  let x = 0, y = 0;
  if (vertex.cage) {
    const { names, weights } = vertex.cage;
    for (let i = 0; i < names.length; i++) {
      const p = world.point(names[i]); x += weights[i] * p.x; y += weights[i] * p.y;
    }
  }
  if (vertex.frame) {
    const m = vertex.frame, t = vertex.limbWeight;
    x = (1 - t) * x + t * (m.a * vertex.x + m.c * vertex.y + m.e);
    y = (1 - t) * y + t * (m.b * vertex.x + m.d * vertex.y + m.f);
  }
  vertex.px = x; vertex.py = y;
}

function drawDrawingLayer(ctx, layer, world) {
  for (const bone of layer.bones) poseBone(bone, world);
  const [left, top] = layer.box;
  if (layer.head) {
    const m = layer.bones[0];
    ctx.save(); ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(layer.texture, left, top); ctx.restore();
    return;
  }
  for (const section of layer.sections) poseJointSection(section, world);
  for (const vertex of layer.vertices) poseSkinVertex(vertex, world);
  for (const tri of layer.triangles) {
    const { p, q, r, x, y, w, h } = tri;
    const dx1 = q.px - p.px, dy1 = q.py - p.py, dx2 = r.px - p.px, dy2 = r.py - p.py;
    const a = dx1 * tri.u + dx2 * tri.v, b = dy1 * tri.u + dy2 * tri.v;
    const c = dx1 * tri.s + dx2 * tri.t, d = dy1 * tri.s + dy2 * tri.t;
    ctx.save();
    ctx.transform(a, b, c, d, p.px - a * p.x - c * p.y, p.py - b * p.x - d * p.y);
    ctx.clip(tri.clip);
    ctx.drawImage(layer.texture, x - left, y - top, w, h, x, y, w, h);
    ctx.restore();
  }
}

let drawingLayers;
async function loadDrawing() {
  const image = new Image();
  image.src = "assets/20260329_005852.png";
  await image.decode();
  drawingLayers = DRAWING_PARTS.map(part => makeDrawingLayer(image, part));
}
