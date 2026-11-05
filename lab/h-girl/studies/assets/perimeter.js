// Static refinement of study 07. The main preview does not import this file.
const small = 16;
const large = small * 4;
const tiny = small / 4;
const cols = 20;
const rows = 14;
const black = '#090909';
const white = '#f0f0f0';
const hints = ['escape — справка', 'wasd — движение', 'мышь — обзор'];
const variants = [
  { id: 'plain', label: '07А', title: 'Обычный периметр', edgeRows: 0,
    note: 'Все чёрные круги непрозрачные, как в седьмом варианте.' },
  { id: 'edge-2', label: '07Б', title: 'Край — 2 ряда', edgeRows: 2,
    note: 'Два крайних ряда постепенно растворяются в сцене.' },
  { id: 'edge-3', label: '07В', title: 'Край — 3 ряда', edgeRows: 3,
    note: 'То же растворение по периметру, на глубину трёх рядов.' },
];

function circle(x, y, diameter, fill, opacity = 1) {
  return `<circle cx="${x}" cy="${y}" r="${diameter / 2}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

function tile(edgeRows) {
  let circles = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const depth = Math.min(col, row, cols - col - 1, rows - row - 1);
      const opacity = Math.min(1, (depth + 1) / (edgeRows + 1));
      circles += circle((col + .5) * small, (row + .5) * small, small, black, opacity);
    }
  }
  return `<g data-layer="backing" data-edge-rows="${edgeRows}">${circles}</g>`;
}

function letters(text, x, y, fill = white) {
  return Array.from(text).map((char, i) => char === ' ' ? '' :
    `<text class="grid-letter" x="${x + i * small}" y="${y}" fill="${fill}" dominant-baseline="central">${char}</text>`
  ).join('');
}

function dottedArrow(x, y) {
  // Black tile boundaries are multiples of 16. Tiny circle centres are
  // multiples of 4, repeating the same boundary-to-centre phase as 64 -> 16.
  const cells = [];
  for (let col = -3; col <= 3; col++) cells.push([col, 0]);
  for (let row = 1; row <= 3; row++) cells.push([3 - row, -row], [3 - row, row]);
  return `<g data-layer="arrow">${cells.map(([col, row]) =>
    circle(x + col * tiny, y + row * tiny, tiny, black)
  ).join('')}</g>`;
}

function action(label) {
  const y = 168;
  const firstX = 40 + large / 2;
  const lastX = firstX + 3 * large;
  const circles = Array.from({ length: 4 }, (_, i) => circle(firstX + i * large, y, large, white)).join('');
  return `<g data-layer="action">${circles}${letters(label, 56, y, black)}${dottedArrow(lastX, y)}</g>`;
}

function help(edgeRows, label) {
  const text = hints.map((line, i) => letters(line, 40, 40 + i * small * 2)).join('');
  return `<g transform="translate(32 64)">${tile(edgeRows)}${text}${action(label)}</g>`;
}

function surroundings() {
  return `<image href="./assets/logo.svg" x="16" y="20" width="76" height="14" style="filter:invert(1)"/>
    <text class="fps-type" x="16" y="316">60 FPS</text>`;
}

const studies = document.querySelector('#perimeter-grid');
const state = document.querySelector('#button-state');

function render() {
  const label = state.value === 'continue' ? 'продолжить' : 'начать';
  studies.innerHTML = variants.map((variant) => `
    <article class="study-card" id="variant-${variant.id}">
      <header class="study-caption">
        <span class="study-number">${variant.label}</span>
        <div><h3>${variant.title}</h3><p>${variant.note}</p></div>
      </header>
      <div class="study-stage">
        <svg viewBox="0 0 384 336" role="img" aria-labelledby="title-${variant.id} desc-${variant.id}">
          <title id="title-${variant.id}">${variant.title}</title>
          <desc id="desc-${variant.id}">${hints.join('. ')}. ${label}. ${variant.note}</desc>
          ${surroundings()}${help(variant.edgeRows, label)}
        </svg>
      </div>
    </article>`).join('');
}

state.addEventListener('change', render);
render();
