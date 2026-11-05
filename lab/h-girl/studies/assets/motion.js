import {createHelpArtwork, desktopHints, touchHints, discCenters, discY} from './help-artwork.js';
import {PointerMotion, EntryTracker, angleDelta, followAngle, coast, entryImpulse, discContact, contactSpin, canCatchSpin, linkedSpeeds, tapSpin, panelPose} from './physics.js';
import {createPuzzle} from './puzzle.js';

const drawHelp = await createHelpArtwork();
const typeStudies = [
  {id: 'uppercase', title: 'Заглавные · Noto Sans Mono', note: 'Та же сетка и круги. Заглавная М уменьшена до высоты прежней строчной м; остальные буквы — пропорционально.', draw: await createHelpArtwork(true)},
  {id: 'uppercase-manrope', title: 'Заглавные · Manrope', note: 'Та же высота М и тот же шаг: одна буква в круге.', draw: await createHelpArtwork(true, 'Manrope')},
  {id: 'lowercase-mono', title: 'Строчные · Noto Sans Mono', note: 'Строчные буквы в ячейках справки и на кнопке.', draw: drawHelp},
];
const modes = [
  {id: 'spin', title: 'Импульс при входе', note: 'Исходный вариант: четыре диска получают немного разные импульсы и постепенно останавливаются.'},
  {id: 'cursor', title: 'Стрелка к курсору', note: 'После касания сначала докручивается по инерции, даже за пределами кнопки. Затем снова смотрит на курсор.'},
  {id: 'direction', title: 'Стрелка по движению', note: 'После инерционного вращения возвращается к усреднённому направлению движения мыши.'},
  {id: 'gears', title: 'Связанные диски', note: 'Быстрое вращение сохраняет инерцию. Когда оно ослабевает, более быстрое движение мыши внутри подхватывает диски.'},
  {id: 'flight', title: 'Въезд и выезд справки', note: 'Подъём, глубина и посадка — одно движение по дуге. Нажатие уводит справку обратно; esc или «Справка» возвращает её.'},
  {id: 'puzzle', title: 'Сборка и обвал', note: 'Исходная версия для сравнения: круги замедляются прямо в ячейках, без перелёта. Прежний, более быстрый обвал.'},
  {id: 'puzzle-reverse', title: 'Сборка · реверс падения', note: 'Быстрый подъём снизу и мягкое замедление у ячеек, без перелёта. Разброс времени остановки небольшой; обвал начинается мягко.'},
  {id: 'button-entry', entry: 'button', title: 'Вход в кнопку целиком', note: 'Один импульс при входе. Движение внутри и переходы между дисками ничего не меняют. Для нового импульса выйди из всей кнопки и зайди снова.'},
  {id: 'disc-entry', entry: 'disc', title: 'Вход в каждый круг', note: 'Каждый вход в круг задаёт импульс, в том числе при переходе в соседний. Движение внутри одного круга ничего не меняет.'},
];
const stateControl = document.querySelector('#button-state');
const contactControl = document.querySelector('#contact-input');
contactControl.value = matchMedia('(pointer: coarse)').matches ? 'tap' : 'mouse';
const pointer = new PointerMotion();
let cards = [];
let frame = 0, lastFrame = 0;
let entranceObserver;
let escapeCard;
const puzzlePanel = id => id === 'puzzle' || id === 'puzzle-reverse';
const movingPanel = id => id === 'flight' || puzzlePanel(id);
const panelKeyframes = Array.from({length: 61}, (_, i) => {
  const pose = panelPose(i / 60);
  return {transform: `translateY(${pose.y}%) scale(${pose.scale})`};
});

function surroundings() {
  return `<image href="./assets/logo.svg" x="16" y="20" width="76" height="14" style="filter:invert(1)"/>
    <text class="fps-type" x="16" y="316">60 FPS</text>`;
}

function requestFrame() {
  if (frame) return;
  lastFrame = performance.now();
  frame = requestAnimationFrame(tick);
}

