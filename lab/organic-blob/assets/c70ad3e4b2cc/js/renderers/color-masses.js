import { smoothNoise } from '../noise.js';
import { traceClosedCurve } from '../geometry.js';
import { createRadialGradient, drawRadialGlow } from '../canvas-gradients.js';

// Пример 2. Начните изучение с renderColorMasses() внизу файла:
// цветные пятна → мягкая маска → внешний отсвет → внутренние линии.

// Пятна рисуются по порядку: каждое следующее накладывается поверх предыдущих
// обычным source-over. center и radius заданы в пикселях canvas 720 × 900.
const COLOR_FIELDS = [
  // Большое бирюзовое пятно слева снизу.
  {
    center: [160, 604],
    radius: 390,
    driftX: { seed: 3, amplitudePx: 42, angularSpeed: 0.30 },
    driftY: { seed: 6, amplitudePx: 36, angularSpeed: 0.22 },
    colorStops: [
      [0, 'rgba(31,225,230,.98)'],
      [0.38, 'rgba(25,226,231,.83)'],
      [0.67, 'rgba(63,212,212,.40)'],
      [1, 'rgba(63,212,212,0)'],
    ],
  },
  // Нижнее голубое пятно.
  {
    center: [331, 688],
    radius: 325,
    driftX: { seed: 5, amplitudePx: 43, angularSpeed: 0.26 },
    driftY: { seed: 11, amplitudePx: 27, angularSpeed: 0.28 },
    colorStops: [
      [0, 'rgba(63,211,225,.89)'],
      [0.5, 'rgba(64,226,224,.56)'],
      [1, 'rgba(64,226,224,0)'],
    ],
  },
  // Большое красное пятно в верхней части.
  {
    center: [385, 443],
    radius: 270,
    driftX: { seed: 7, amplitudePx: 36, angularSpeed: 0.24 },
    driftY: { seed: 17, amplitudePx: 42, angularSpeed: 0.29 },
    colorStops: [
      [0, 'rgba(247,55,39,.97)'],
      [0.38, 'rgba(255,76,70,.86)'],
      [0.72, 'rgba(255,113,107,.3)'],
      [1, 'rgba(255,113,107,0)'],
    ],
  },
  // Тёмное синее пятно в центре перекрывает часть предыдущих цветов.
  {
    center: [293, 523],
    radius: 228,
    driftX: { seed: 12, amplitudePx: 22, angularSpeed: 0.18 },
    driftY: { seed: 15, amplitudePx: 37, angularSpeed: 0.31 },
    colorStops: [
      [0, 'rgba(25,27,120,.96)'],
      [0.5, 'rgba(46,44,142,.82)'],
      [0.78, 'rgba(55,64,161,.3)'],
      [1, 'rgba(46,50,164,0)'],
    ],
  },
  // Полупрозрачное фиолетовое пятно справа.
  {
    center: [435, 527],
    radius: 194,
    driftX: { seed: 2, amplitudePx: 24, angularSpeed: 0.38 },
    driftY: { seed: 4, amplitudePx: 21, angularSpeed: 0.23 },
    colorStops: [
      [0, 'rgba(136,57,160,.59)'],
      [0.42, 'rgba(157,74,164,.47)'],
      [1, 'rgba(157,74,164,0)'],
    ],
  },
  // Более компактный красный акцент сверху.
  {
    center: [363, 398],
    radius: 157,
    driftX: { seed: 9, amplitudePx: 20, angularSpeed: 0.28 },
    driftY: { seed: 8, amplitudePx: 20, angularSpeed: 0.26 },
    colorStops: [
      [0, 'rgba(255,61,38,.86)'],
      [0.54, 'rgba(255,71,51,.57)'],
      [1, 'rgba(255,71,51,0)'],
    ],
  },
];

const MASK_BLUR_PX = 18;
const INNER_CONTOUR_CENTER = [305, 529];
const INNER_CONTOURS = [
  { scale: 0.68, offsetX: -31, offsetY: -7, opacity: 0.52, phaseOffset: 1.2 },
  { scale: 0.82, offsetX: -2, offsetY: 6, opacity: 0.55, phaseOffset: 2.0 },
  { scale: 0.98, offsetX: 0, offsetY: -4, opacity: 0.17, phaseOffset: 3.1 },
];

/**
 * Смещение центра пятна по одной оси в пикселях (бывшая sh).
 * timeSeconds — общее время анимации; driftStrength — ползунок «Дрейф цвета».
 * seed — постоянное число, задающее характер шума и начальный сдвиг синуса.
 * amplitudePx — предел абсолютного смещения при driftStrength = 1.
 * angularSpeed — скорость синусоидальной части в радианах за секунду анимации.
 * phaseOffset — добавочный сдвиг аргумента синуса и координаты в шуме.
 * Для синуса этот сдвиг измеряется в радианах; у координаты шума единиц нет.
 */
