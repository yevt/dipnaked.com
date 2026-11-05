// Static refinement of study 07. The main preview does not import this file.
const small = 16;
const large = small * 4;
const tiny = small / 2;
const cols = 20;
const rows = 14;
const black = '#090909';
const white = '#f0f0f0';
const fontSize = 13;
const family = 'Noto Sans Mono';
const hints = ['escape — справка', 'wasd — движение', 'мышь — обзор'];

// One reference baseline per weight, measured after the real font loads.
// Other letters retain their ascenders and descenders; they are not centred
// independently. Canvas and SVG use the same alphabetic baseline and size.
const context = document.createElement('canvas').getContext('2d');
context.textBaseline = 'alphabetic';
context.textAlign = 'center';

async function typeStyle(weight, fill) {
  const font = `${weight} ${fontSize}px "${family}"`;
  await document.fonts.load(font, 'о');
  // Measure large, then scale down: small-size raster rounding must not move
  // the baseline by half a pixel. This font has no optical-size axis.
  const measureSize = 1000;
  const scale = fontSize / measureSize;
  context.font = `${weight} ${measureSize}px "${family}"`;
  const bounds = context.measureText('о');
  return {
    weight, fill,
    x: (bounds.actualBoundingBoxLeft - bounds.actualBoundingBoxRight) / 2 * scale,
    baseline: (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2 * scale,
  };
}

const [lightType, darkType] = await Promise.all([
  typeStyle(300, white),
  typeStyle(400, black),
]);

function circle(x, y, diameter, fill) {
  return `<circle cx="${x}" cy="${y}" r="${diameter / 2}" fill="${fill}"/>`;
}

function tile() {
  let circles = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      circles += circle((col + .5) * small, (row + .5) * small, small, black);
    }
  }
  return `<g data-layer="backing">${circles}</g>`;
}

function letters(text, x, y, style = lightType) {
  return Array.from(text).map((char, i) => char === ' ' ? '' : `
    <g transform="translate(${x + i * small} ${y})">
      <text class="mono-letter" x="${style.x}" y="${style.baseline}"
        font-size="${fontSize}" font-weight="${style.weight}" fill="${style.fill}"
        clip-path="url(#letter-cell)">${char}</text>
    </g>`
  ).join('');
}

function dottedArrow(x, y) {
  // The next grid has 8-unit circles, with centres on the 16-unit grid's edges.
  const cells = [];
  for (let col = -2; col <= 2; col++) cells.push([col, 0]);
  for (let row = 1; row <= 2; row++) cells.push([2 - row, -row], [2 - row, row]);
  return `<g data-layer="arrow">${cells.map(([col, row]) =>
    circle(x + col * tiny, y + row * tiny, tiny, black)
  ).join('')}</g>`;
}

function action(label) {
  const y = 168;
  const firstX = 40 + large / 2;
  const lastX = firstX + 3 * large;
  const circles = Array.from({ length: 4 }, (_, i) => circle(firstX + i * large, y, large, white)).join('');
  return `<g data-layer="action">${circles}${letters(label, 56, y, darkType)}${dottedArrow(lastX, y)}</g>`;
}

function help(label) {
  const text = hints.map((line, i) => letters(line, 40, 40 + i * small * 2)).join('');
  return `<g transform="translate(32 64)">${tile()}${text}${action(label)}</g>`;
}

function surroundings() {
  return `<image href="./assets/logo.svg" x="16" y="20" width="76" height="14" style="filter:invert(1)"/>
    <text class="fps-type" x="16" y="316">60 FPS</text>`;
}

const studies = document.querySelector('#type-grid');
const state = document.querySelector('#button-state');

function render() {
  const label = state.value === 'continue' ? 'продолжить' : 'начать';
  studies.innerHTML = `
    <article class="study-card" id="variant-type">
      <header class="study-caption">
        <span class="study-number">07</span>
        <div><h3>Шрифт, центрирование и стрелка</h3><p>Базовая линия по «о», круглая обрезка, девять крупных точек.</p></div>
      </header>
      <div class="study-stage">
        <svg viewBox="0 0 384 336" role="img" aria-labelledby="title-type desc-type">
          <title id="title-type">Уточнённый вариант 07</title>
          <desc id="desc-type">${hints.join('. ')}. ${label}. Чёрные круги полностью непрозрачные.</desc>
          <defs><clipPath id="letter-cell" clipPathUnits="userSpaceOnUse"><circle cx="0" cy="0" r="${small / 2}"/></clipPath></defs>
          ${surroundings()}${help(label)}
        </svg>
      </div>
    </article>`;
}

state.addEventListener('change', render);
render();