function targetAngle(card) {
  if (card.id === 'direction') return pointer.heading;
  const rect = card.button.getBoundingClientRect();
  const cx = rect.left + rect.width * .875, cy = rect.top + rect.height / 2;
  return Math.atan2(pointer.point.y - cy, pointer.point.x - cx) * 180 / Math.PI;
}

function tick(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  let moving = false;
  for (const card of cards) {
    for (let i = 0; i < 4; i++) {
      const next = coast(card.angles[i], card.speeds[i], dt);
      card.angles[i] = next.angle;
      card.speeds[i] = Math.abs(next.speed) < .01 ? 0 : next.speed;
      card.rotors[i].setAttribute('transform', `rotate(${card.angles[i]} ${discCenters[i]} ${discY})`);
    }
    // Less than two degrees of travel remain. Finish coasting before tracking
    // takes control, including when the pointer has already left the button.
    if (card.coasting && card.speeds.every(speed => Math.abs(speed) < 3)) {
      card.speeds.fill(0);
      card.coasting = false;
      card.tracking = card.angles[3] + card.arrowLocal;
    }
    if (card.speeds.some(speed => speed !== 0)) moving = true;
    const tracking = card.tracks && !card.inside && !card.coasting && pointer.point;
    if (tracking) {
      const target = targetAngle(card);
      card.tracking = followAngle(card.tracking, target, dt);
      if (Math.abs(angleDelta(card.tracking, target)) > .02) moving = true;
      card.arrowLocal = card.tracking - card.angles[3];
    }
    card.root.dataset.motion = card.coasting ? 'coasting' : tracking ? 'tracking' : 'idle';
    card.arrow.setAttribute('transform', `rotate(${card.arrowLocal} 264 ${discY})`);
  }
  frame = moving ? requestAnimationFrame(tick) : 0;
}

function localContact(card, x, y) {
  const rect = card.button.getBoundingClientRect();
  return discContact((x - rect.left) * 256 / rect.width, (y - rect.top) * 64 / rect.height);
}

function driveDiscs(card, contact, speed, input) {
  card.speeds = linkedSpeeds(contact.index, speed);
  card.coasting = speed !== 0;
  card.entrySummary = `${input} · диск ${contact.index + 1} · ${Math.round(Math.abs(speed))} °/s · ${speed >= 0 ? 'по часовой' : 'против часовой'}`;
  card.stats.textContent = card.entrySummary;
  requestFrame();
}

function driveFromPointer(card, event, source) {
  const contact = localContact(card, event.clientX, event.clientY);
  if (card.entry && !card.entry.sample(contact)) return;
  if (!contact) return;
  const scale = 256 / card.button.getBoundingClientRect().width;
  const speed = contactSpin(contact.rx, contact.ry, pointer.vx * scale, pointer.vy * scale);
  if (!card.entry && source === 'inside' && !canCatchSpin(card.speeds[contact.index], speed)) return;
  if (speed !== 0) driveDiscs(card, contact, speed, !card.entry && source === 'inside' ? 'Движение' : 'Вход');
}

function resetArt(card) {
  card.puzzle?.cancel();
  const label = card.started ? 'продолжить' : 'начать';
  const hints = card.linked && contactControl.value === 'tap' ? touchHints : desktopHints;
  card.panel.querySelector('svg').innerHTML = drawHelp(label, hints, card.id, true);
  card.button.setAttribute('aria-label', `${label}: ${card.title}`);
  card.rotors = [...card.panel.querySelectorAll('[data-rotor]')];
  card.arrow = card.panel.querySelector('[data-arrow]');
  card.angles = [0, 0, 0, 0];
  card.speeds = [0, 0, 0, 0];
  card.inside = card.coasting = false;
  card.entry?.leave();
  card.tracking = card.arrowLocal = 0;
  if (puzzlePanel(card.id)) {
    card.puzzle = createPuzzle(card.panel.querySelector('svg'), card.id === 'puzzle' ? 'original' : 'reverse');
  }
}