function getColorDriftOffset(timeSeconds, driftStrength, {
  seed,
  amplitudePx,
  angularSpeed,
  phaseOffset = 0,
}) {
  const wave = Math.sin(timeSeconds * angularSpeed + phaseOffset + seed);
  const irregularMotion = smoothNoise(timeSeconds * 0.16 + phaseOffset, seed);
  return driftStrength * amplitudePx * (0.7 * wave + 0.3 * irregularMotion);
}

function drawColorFields(context, timeSeconds, driftStrength) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';

  for (const field of COLOR_FIELDS) {
    const centerX = field.center[0] + getColorDriftOffset(timeSeconds, driftStrength, field.driftX);
    const centerY = field.center[1] + getColorDriftOffset(timeSeconds, driftStrength, field.driftY);
    drawRadialGlow(context, centerX, centerY, field.radius, field.colorStops);
  }
}

function drawSilhouetteMask(context, points) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.globalCompositeOperation = 'source-over';
  context.filter = `blur(${MASK_BLUR_PX}px)`;
  context.fillStyle = '#fff';
  traceClosedCurve(context, points);
  context.fill();
  context.filter = 'none';
}

function drawOuterBloom(context, timeSeconds, driftStrength) {
  const centerX = 395 + getColorDriftOffset(timeSeconds, driftStrength, {
    seed: 13, amplitudePx: 30, angularSpeed: 0.2,
  });

  // Отсвет рисуется после маски прямо на итоговом canvas, поэтому выходит
  // за границу капли. globalAlpha дополнительно ослабляет alpha самого градиента.
  context.save();
  context.globalAlpha = 0.32;
  context.filter = 'blur(39px)';
  context.fillStyle = createRadialGradient(context, centerX, 395, 193, [
    [0, 'rgba(255,94,71,.56)'], [1, 'rgba(255,94,71,0)'],
  ]);
  context.fillRect(195, 195, 440, 440);
  context.restore();
}

function drawInnerContours(context, points, timeSeconds) {
  const [centerX, centerY] = INNER_CONTOUR_CENTER;
  context.save();
  context.lineWidth = 1;

  for (const contour of INNER_CONTOURS) {
    // Уменьшенная копия силуэта + смещение + небольшая бегущая волна.
    // Эти линии анимируются от общего времени, независимо от дрейфа цвета.
    const innerPoints = points.map(([x, y], pointIndex) => [
      centerX + (x - centerX) * contour.scale + contour.offsetX
        + 6 * Math.sin(timeSeconds * 0.19 + contour.phaseOffset + pointIndex * 0.12),
      centerY + (y - centerY) * contour.scale + contour.offsetY
        + 6 * Math.cos(timeSeconds * 0.21 + contour.phaseOffset + pointIndex * 0.12),
    ]);

    context.strokeStyle = `rgba(255,255,255,${contour.opacity})`;
    traceClosedCurve(context, innerPoints);
    context.stroke();
  }

  context.restore();
}

function createLayerContext(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

// Создаём два служебных canvas один раз. Они принадлежат только этому рендеру
// и не добавляются в DOM: один хранит цвета, второй — прозрачность силуэта.
export function createColorMassRenderer(context) {
  const { width, height } = context.canvas;
  const colorContext = createLayerContext(width, height);
  const maskContext = createLayerContext(width, height);

  return function renderColorMasses(points, { timeSeconds, colorDriftStrength }) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);

    // 1. Шесть независимых радиальных градиентов на прозрачном слое.
    drawColorFields(colorContext, timeSeconds, colorDriftStrength);

    // 2. Размытый силуэт. Для маски важна alpha, белый цвет сам по себе не важен.
    drawSilhouetteMask(maskContext, points);

    // 3. destination-in оставляет нарисованные цвета пропорционально alpha маски:
    // непрозрачный центр сохраняет их, прозрачная область убирает, край смягчает.
    colorContext.globalCompositeOperation = 'destination-in';
    colorContext.drawImage(maskContext.canvas, 0, 0);
    colorContext.globalCompositeOperation = 'source-over';
    context.drawImage(colorContext.canvas, 0, 0);

    // 4–5. Дополнительные детали поверх уже обрезанных цветных пятен.
    drawOuterBloom(context, timeSeconds, colorDriftStrength);
    drawInnerContours(context, points, timeSeconds);
  };
}
