(function () {
  "use strict";

  const config = Object.assign({
    id: 0,
    word: "drowning",
    gravity: 330,
    fixedStep: 1 / 120,
    waterLevel: 0.54,
    floorLevel: 0.95,
    fontScale: 0.074,
    fontMin: 54,
    fontMax: 96,
    fontWeight: 840,
    startAngle: 0.36,
    startXSpread: 0.13,
    sinkBias: 1.28,
    buoyancy: 0.34,
    normalDrag: 1.6,
    viscousDrag: 2.6,
    bulkDragX: 0.55,
    bulkDragY: 2.15,
    angularDamping: 0.52,
    impactImpulse: 9.5,
    impactLoss: 0.78,
    splashLevel: 1,
    current: 0,
    densityGradient: 0,
    turbulenceTorque: 0,
    bubbles: false,
    bubbleRate: 0,
    restBubbleRate: 0,
    bubbleSurfaceKick: 0,
    sediment: false,
    contourSamples: 260
  }, window.EXPERIMENT_CONFIG || {});

  const params = new URLSearchParams(window.location.search);
  let rng = Math.random;

  if (params.get("seed")) {
    rng = seededGenerator(params.get("seed"));
  }

  const root = document.querySelector("#app") || document.body;
  root.innerHTML = `
    <main class="stage" aria-label="Drowning link experiment">
      <div class="sky"></div>
      <form class="controls" id="controls">
        <input id="wordInput" maxlength="22" spellcheck="false" aria-label="Word">
        <button type="submit">Drop</button>
      </form>
      <div class="version" aria-hidden="true">E${String(config.id).padStart(2, "0")}</div>
      <div class="word-layer">
        <a class="drowning-word" id="word" href="#drowning"></a>
      </div>
      <canvas id="water" aria-hidden="true"></canvas>
      <canvas id="splash" aria-hidden="true"></canvas>
      <div class="bed"></div>
    </main>
  `;

  const style = document.createElement("style");
  style.textContent = `
    :root {
      color-scheme: dark;
      --ink: rgba(243, 249, 255, 0.96);
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at 52% 10%, rgba(230, 239, 244, 0.11), transparent 24rem),
        linear-gradient(180deg, #171b1d 0%, #11191f 53%, #071827 53%, #02090f 100%);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }

    .stage {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      isolation: isolate;
    }

    .sky {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.045), transparent 45%),
        radial-gradient(circle at 18% 92%, rgba(134, 107, 72, 0.16), transparent 18rem);
    }

    .bed {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 13vh;
      z-index: 2;
      pointer-events: none;
      background:
        linear-gradient(180deg, transparent, rgba(88, 68, 45, 0.28) 28%, rgba(96, 76, 51, 0.64)),
        repeating-linear-gradient(96deg, rgba(255, 229, 166, 0.04) 0 1px, transparent 1px 16px);
    }

    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    #water {
      z-index: 5;
    }

    #splash {
      z-index: 7;
    }

    .word-layer {
      position: absolute;
      inset: 0;
      z-index: 4;
    }

    .drowning-word {
      position: absolute;
      left: 0;
      top: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ink);
      font-weight: ${config.fontWeight};
      font-size: var(--word-size, 92px);
      line-height: 1;
      letter-spacing: 0;
      white-space: nowrap;
      text-decoration: none;
      text-shadow:
        0 1px 0 rgba(0, 0, 0, 0.36),
        0 0 1.4rem rgba(154, 218, 255, 0.14);
      user-select: none;
      touch-action: manipulation;
      will-change: left, top, transform, filter, opacity;
    }

    .drowning-word:focus-visible {
      outline: 2px solid rgba(238, 250, 255, 0.9);
      outline-offset: 0.24em;
    }

    .drowning-word[data-underwater="true"] {
      color: rgba(211, 235, 247, 0.75);
      filter: blur(0.35px) contrast(0.88) saturate(0.82);
      text-shadow: 0 0 0.85rem rgba(111, 205, 255, 0.42);
    }

    .controls {
      position: absolute;
      top: clamp(0.8rem, 2vw, 1.4rem);
      right: clamp(0.8rem, 2vw, 1.4rem);
      z-index: 9;
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .version {
      position: absolute;
      left: clamp(0.8rem, 2vw, 1.4rem);
      top: clamp(0.8rem, 2vw, 1.4rem);
      z-index: 9;
      color: rgba(232, 243, 250, 0.52);
      font: 700 0.78rem/1 Inter, ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0;
      pointer-events: none;
    }

    input,
    button {
      height: 2.35rem;
      border: 1px solid rgba(222, 242, 255, 0.24);
      border-radius: 0.35rem;
      color: rgba(242, 249, 255, 0.94);
      background: rgba(7, 15, 21, 0.66);
      font: 650 0.92rem/1 Inter, ui-sans-serif, system-ui, sans-serif;
    }

    input {
      width: min(11rem, 38vw);
      padding: 0 0.72rem;
      letter-spacing: 0;
    }

    button {
      padding: 0 0.85rem;
      cursor: pointer;
    }

    input:focus-visible,
    button:focus-visible {
      outline: 2px solid rgba(238, 250, 255, 0.9);
      outline-offset: 0.22rem;
    }

    button:hover {
      background: rgba(18, 38, 51, 0.82);
    }

    @media (max-width: 620px) {
      .controls {
        left: 3.4rem;
        right: 0.8rem;
        justify-content: flex-end;
      }

      input {
        flex: 1;
        min-width: 0;
      }
    }
  `;
  document.head.appendChild(style);

  const wordEl = document.querySelector("#word");
  const wordInput = document.querySelector("#wordInput");
  const controls = document.querySelector("#controls");
  const waterCanvas = document.querySelector("#water");
  const splashCanvas = document.querySelector("#splash");
  const waterCtx = waterCanvas.getContext("2d");
  const splashCtx = splashCanvas.getContext("2d");

  wordInput.value = params.get("word") || config.word;

  const world = {
    width: 0,
    height: 0,
    dpr: 1,
    waterY: 0,
    floorY: 0,
    time: 0,
    lastNow: 0,
    accumulator: 0,
    surface: [],
    droplets: [],
    bubbles: [],
    ruptures: [],
    sediment: [],
    body: null
  };

  function seededGenerator(seedText) {
    let seed = 2166136261;
    for (let i = 0; i < seedText.length; i += 1) {
      seed ^= seedText.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }

    return function () {
      seed += 0x6D2B79F5;
      let value = seed;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function rand(min, max) {
    return min + rng() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rotatePoint(x, y, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
      x: x * c - y * s,
      y: x * s + y * c
    };
  }

  function normalize(x, y) {
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  function resizeCanvas(canvas, ctx) {
    canvas.width = Math.round(world.width * world.dpr);
    canvas.height = Math.round(world.height * world.dpr);
    ctx.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
  }

  function makeSurface() {
    const count = Math.max(132, Math.round(world.width / 6));
    world.surface = Array.from({ length: count }, (_, index) => ({
      x: (index / (count - 1)) * world.width,
      y: 0,
      vy: 0
    }));
  }

  function sampleSurface(x) {
    if (world.surface.length < 2) return world.waterY;
    const spacing = world.width / (world.surface.length - 1);
    const raw = clamp(x / spacing, 0, world.surface.length - 1);
    const left = Math.floor(raw);
    const right = Math.min(world.surface.length - 1, left + 1);
    const t = raw - left;
    return world.waterY + world.surface[left].y * (1 - t) + world.surface[right].y * t;
  }

  function disturbSurface(x, strength, radius) {
    if (!world.surface.length) return;

    const spacing = world.width / (world.surface.length - 1);
    const center = clamp(Math.round(x / spacing), 0, world.surface.length - 1);
    const pointRadius = Math.max(3, Math.round(radius / spacing));
    const impulse = Math.sign(strength) * Math.min(18, Math.sqrt(Math.abs(strength)) * 2.35);
    if (!Number.isFinite(impulse) || Math.abs(impulse) < 0.001) return;

    for (let i = center - pointRadius * 2; i <= center + pointRadius * 2; i += 1) {
      const point = world.surface[i];
      if (!point) continue;

      const d = Math.abs(i - center) / pointRadius;
      if (d <= 1) {
        point.vy += impulse * Math.cos(d * Math.PI * 0.5);
      } else if (d <= 2) {
        point.vy -= impulse * 0.23 * Math.sin((d - 1) * Math.PI);
      }
    }
  }

  function buildGlyphModel(text, fontSize) {
    const family = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif";
    const font = `${config.fontWeight} ${fontSize}px ${family}`;
    const pad = Math.ceil(fontSize * 0.28);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    ctx.font = font;
    const metrics = ctx.measureText(text);
    const left = metrics.actualBoundingBoxLeft || 0;
    const right = metrics.actualBoundingBoxRight || metrics.width;
    const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.78;
    const descent = metrics.actualBoundingBoxDescent || fontSize * 0.24;
    const width = Math.ceil(left + right + pad * 2);
    const height = Math.ceil(ascent + descent + pad * 2);

    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = font;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff";
    ctx.fillText(text, pad + left, pad + ascent);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const threshold = 0.12;
    let area = 0;
    let sumX = 0;
    let sumY = 0;

    function alphaAt(x, y) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return 0;
      return data[(y * canvas.width + x) * 4 + 3] / 255;
    }

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const a = alphaAt(x, y);
        if (a <= 0.04) continue;
        area += a;
        sumX += x * a;
        sumY += y * a;
      }
    }

    const comX = area ? sumX / area : canvas.width / 2;
    const comY = area ? sumY / area : canvas.height / 2;
    let inertia = 0;

    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const a = alphaAt(x, y);
        if (a <= 0.04) continue;
        const dx = x - comX;
        const dy = y - comY;
        inertia += (dx * dx + dy * dy) * a * 4;
      }
    }

    const raw = [];
    for (let y = 1; y < canvas.height - 1; y += 1) {
      for (let x = 1; x < canvas.width - 1; x += 1) {
        const a = alphaAt(x, y);
        if (a <= threshold) continue;

        const edge =
          alphaAt(x + 1, y) <= threshold ||
          alphaAt(x - 1, y) <= threshold ||
          alphaAt(x, y + 1) <= threshold ||
          alphaAt(x, y - 1) <= threshold;

        if (!edge) continue;

        const gx = alphaAt(x + 1, y) - alphaAt(x - 1, y);
        const gy = alphaAt(x, y + 1) - alphaAt(x, y - 1);
        let normal = normalize(-gx, -gy);
        if (Math.abs(gx) + Math.abs(gy) < 0.02) {
          normal = normalize(x - comX, y - comY);
        }

        raw.push({
          rx: x - comX,
          ry: y - comY,
          nx: normal.x,
          ny: normal.y,
          alpha: a
        });
      }
    }

    const target = clamp(config.contourSamples, 120, 520);
    const stride = Math.max(1, Math.floor(raw.length / target));
    const samples = [];
    for (let i = 0; i < raw.length; i += stride) {
      samples.push(raw[i]);
      if (samples.length >= target) break;
    }

    const sampleWeight = samples.length ? 1 / samples.length : 1;
    for (const sample of samples) {
      sample.weight = sampleWeight;
    }


    const groundProfile = [];
    const groundStep = Math.max(1, Math.round(canvas.width / 170));
    for (let x = 0; x < canvas.width; x += groundStep) {
      let bottom = -Infinity;
      for (let y = canvas.height - 1; y >= 0; y -= 1) {
        if (alphaAt(x, y) > threshold) {
          bottom = y;
          break;
        }
      }
      if (bottom !== -Infinity) {
        groundProfile.push({ rx: x - comX, ry: bottom - comY, nx: 0, ny: 1 });
      }
    }

    const minGroundRx = Math.min(...groundProfile.map((point) => point.rx));
    const maxGroundRx = Math.max(...groundProfile.map((point) => point.rx));
    const groundSpan = Math.max(1, maxGroundRx - minGroundRx);
    const baselineRy = pad + ascent - comY;
    const descenderRy = pad + ascent + descent - comY;
    const rightHalf = text.slice(Math.floor(text.length * 0.42)).toLowerCase();
    const hasRightDescender = /[gjpqy]/.test(rightHalf);
    const a = { rx: minGroundRx + groundSpan * 0.045, ry: baselineRy, nx: 0, ny: 1 };
    const b = {
      rx: maxGroundRx - groundSpan * 0.045,
      ry: hasRightDescender ? descenderRy : baselineRy,
      nx: 0,
      ny: 1
    };
    const supportDrop = b.ry - a.ry;
    const supportAngle = Math.atan2(supportDrop, b.rx - a.rx);

    const groundHull = [];
    const supportSteps = Math.max(2, Math.ceil(Math.abs(b.rx - a.rx) / 10));
    for (let step = 0; step <= supportSteps; step += 1) {
      const t = step / supportSteps;
      groundHull.push({
        rx: a.rx * (1 - t) + b.rx * t,
        ry: a.ry * (1 - t) + b.ry * t,
        nx: 0,
        ny: 1,
        weight: 1
      });
    }
    const bottomSamples = samples
      .filter((sample) => sample.ny > 0.24)
      .sort((a, b) => b.ry - a.ry)
      .slice(0, Math.max(8, Math.round(samples.length * 0.18)));

    const mass = clamp(area / 2100, 1.6, 9.5);
    const moment = clamp((inertia / Math.max(1, area)) * mass * 0.9, 28000, 320000);
    const horizontalEdge = samples.reduce((sum, p) => sum + Math.max(0, p.ny) * sampleWeight, 0);
    const verticalEdge = samples.reduce((sum, p) => sum + Math.abs(p.nx) * sampleWeight, 0);

    return {
      text,
      width: canvas.width,
      height: canvas.height,
      comX,
      comY,
      area,
      inkRatio: area / (canvas.width * canvas.height),
      mass,
      inertia: moment,
      samples,
      bottomSamples,
      groundHull,
      supportAngle,
      supportDrop,
      horizontalEdge,
      verticalEdge
    };
  }

  function makeBody(text) {
    const cleanText = (text || config.word).trim().replace(/\s+/g, " ").slice(0, 22) || config.word;
    const fontSize = clamp(world.width * config.fontScale, config.fontMin, config.fontMax);
    wordEl.textContent = cleanText;
    wordEl.href = `#${encodeURIComponent(cleanText.toLowerCase())}`;
    wordEl.style.setProperty("--word-size", `${fontSize}px`);

    const model = buildGlyphModel(cleanText, fontSize);
    wordEl.style.width = `${model.width}px`;
    wordEl.style.height = `${model.height}px`;
    wordEl.style.transformOrigin = `${model.comX}px ${model.comY}px`;

    return {
      model,
      x: world.width * rand(0.5 - config.startXSpread, 0.5 + config.startXSpread),
      y: -model.height * 0.68,
      vx: rand(-22, 22),
      vy: rand(16, 40),
      angle: rand(-config.startAngle, config.startAngle),
      omega: rand(-0.28, 0.28),
      underwater: false,
      settled: false,
      impactDone: false,
      lastBubble: 0,
      floorContactTime: 0,
      floorContacts: 0,
      floorSupport: 0,
      densityBias: config.sinkBias + clamp((0.22 - model.inkRatio) * 0.9, -0.08, 0.14)
    };
  }

  function pointWorld(body, sample) {
    const point = rotatePoint(sample.rx, sample.ry, body.angle);
    const normal = rotatePoint(sample.nx || 0, sample.ny || 0, body.angle);
    return {
      x: body.x + point.x,
      y: body.y + point.y,
      rx: point.x,
      ry: point.y,
      nx: normal.x,
      ny: normal.y
    };
  }

  function pointVelocity(body, point) {
    return {
      x: body.vx - body.omega * point.ry,
      y: body.vy + body.omega * point.rx
    };
  }

  function applyForce(body, fx, fy, rx, ry, dt) {
    body.vx += (fx / body.model.mass) * dt;
    body.vy += (fy / body.model.mass) * dt;
    body.omega += ((rx * fy - ry * fx) / body.model.inertia) * dt;
  }

  function waterFlowAt(x, y) {
    const depth = clamp((y - world.waterY) / Math.max(1, world.floorY - world.waterY), 0, 1);
    if (!config.current) return { x: 0, y: 0, depth };

    const t = world.time * 0.001;
    const slow = Math.sin(t * 0.72 + x * 0.012 + depth * 4.1);
    const deep = Math.sin(t * 0.31 - x * 0.006 + depth * 8.4);
    return {
      x: config.current * (0.35 + depth * 0.9) * (slow * 0.7 + deep * 0.3),
      y: Math.sin(t * 0.46 + x * 0.01) * config.current * 0.045 * depth,
      depth
    };
  }

  function spawnSplash(x, y, impactSpeed, width, tilt, contacts) {
    if (!config.splashLevel) return;

    const level = config.splashLevel;
    const amount = clamp(Math.round(impactSpeed / 32 + width / 28 + level * 5), 8, 56);
    const spread = clamp(width * (0.38 + level * 0.1), 22, 170);

    for (let i = 0; i < amount; i += 1) {
      const contact = contacts && contacts.length ? contacts[Math.floor(rand(0, contacts.length))] : null;
      const side = rng() < 0.5 ? -1 : 1;
      const sizeRoll = rng();
      const size = sizeRoll > 0.88 ? rand(3.4, 6.8) : rand(0.9, 3.2);

      world.droplets.push({
        x: (contact ? contact.point.x : x) + rand(-spread, spread) * 0.22,
        y: y + rand(-4, 4),
        vx: side * rand(60, 260 + level * 55) + tilt * rand(16, 62),
        vy: -rand(120, 330 + level * 70) - impactSpeed * rand(0.05, 0.2),
        age: 0,
        life: rand(0.42, 1.05 + level * 0.12),
        size,
        spin: rand(-1, 1)
      });
    }
  }

  function spawnSediment(body) {
    if (!config.sediment) return;

    const count = Math.round(rand(8, 18));
    for (let i = 0; i < count; i += 1) {
      world.sediment.push({
        x: body.x + rand(-body.model.width * 0.34, body.model.width * 0.34),
        y: world.floorY + rand(-4, 3),
        vx: rand(-18, 18),
        vy: rand(-20, -4),
        age: 0,
        life: rand(1.2, 2.7),
        size: rand(1.5, 5)
      });
    }
  }

  function processImpact(body, dt) {
    if (body.impactDone) return;

    const contacts = [];
    for (const sample of body.model.samples) {
      const point = pointWorld(body, sample);
      const velocity = pointVelocity(body, point);
      const surface = sampleSurface(point.x);
      const previousY = point.y - velocity.y * dt;

      if (previousY < surface && point.y >= surface && velocity.y > 24) {
        contacts.push({ sample, point, velocity });
      }
    }

    if (!contacts.length) return;

    body.impactDone = true;
    const avgX = contacts.reduce((sum, item) => sum + item.point.x, 0) / contacts.length;
    const avgVy = contacts.reduce((sum, item) => sum + item.velocity.y, 0) / contacts.length;
    const minX = Math.min(...contacts.map((item) => item.point.x));
    const maxX = Math.max(...contacts.map((item) => item.point.x));
    const contactWidth = clamp(maxX - minX, 18, body.model.width * 0.8);

    for (const item of contacts) {
      const shapeFactor = 0.42 + Math.max(0, item.point.ny) * 0.85 + Math.abs(item.point.nx) * 0.18;
      const impulse = clamp(item.velocity.y * config.impactImpulse * shapeFactor * 0.075 / contacts.length, 0, 42);
      disturbSurface(item.point.x, impulse, contactWidth * (0.22 + shapeFactor * 0.1));
    }

    const asymmetry = contacts.reduce((sum, item) => sum + item.point.rx * item.velocity.y, 0) /
      Math.max(1, contacts.length * body.model.width);

    body.omega += clamp(asymmetry * 2.2 + body.angle * 1.15 + body.vx * 0.004, -2.6, 2.6);
    body.vx *= config.impactLoss;
    body.vy *= config.impactLoss;
    spawnSplash(avgX, world.waterY, avgVy, contactWidth, body.angle, contacts);
  }

  function updateBody(dt) {
    const body = world.body;
    if (!body) return;

    if (body.settled) {
      maybeSpawnBubbles(body, dt);
      return;
    }

    processImpact(body, dt);
    applyForce(body, 0, body.model.mass * config.gravity * body.densityBias, 0, 0, dt);

    let submerged = 0;
    let underwaterVote = 0;

    for (const sample of body.model.samples) {
      const point = pointWorld(body, sample);
      const surface = sampleSurface(point.x);
      const depthPx = point.y - surface;
      if (depthPx <= 0) continue;

      const sub = clamp(depthPx / Math.max(22, body.model.height * 0.42), 0, 1);
      const flow = waterFlowAt(point.x, point.y);
      const density = 1 + config.densityGradient * flow.depth;
      const velocity = pointVelocity(body, point);
      const rel = {
        x: velocity.x - flow.x,
        y: velocity.y - flow.y
      };

      const vn = rel.x * point.nx + rel.y * point.ny;
      const pressure = vn > 0 ? config.normalDrag * density * vn * vn * sample.weight * sub : 0;
      const viscous = config.viscousDrag * density * sample.weight * sub;
      const lift = -body.model.mass * config.gravity * config.buoyancy * sample.weight * sub;

      const fx = -point.nx * pressure - rel.x * body.model.mass * viscous;
      const fy = -point.ny * pressure - rel.y * body.model.mass * viscous + lift;
      applyForce(body, fx, fy, point.rx, point.ry, dt);

      submerged += sample.weight * sub;
      if (point.y > world.waterY + body.model.height * 0.22) {
        underwaterVote += sample.weight;
      }

      if (depthPx < 20 && rel.y > 50) {
        disturbSurface(point.x, clamp(rel.y * sample.weight * 0.62, -3, 4.2), 18 + body.model.width * 0.035);
      }
    }

    if (submerged > 0) {
      body.vx *= 1 - clamp(config.bulkDragX * submerged * dt, 0, 0.08);
      body.vy *= 1 - clamp(config.bulkDragY * submerged * dt, 0, 0.16);
      body.omega *= 1 - clamp(config.angularDamping * submerged * dt, 0, 0.04);
      if (config.turbulenceTorque) {
        const t = world.time * 0.001;
        const torque = Math.sin(t * 1.7 + body.x * 0.015) + Math.sin(t * 0.8 + body.y * 0.02);
        body.omega += torque * config.turbulenceTorque * 4.6 * submerged * dt;
      }
    } else {
      body.omega *= 1 - 0.018 * dt;
    }

    body.vx = clamp(body.vx, -620, 620);
    body.vy = clamp(body.vy, -720, 900);
    body.omega = clamp(body.omega, -4.8, 4.8);
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.angle += body.omega * dt;
    body.underwater = underwaterVote > 0.72 || body.y - body.model.height * 0.14 > world.waterY;

    const margin = Math.max(24, body.model.width * 0.16);
    if (body.x < margin || body.x > world.width - margin) {
      body.x = clamp(body.x, margin, world.width - margin);
      body.vx *= -0.32;
      body.omega += body.vx * 0.004;
    }

    collideWithBottom(body, dt);
    maybeSpawnBubbles(body, dt);
  }

  function collideWithBottom(body, dt) {
    let deepest = -Infinity;
    let maxPenetration = 0;
    const contacts = [];

    const groundShape = body.model.groundHull && body.model.groundHull.length ? body.model.groundHull : body.model.samples;
    for (const sample of groundShape) {
      const point = pointWorld(body, sample);
      deepest = Math.max(deepest, point.y);

      if (point.y > world.floorY) {
        const velocity = pointVelocity(body, point);
        const penetration = point.y - world.floorY;
        maxPenetration = Math.max(maxPenetration, penetration);
        contacts.push({ point, velocity, penetration });
      }
    }

    body.deepest = deepest;
    body.floorContacts = contacts.length;
    body.floorSupport = 0;

    if (!contacts.length) {
      body.floorContactTime = 0;
      return;
    }

    const inv = 1 / contacts.length;
    let minX = Infinity;
    let maxX = -Infinity;

    for (const contact of contacts) {
      minX = Math.min(minX, contact.point.x);
      maxX = Math.max(maxX, contact.point.x);

      const normalForce = (contact.penetration * 1150 + Math.max(0, contact.velocity.y) * 62) * inv;
      const frictionForce = -contact.velocity.x * body.model.mass * 5.6 * inv;
      applyForce(body, frictionForce, -normalForce, contact.point.rx, contact.point.ry, dt);
    }

    body.floorSupport = maxX - minX;

    if (maxPenetration > 0.5) {
      body.y -= Math.min(9, maxPenetration * 0.42);
    }

    body.vx *= 1 - clamp(1.4 * dt, 0, 0.035);
    if (body.vy > 0) {
      body.vy *= 1 - clamp(1.2 * dt, 0, 0.03);
    }

    if (!body.bottomHit && maxPenetration > 3) {
      body.bottomHit = true;
      spawnSediment(body);
    }

    const broadSupport = body.floorSupport > body.model.width * 0.38;
    if (broadSupport) {
      body.vy *= 1 - clamp(5.5 * dt, 0, 0.08);
      body.omega *= 1 - clamp(3.8 * dt, 0, 0.05);
    }
    const quiet = Math.abs(body.vx) < 4.2 && Math.abs(body.vy) < 22 && Math.abs(body.omega) < 0.12;

    if (broadSupport && quiet) {
      body.floorContactTime += dt;
    } else {
      body.floorContactTime = Math.max(0, body.floorContactTime - dt * 0.7);
    }

    if (body.floorContactTime > 0.34) {
      body.settled = true;
      body.vx = 0;
      body.vy = 0;
      body.omega = 0;

      let finalDeepest = -Infinity;
      for (const sample of groundShape) {
        finalDeepest = Math.max(finalDeepest, pointWorld(body, sample).y);
      }
      body.y -= finalDeepest - world.floorY;
      body.deepest = world.floorY;
    }
  }
  function maybeSpawnBubbles(body, dt) {
    if (!config.bubbles) return;

    const rate = body.settled ? config.restBubbleRate : config.bubbleRate;
    if (!rate || !body.underwater) return;

    const chance = rate * dt;
    if (rng() > chance) return;

    const sourceSamples = body.model.bottomSamples.length ? body.model.bottomSamples : body.model.samples;
    const sample = sourceSamples[Math.floor(rand(0, sourceSamples.length))];
    const point = pointWorld(body, sample);

    world.bubbles.push({
      x: point.x + rand(-4, 4),
      y: point.y + rand(-4, 5),
      vx: rand(-10, 10),
      vy: -rand(22, 58),
      r: rand(2.1, 6.5),
      age: 0,
      life: rand(12.0, 18.0),
      wobble: rand(0.6, 1.8),
      phase: rand(0, Math.PI * 2)
    });
  }

  function updateSurface(dt) {
    const neighbor = 78;
    const restore = 8.8;
    const damping = 0.72;

    for (let i = 0; i < world.surface.length; i += 1) {
      const point = world.surface[i];
      const left = world.surface[i - 1]?.y ?? point.y;
      const right = world.surface[i + 1]?.y ?? point.y;
      const curvature = left + right - 2 * point.y;
      const accel = curvature * neighbor - point.y * restore - point.vy * damping;
      point.vy += accel * dt;
    }

    for (const point of world.surface) {
      point.vy = clamp(point.vy, -520, 520);
      point.y += point.vy * dt;
      if (point.y > 88) {
        const excess = point.y - 88;
        point.vy -= (excess * 72 + excess * excess * 0.42) * dt;
        point.vy *= 0.985;
        point.y = 88 + Math.atan(excess / 58) * 38;
      } else if (point.y < -64) {
        const excess = -64 - point.y;
        point.vy += (excess * 66 + excess * excess * 0.38) * dt;
        point.vy *= 0.985;
        point.y = -64 - Math.atan(excess / 48) * 34;
      }
      if (Math.abs(point.y) < 0.001 && Math.abs(point.vy) < 0.001) {
        point.y = 0;
        point.vy = 0;
      }
    }
  }

  function updateDroplets(dt) {
    for (const drop of world.droplets) {
      drop.age += dt;
      drop.vy += config.gravity * 1.36 * dt;
      drop.vx *= 1 - 0.1 * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;

      if (drop.y > sampleSurface(drop.x) && drop.vy > 0 && drop.age < drop.life) {
        disturbSurface(drop.x, drop.size * (2.4 + config.splashLevel), 14 + drop.size * 3);
        drop.age = drop.life + 1;
      }
    }

    world.droplets = world.droplets.filter((drop) => drop.age < drop.life && drop.y < world.height + 40);
  }

  function makeRupture(x, y, r) {
    world.ruptures.push({
      x,
      y,
      r: r * rand(1.15, 1.8),
      age: 0,
      life: rand(0.55, 0.95),
      phase: rand(0, Math.PI * 2)
    });
  }

  function updateBubbles(dt) {
    for (const bubble of world.bubbles) {
      bubble.age += dt;
      const wobble = Math.sin(world.time * 0.004 * bubble.wobble + bubble.phase);
      bubble.vx += wobble * 6 * dt;
      bubble.vy -= 7 * dt;
      bubble.vx *= 1 - 0.2 * dt;
      bubble.x += bubble.vx * dt;
      bubble.y += bubble.vy * dt;
      bubble.r *= 1 + 0.018 * dt;

      const surfaceY = sampleSurface(bubble.x);
      if (bubble.y <= surfaceY + bubble.r * 0.82) {
        bubble.y = surfaceY + bubble.r * 0.72;
        makeRupture(bubble.x, surfaceY, bubble.r);
        disturbSurface(bubble.x, -config.bubbleSurfaceKick * bubble.r * 0.72, 16 + bubble.r * 7);
        bubble.popped = true;
      }
    }

    world.bubbles = world.bubbles.filter((bubble) => !bubble.popped && bubble.age < bubble.life && bubble.y > -30);
  }

  function updateRuptures(dt) {
    for (const rupture of world.ruptures) {
      rupture.age += dt;
    }
    world.ruptures = world.ruptures.filter((rupture) => rupture.age < rupture.life);
  }
  function updateSediment(dt) {
    for (const mote of world.sediment) {
      mote.age += dt;
      mote.vy += 4 * dt;
      mote.vx *= 1 - 0.5 * dt;
      mote.vy *= 1 - 0.24 * dt;
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
    }

    world.sediment = world.sediment.filter((mote) => mote.age < mote.life);
  }

  function drawWater() {
    waterCtx.clearRect(0, 0, world.width, world.height);

    const fill = waterCtx.createLinearGradient(0, world.waterY, 0, world.height);
    fill.addColorStop(0, "rgba(45, 145, 181, 0.34)");
    fill.addColorStop(0.38, "rgba(16, 75, 110, 0.58)");
    fill.addColorStop(1, "rgba(2, 11, 18, 0.9)");

    waterCtx.beginPath();
    waterCtx.moveTo(0, world.waterY + world.surface[0].y);
    for (const point of world.surface) {
      waterCtx.lineTo(point.x, world.waterY + point.y);
    }
    waterCtx.lineTo(world.width, world.height);
    waterCtx.lineTo(0, world.height);
    waterCtx.closePath();
    waterCtx.fillStyle = fill;
    waterCtx.fill();

    waterCtx.save();
    waterCtx.strokeStyle = "rgba(225, 249, 255, 0.86)";
    waterCtx.lineWidth = 1.45;
    waterCtx.beginPath();
    for (let i = 0; i < world.surface.length; i += 1) {
      const point = world.surface[i];
      const y = world.waterY + point.y;
      if (i === 0) waterCtx.moveTo(point.x, y);
      else waterCtx.lineTo(point.x, y);
    }
    waterCtx.stroke();

    const body = world.body;
    if (body && body.underwater) {
      waterCtx.globalAlpha = 0.08;
      waterCtx.strokeStyle = "rgba(210, 244, 255, 0.7)";
      waterCtx.lineWidth = 1;
      for (let y = world.waterY + 48; y < world.height; y += 76) {
        waterCtx.beginPath();
        for (let x = 0; x <= world.width; x += 34) {
          const offset = Math.sin(world.time * 0.0011 + x * 0.017 + y * 0.022) * 2.5;
          if (x === 0) waterCtx.moveTo(x, y + offset);
          else waterCtx.lineTo(x, y + offset);
        }
        waterCtx.stroke();
      }
    }
    waterCtx.restore();
  }

  function drawSplashLayer() {
    splashCtx.clearRect(0, 0, world.width, world.height);
    splashCtx.lineCap = "round";

    for (const mote of world.sediment) {
      const t = mote.age / mote.life;
      splashCtx.globalAlpha = Math.max(0, 0.28 * (1 - t));
      splashCtx.fillStyle = "rgba(174, 139, 91, 0.8)";
      splashCtx.beginPath();
      splashCtx.arc(mote.x, mote.y, mote.size * (1 + t * 1.4), 0, Math.PI * 2);
      splashCtx.fill();
    }

    for (const rupture of world.ruptures) {
      const t = rupture.age / rupture.life;
      const spread = rupture.r * (1 + t * 2.2);
      const y = sampleSurface(rupture.x);
      splashCtx.globalAlpha = Math.max(0, 0.5 * (1 - t));
      splashCtx.strokeStyle = "rgba(5, 18, 28, 0.62)";
      splashCtx.lineWidth = Math.max(2.4, rupture.r * 0.42);
      splashCtx.beginPath();
      splashCtx.moveTo(rupture.x - spread * 0.48, y + Math.sin(rupture.phase + t * 4) * 0.8);
      splashCtx.lineTo(rupture.x + spread * 0.48, y + Math.cos(rupture.phase + t * 4) * 0.8);
      splashCtx.stroke();
      splashCtx.globalAlpha = Math.max(0, 0.86 * (1 - t));
      splashCtx.strokeStyle = "rgba(230, 251, 255, 0.92)";
      splashCtx.lineWidth = 1.2 + rupture.r * 0.12;
      splashCtx.beginPath();
      splashCtx.arc(rupture.x - spread * 0.34, y, spread * 0.38, Math.PI * 1.05, Math.PI * 1.95);
      splashCtx.stroke();
      splashCtx.beginPath();
      splashCtx.arc(rupture.x + spread * 0.34, y, spread * 0.38, Math.PI * 1.05, Math.PI * 1.95);
      splashCtx.stroke();
      splashCtx.globalAlpha *= 0.48;
      splashCtx.beginPath();
      splashCtx.moveTo(rupture.x - spread * 0.9, y + Math.sin(rupture.phase + t * 6) * 1.5);
      splashCtx.lineTo(rupture.x + spread * 0.9, y + Math.cos(rupture.phase + t * 5) * 1.5);
      splashCtx.stroke();
    }
    for (const bubble of world.bubbles) {
      const t = bubble.age / bubble.life;
      splashCtx.globalAlpha = Math.max(0, 0.72 * (1 - t * 0.25));
      splashCtx.strokeStyle = "rgba(221, 250, 255, 0.86)";
      splashCtx.lineWidth = 1.1;
      splashCtx.beginPath();
      splashCtx.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2);
      splashCtx.stroke();
      splashCtx.globalAlpha *= 0.55;
      splashCtx.beginPath();
      splashCtx.arc(bubble.x - bubble.r * 0.28, bubble.y - bubble.r * 0.28, bubble.r * 0.22, 0, Math.PI * 2);
      splashCtx.stroke();
    }

    for (const drop of world.droplets) {
      const t = drop.age / drop.life;
      const alpha = Math.max(0, 1 - t);
      splashCtx.globalAlpha = alpha;
      splashCtx.strokeStyle = "rgba(231, 250, 255, 0.94)";
      splashCtx.lineWidth = drop.size;
      splashCtx.beginPath();
      splashCtx.moveTo(drop.x, drop.y);
      splashCtx.lineTo(drop.x - drop.vx * 0.018, drop.y - drop.vy * 0.018);
      splashCtx.stroke();

      if (drop.size > 3.3) {
        splashCtx.globalAlpha = alpha * 0.5;
        splashCtx.fillStyle = "rgba(231, 250, 255, 0.9)";
        splashCtx.beginPath();
        splashCtx.arc(drop.x, drop.y, drop.size * 0.48, 0, Math.PI * 2);
        splashCtx.fill();
      }
    }

    splashCtx.globalAlpha = 1;
  }

  function renderWord() {
    const body = world.body;
    if (!body) return;

    const waves = world.surface.map((point) => point.y);
    const deepest = body.deepest ?? Math.max(...body.model.samples.map((sample) => pointWorld(body, sample).y));

    wordEl.dataset.underwater = body.underwater ? "true" : "false";
    wordEl.dataset.state = body.settled ? "settled" : body.underwater ? "sinking" : body.impactDone ? "impact" : "falling";
    wordEl.dataset.y = body.y.toFixed(1);
    wordEl.dataset.vy = body.vy.toFixed(1);
    wordEl.dataset.omega = body.omega.toFixed(3);
    wordEl.dataset.angle = body.angle.toFixed(3);
    wordEl.dataset.settled = body.settled ? "true" : "false";
    wordEl.dataset.contour = String(body.model.samples.length);
    wordEl.dataset.mass = body.model.mass.toFixed(2);
    wordEl.dataset.waveMin = Math.min(...waves).toFixed(1);
    wordEl.dataset.waveMax = Math.max(...waves).toFixed(1);
    wordEl.dataset.water = world.waterY.toFixed(1);
    wordEl.dataset.floor = world.floorY.toFixed(1);
    wordEl.dataset.deepest = deepest.toFixed(1);
    wordEl.dataset.droplets = String(world.droplets.length);
    wordEl.dataset.bubbles = String(world.bubbles.length);
    wordEl.dataset.ruptures = String(world.ruptures.length);
    wordEl.dataset.floorContacts = String(body.floorContacts || 0);
    wordEl.dataset.floorSupport = (body.floorSupport || 0).toFixed(1);
    wordEl.dataset.floorTime = (body.floorContactTime || 0).toFixed(2);
    wordEl.dataset.groundHull = String(body.model.groundHull ? body.model.groundHull.length : 0);
    wordEl.dataset.supportAngle = body.model.supportAngle ? body.model.supportAngle.toFixed(3) : "0.000";
    wordEl.dataset.supportDrop = body.model.supportDrop ? body.model.supportDrop.toFixed(1) : "0.0";

    wordEl.style.left = `${body.x - body.model.comX}px`;
    wordEl.style.top = `${body.y - body.model.comY}px`;
    wordEl.style.transform = `rotate(${body.angle}rad)`;
  }

  function tick(dt) {
    world.time += dt * 1000;
    updateBody(dt);
    updateSurface(dt);
    updateDroplets(dt);
    updateBubbles(dt);
    updateRuptures(dt);
    updateSediment(dt);
  }

  function draw() {
    renderWord();
    drawWater();
    drawSplashLayer();
  }

  function frame(now) {
    if (!world.lastNow) world.lastNow = now;
    const frameDt = Math.min(0.06, (now - world.lastNow) / 1000);
    world.lastNow = now;
    world.accumulator += frameDt;

    while (world.accumulator >= config.fixedStep) {
      tick(config.fixedStep);
      world.accumulator -= config.fixedStep;
    }

    draw();
    requestAnimationFrame(frame);
  }

  function resize() {
    world.dpr = Math.min(window.devicePixelRatio || 1, 2);
    world.width = window.innerWidth;
    world.height = window.innerHeight;
    world.waterY = Math.round(world.height * config.waterLevel);
    world.floorY = Math.round(world.height * config.floorLevel);
    resizeCanvas(waterCanvas, waterCtx);
    resizeCanvas(splashCanvas, splashCtx);
    restart(wordInput.value, false);
  }

  function restart(text, resetClock) {
    if (resetClock !== false) {
      world.time = 0;
      world.lastNow = 0;
      world.accumulator = 0;
    }
    makeSurface();
    world.droplets = [];
    world.bubbles = [];
    world.ruptures = [];
    world.sediment = [];
    world.body = makeBody(text || wordInput.value);
    draw();
  }

  controls.addEventListener("submit", (event) => {
    event.preventDefault();
    restart(wordInput.value, true);
  });

  wordEl.addEventListener("click", () => {
    wordEl.animate(
      [
        { opacity: 1, filter: "brightness(1.45)" },
        { opacity: 1, filter: wordEl.dataset.underwater === "true" ? "blur(0.35px) contrast(0.88) saturate(0.82)" : "none" }
      ],
      { duration: 220, easing: "ease-out" }
    );
  });

  window.addEventListener("resize", resize);
  resize();

  const captureAt = Number(params.get("at") || 0);
  if (captureAt > 0) {
    const steps = Math.min(2400, Math.round((captureAt / 1000) / config.fixedStep));
    for (let i = 0; i < steps; i += 1) {
      tick(config.fixedStep);
    }
    draw();
  } else {
    requestAnimationFrame(frame);
  }
})();


