function showPuzzle(card) {
  if (card.phase !== 'hidden') return;
  resetArt(card);
  card.panel.hidden = false;
  card.phase = card.root.dataset.phase = 'entering';
  card.button.disabled = true;
  card.puzzle.show(() => {
    card.phase = card.root.dataset.phase = 'shown';
    card.button.disabled = false;
  });
  requestFrame();
}

function hidePuzzle(card) {
  if (card.phase !== 'shown') return;
  card.phase = card.root.dataset.phase = 'leaving';
  card.button.disabled = true;
  card.puzzle.hide(() => {
    card.panel.hidden = true;
    card.phase = card.root.dataset.phase = 'hidden';
    card.returnButton.focus({preventScroll: true});
  });
}

function showStudy(card) {
  if (puzzlePanel(card.id)) showPuzzle(card);
  else showPanel(card);
}

function showPanel(card) {
  if (card.phase === 'shown' || card.phase === 'entering') return;
  resetArt(card);
  if (card.phase === 'leaving') {
    card.animation.reverse();
  } else {
    card.animation?.cancel();
    card.panel.hidden = false;
    card.animation = card.panel.animate(panelKeyframes, {
      duration: 650, easing: 'cubic-bezier(.22,.65,.25,1)', fill: 'both',
    });
  }
  card.phase = card.root.dataset.phase = 'entering';
  card.button.disabled = true;
  card.animation.onfinish = () => {
    card.phase = card.root.dataset.phase = 'shown';
    card.button.disabled = false;
  };
  requestFrame();
}

function hidePanel(card) {
  card.phase = card.root.dataset.phase = 'leaving';
  card.button.disabled = true;
  card.animation.reverse();
  card.animation.onfinish = () => {
    card.panel.hidden = true;
    card.phase = card.root.dataset.phase = 'hidden';
    card.returnButton.focus({preventScroll: true});
  };
}

