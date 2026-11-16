import { smoothNoise } from './noise.js';

// Вычисление формы не зависит от Canvas или способа раскрашивания капли.
// timeSeconds — время анимации с учётом ползунка скорости, strength — множитель.
export function deformContour({ basePoints, center, noiseSeed }, timeSeconds, strength) {
  const [centerX, centerY] = center;
  const driftX = 8 * strength * Math.sin(timeSeconds * 0.25 + noiseSeed);
  const driftY = 9 * strength * Math.cos(timeSeconds * 0.21 + noiseSeed * 1.5);

  return basePoints.map(([x, y], pointIndex) => {
    const angle = Math.atan2(y - centerY, x - centerX);
    const distance = Math.hypot(x - centerX, y - centerY);

    // Общие волны по углу: соседние участки контура двигаются согласованно.
    const contourWaves =
      0.54 * Math.sin(2 * angle + 0.27 * timeSeconds + noiseSeed * 1.3)
      + 0.45 * Math.sin(3 * angle - 0.23 * timeSeconds + noiseSeed * 0.91)
      + 0.36 * Math.cos(4 * angle + 0.19 * timeSeconds - noiseSeed * 0.37);

    // Более мелкие отклонения. Индекс точки сдвигает её положение в шуме.
    const localNoise =
      smoothNoise(timeSeconds * 0.17 + pointIndex * 0.045, noiseSeed * 11 + 4)
      + 0.58 * smoothNoise(timeSeconds * 0.31 + pointIndex * 0.11, noiseSeed * 21 + 1);

    const radialOffset = strength * (17 * contourWaves + 13 * localNoise);
    const tangentialOffset = 9 * strength
      * smoothNoise(timeSeconds * 0.23, noiseSeed * 43 + pointIndex * 5.1);
    const radialX = (x - centerX) / distance;
    const radialY = (y - centerY) / distance;

    // (radialX, radialY) — наружу от центра; (-radialY, radialX) — поперёк радиуса.
    return [
      x + radialX * radialOffset - radialY * tangentialOffset + driftX,
      y + radialY * radialOffset + radialX * tangentialOffset + driftY,
    ];
  });
}

// Ручки Безье для опорной точки замкнутой Catmull–Rom-кривой.
// Коэффициент 1/6 переводит касательную Catmull–Rom в ручку кубической Безье.
// Эту же функцию использует схематичный рендер, чтобы показывать реальные ручки.
export function getBezierHandles(points, pointIndex) {
  const count = points.length;
  const previous = points[(pointIndex - 1 + count) % count];
  const current = points[pointIndex];
  const next = points[(pointIndex + 1) % count];
  const handleX = (next[0] - previous[0]) / 6;
  const handleY = (next[1] - previous[1]) / 6;

  return {
    incoming: [current[0] - handleX, current[1] - handleY],
    outgoing: [current[0] + handleX, current[1] + handleY],
  };
}

// Только задаёт текущий путь. Вызывающий код сам выбирает fill(), stroke(), clip().
export function traceClosedCurve(context, points) {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const nextIndex = (pointIndex + 1) % points.length;
    const { outgoing } = getBezierHandles(points, pointIndex);
    const { incoming } = getBezierHandles(points, nextIndex);
    const next = points[nextIndex];

    context.bezierCurveTo(
      outgoing[0], outgoing[1],
      incoming[0], incoming[1],
      next[0], next[1],
    );
  }

  context.closePath();
}
