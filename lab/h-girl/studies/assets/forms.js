// Only the study page imports this file. There is no Babylon scene or app input here.
const small = 16;
const large = small * 4;
const black = '#090909';
const white = '#f0f0f0';
const gray = '#808080';
const hints = ['Escape — показать справку', 'WASD — движение', 'Мышь — обзор'];

const variants = [
  { title: 'Тёмная плашка, кнопка кругами', backing: 'panel',
    note: 'Обычный текст. Четыре целых белых круга соприкасаются. Стрелка в последнем.' },
  { title: 'Без подложки', backing: 'none',
    note: 'Та же кнопка и текст прямо на фоне. Без дополнительного затемнения.' },
  { title: 'Чёрная плитка, целые белые круги', backing: 'grid',
    note: 'Вместо плашки — только мелкие чёрные круги. Текст кнопки чёрный.' },
  { title: 'Та же плитка, серый текст', backing: 'grid', gray: true,
    note: 'Та же геометрия, текст кнопки #808080. Можно сравнить буквы на белом и в промежутках.' },
  { title: 'Перекрытие на ¼ диаметра', backing: 'grid', overlap: .25,
    note: 'Пять белых кругов, шаг ¾ диаметра. Общая ширина кнопки остаётся прежней.' },
  { title: 'Перекрытие на ½ диаметра', backing: 'grid', overlap: .5,
    note: 'Семь белых кругов, шаг ½ диаметра. Общая ширина кнопки остаётся прежней.' },
  { title: 'Каждая буква в ячейке', backing: 'grid', mono: true,
    note: 'Справка и кнопка идут по мелкой сетке. Крупные белые круги целые, текст кнопки чёрный.' },
  { title: 'Буквы по сетке, серый текст', backing: 'grid', mono: true, gray: true,
    note: 'То же размещение, но текст поверх белых кругов и промежутков — средне-серый.' },
  { title: 'Буква в отдельном белом круге', backing: 'grid', mono: true, smallButton: true,
    note: 'Кнопка из мелких белых кругов: по одному под символом. «Начать» / «Продолжить».' },
  { title: 'Тот же принцип во всём интерфейсе', backing: 'grid', mono: true, smallButton: true, allType: true,
    note: 'Буквы счётчика FPS тоже занимают отдельные круги.' },
];

function circle(x, y, diameter, fill) {
  return `<circle cx="${x}" cy="${y}" r="${diameter / 2}" fill="${fill}"/>`;
}

function tile(cols, rows) {
  let result = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      result += circle((col + .5) * small, (row + .5) * small, small, black);
    }
  }
  return `<g data-small-diameter="${small}">${result}</g>`;
}

function letters(text, x, y, { step = small, fill = '#d7d7d7', disks = false } = {}) {
  return Array.from(text).map((char, i) => {
    if (char === ' ') return '';
    const cx = x + i * step;
    return `${disks ? circle(cx, y, step, disks) : ''}<text class="grid-letter" x="${cx}" y="${y}" fill="${fill}" dominant-baseline="central" style="font-size:${step * .75}px">${char}</text>`;
  }).join('');
}

function arrow(x, y, fill, size = 16) {
  const tip = size * .375;
  return `<path d="M ${x - size / 2} ${y} h ${size} m -${tip} -${tip} l ${tip} ${tip} -${tip} ${tip}" fill="none" stroke="${fill}" stroke-width="1.5"/>`;
}

function action(variant, continuing) {
  const shortLabel = continuing ? 'Продолжить' : 'Начать';
  const label = variant.mono ? shortLabel : `${shortLabel} прогулку`;
  const fill = variant.gray ? gray : black;
  const y = 168;

  if (variant.smallButton) {
    const text = letters(shortLabel, 40, y, { fill: black, disks: white });
    const arrowX = 40 + (shortLabel.length + 1) * small;
    return `<g data-action="small">${text}${circle(arrowX, y, small, white)}${arrow(arrowX, y, black, 8)}</g>`;
  }

  // Black tile edges: 0, 16, 32... White edges: 40, 104... (8 px phase).
  // This reproduces sketch 05: a large circle edge crosses small-circle centres.
  const step = large * (1 - (variant.overlap ?? 0));
  const width = large * 4;
  const count = (width - large) / step + 1;
  const firstX = 40 + large / 2;
  const lastX = 40 + width - large / 2;
  const disks = Array.from({ length: count }, (_, i) => circle(firstX + i * step, y, large, white)).join('');
  const text = variant.mono
    ? letters(label, 56, y, { fill })
    : `<text class="button-label${variant.gray ? ' gray-text' : ''}" x="56" y="${y}" dominant-baseline="central">${label}</text>`;
  return `<g data-action="large" data-large-diameter="${large}" data-step="${step}" data-overlap="${variant.overlap ?? 0}">${disks}${text}${arrow(lastX, y, fill)}</g>`;
}

function help(variant, continuing) {
  const backing = variant.backing === 'grid'
    ? tile(28, 14)
    : variant.backing === 'panel'
      ? '<rect width="448" height="224" rx="20" fill="#151515" fill-opacity=".92" stroke="#ffffff20"/>'
      : '';
  const text = hints.map((line, i) => variant.mono
    ? letters(line, 40, 40 + i * small * 2)
    : `<text class="hint" x="40" y="${40 + i * small * 2}" dominant-baseline="central">${line}</text>`
  ).join('');
  return `<g transform="translate(16 64)">${backing}${text}${action(variant, continuing)}</g>`;
}

function surroundings(variant) {
  const fps = variant.allType
    ? letters('60 FPS', 22, 313, { step: 12, disks: black })
    : '<text class="fps-type" x="16" y="316">60 FPS</text>';
  return `<image href="./assets/logo.svg" x="16" y="20" width="76" height="14" style="filter:invert(1)"/>
    ${fps}`;
}

const studies = document.querySelector('#forms-grid');
const state = document.querySelector('#button-state');

function render() {
  const continuing = state.value === 'continue';
  studies.innerHTML = variants.map((variant, i) => `
    <article class="study-card" id="variant-${i + 1}">
      <header class="study-caption">
        <span class="study-number">${String(i + 1).padStart(2, '0')}</span>
        <div><h3>${variant.title}</h3><p>${variant.note}</p></div>
      </header>
      <div class="study-stage">
        <svg viewBox="0 0 480 336" role="img" aria-labelledby="title-${i + 1} desc-${i + 1}">
          <title id="title-${i + 1}">${variant.title}</title>
          <desc id="desc-${i + 1}">${hints.join('. ')}. ${continuing ? 'Продолжить' : 'Начать'}${variant.mono ? '' : ' прогулку'}. ${variant.note}</desc>
          ${surroundings(variant)}${help(variant, continuing)}
        </svg>
      </div>
    </article>`).join('');
}

state.addEventListener('change', render);
render();
