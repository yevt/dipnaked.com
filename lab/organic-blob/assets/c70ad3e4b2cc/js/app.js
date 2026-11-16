import { createAnimationLoop } from './animation.js';
import { deformContour } from './geometry.js';
import { glowingRimShape, colorMassShape } from './shapes.js';
import { renderSchematic } from './renderers/schematic.js';
import { renderGlowingRim } from './renderers/glowing-rim.js';
import { createColorMassRenderer } from './renderers/color-masses.js';

// Точка сборки: только здесь связываются DOM, часы, геометрия и рендеры.
const glowingRimContext = document.getElementById('one').getContext('2d');
const colorMassContext = document.getElementById('two').getContext('2d');
const renderColorMasses = createColorMassRenderer(colorMassContext);

const controls = {
  speed: document.getElementById('speed'),
  deformation: document.getElementById('deform'),
  colorDrift: document.getElementById('drift'),
  schematic: document.getElementById('schematic'),
};
const pauseButton = document.getElementById('pause');
const resetButton = document.getElementById('reset');

function readMultiplier(input) {
  return Number(input.value) / 100;
}

function renderFrame(timeSeconds) {
  const deformationStrength = readMultiplier(controls.deformation);
  const colorDriftStrength = readMultiplier(controls.colorDrift);
  const glowingRimPoints = deformContour(glowingRimShape, timeSeconds, deformationStrength);
  const colorMassPoints = deformContour(colorMassShape, timeSeconds, deformationStrength);

  // Выбор рендера происходит здесь; сами рендеры не знают о переключателях.
  if (controls.schematic.checked) {
    renderSchematic(glowingRimContext, glowingRimPoints);
    renderSchematic(colorMassContext, colorMassPoints, {
      annotation: 'Цветовые пятна двигаются отдельно',
    });
    return;
  }

  renderGlowingRim(glowingRimContext, glowingRimPoints);
  renderColorMasses(colorMassPoints, { timeSeconds, colorDriftStrength });
}

const animation = createAnimationLoop({
  renderFrame,
  getSpeed: () => readMultiplier(controls.speed),
});

function updateOutputs() {
  for (const input of [controls.speed, controls.deformation, controls.colorDrift]) {
    document.getElementById(`${input.id}Out`).textContent = `${readMultiplier(input).toFixed(2)}×`;
  }
}

for (const input of [controls.speed, controls.deformation, controls.colorDrift]) {
  input.addEventListener('input', () => {
    updateOutputs();
    if (animation.paused) animation.redraw();
  });
}

controls.schematic.addEventListener('change', () => {
  if (animation.paused) animation.redraw();
});

pauseButton.addEventListener('click', () => {
  animation.togglePause();
  pauseButton.textContent = animation.paused ? 'Продолжить' : 'Пауза';
});
resetButton.addEventListener('click', () => animation.reset());

updateOutputs();
animation.start();