function render() {
  cancelAnimationFrame(frame);
  frame = 0;
  entranceObserver?.disconnect();
  for (const card of cards) {
    card.animation?.cancel();
    card.puzzle?.cancel();
  }
  document.querySelector('#motion-grid').innerHTML = modes.map((mode, i) => `
    <article class="study-card" id="motion-${mode.id}">
      <header class="study-caption"><span class="study-number">0${i + 1}</span><div><h3>${mode.title}</h3><p>${mode.note}</p></div></header>
      <div class="study-stage motion-stage">
        <svg viewBox="0 0 384 336" aria-hidden="true">${surroundings()}</svg>
        <div class="motion-panel" ${movingPanel(mode.id) ? 'hidden' : ''}>
          <svg viewBox="0 0 320 224" aria-hidden="true"></svg>
          <button class="motion-hit"></button>
        </div>
      </div>
      <p class="motion-stats" aria-live="polite">${i < 3 ? 'Вход: — px/s · пуск: — °/s' : 'Диск: — · скорость: — °/s'}</p>
      ${movingPanel(mode.id) ? `<div class="flight-tools"><button class="motion-reset flight-return">Справка</button><span>esc — ${puzzlePanel(mode.id) ? 'собрать / уронить' : 'вернуть справку'}</span></div>` : ''}
    </article>`).join('') + typeStudies.map((study, i) => `
    <article class="study-card" id="study-${study.id}">
      <header class="study-caption"><span class="study-number">${10 + i}</span><div><h3>${study.title}</h3><p>${study.note}</p></div></header>
      <div class="study-stage">
        <svg viewBox="0 0 384 336" role="img" aria-label="${study.title}">
          ${surroundings()}
          <g transform="translate(32 64)">${study.draw(stateControl.value === 'continue' ? 'продолжить' : 'начать', contactControl.value === 'tap' ? touchHints : desktopHints, study.id)}</g>
        </svg>
      </div>
    </article>`).join('');
  cards = modes.map(mode => {
    const root = document.querySelector(`#motion-${mode.id}`);
    const card = {id: mode.id, title: mode.title, root, panel: root.querySelector('.motion-panel'),
      button: root.querySelector('.motion-hit'), stats: root.querySelector('.motion-stats'),
      returnButton: root.querySelector('.flight-return'),
      linked: mode.id === 'gears' || movingPanel(mode.id) || !!mode.entry, tracks: mode.id === 'cursor' || mode.id === 'direction',
      entry: mode.entry ? new EntryTracker(mode.entry) : null,
      started: stateControl.value === 'continue', phase: movingPanel(mode.id) ? 'hidden' : 'shown', clicks: 0,
      entrySummary: mode.id === 'gears' || movingPanel(mode.id) || mode.entry ? 'Диск: — · скорость: — °/s' : 'Вход: — px/s · пуск: — °/s'};
    root.dataset.phase = card.phase;
    resetArt(card);
    if (movingPanel(card.id)) {
      root.addEventListener('pointerenter', () => { escapeCard = card; });
      root.addEventListener('focusin', () => { escapeCard = card; });
    }
    card.button.addEventListener('pointerenter', event => {
      if (card.phase !== 'shown') return;
      card.inside = true;
      if (event.pointerType !== 'mouse') return;
      pointer.sample(event.clientX, event.clientY, event.timeStamp);
      if (card.linked) {
        if (contactControl.value === 'mouse') driveFromPointer(card, event, 'entry');
        return;
      }
      const impulse = entryImpulse(pointer.vx, pointer.vy);
      card.speeds = card.speeds.map((speed, i) => speed + impulse[i]);
      card.coasting = card.speeds.some(speed => speed !== 0);
      card.entrySummary = `Вход: ${Math.round(Math.hypot(pointer.vx, pointer.vy))} px/s · пуск: ${Math.round(Math.abs(impulse[0]))} °/s`;
      card.stats.textContent = card.entrySummary;
      requestFrame();
    });
    card.button.addEventListener('pointerleave', () => {
      card.inside = false;
      card.entry?.leave();
      requestFrame();
    });
    card.button.addEventListener('click', event => {
      if (card.linked) {
        const contact = event.detail === 0 ? discContact(224, 32) : localContact(card, event.clientX, event.clientY);
        if (!contact) return;
        if (!card.coasting) driveDiscs(card, contact, tapSpin(contact.rx, contact.ry), 'Тап');
      }
      card.clicks++;
      card.stats.textContent = `${card.entrySummary} · нажатий: ${card.clicks}`;
      if (movingPanel(card.id)) {
        card.started = true;
        if (puzzlePanel(card.id)) hidePuzzle(card);
        else hidePanel(card);
      }
    });
    card.returnButton?.addEventListener('click', () => showStudy(card));
    return card;
  });
  escapeCard = cards.find(card => card.id === 'puzzle-reverse');
  // Play each first entrance when its below-the-fold example becomes visible.
  entranceObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      showStudy(cards.find(card => card.panel.parentElement === entry.target));
      entranceObserver.unobserve(entry.target);
    }
  }, {threshold: .5});
  for (const card of cards.filter(card => movingPanel(card.id))) entranceObserver.observe(card.panel.parentElement);
}

document.querySelector('#motion').addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse') return;
  pointer.sample(event.clientX, event.clientY, event.timeStamp);
  const card = cards.find(card => card.linked && card.button === event.target);
  // Use the current hit target: the panel can appear under a stationary pointer.
  if (card && card.phase === 'shown' && contactControl.value === 'mouse') {
    card.inside = true;
    driveFromPointer(card, event, 'inside');
  }
  requestFrame();
}, {passive: true});

document.addEventListener('keydown', event => {
  if (event.code !== 'Escape' || event.repeat) return;
  const bounds = escapeCard.root.getBoundingClientRect();
  if (bounds.top >= innerHeight || bounds.bottom <= 0) return;
  if (puzzlePanel(escapeCard.id) && escapeCard.phase === 'shown') hidePuzzle(escapeCard);
  else showStudy(escapeCard);
});
stateControl.addEventListener('change', render);
contactControl.addEventListener('change', render);
document.querySelector('#motion-reset').addEventListener('click', () => {
  pointer.point = null;
  pointer.vx = pointer.vy = pointer.heading = 0;
  render();
});
render();
