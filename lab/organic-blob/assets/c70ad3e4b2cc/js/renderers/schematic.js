import { getBezierHandles, traceClosedCurve } from '../geometry.js';

// Одинаковый диагностический рендер для любой капли: кривая, ручки и точки.
export function renderSchematic(context, points, { annotation = '' } = {}) {
  const { width, height } = context.canvas;
  context.fillStyle = '#f5f7fa';
  context.fillRect(0, 0, width, height);
  context.lineWidth = 2;
  context.strokeStyle = '#385677';
  traceClosedCurve(context, points);
  context.stroke();

  context.strokeStyle = '#a2b2c1';
  context.lineWidth = 0.7;
  context.setLineDash([4, 5]);

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const { incoming, outgoing } = getBezierHandles(points, pointIndex);
    context.beginPath();
    context.moveTo(incoming[0], incoming[1]);
    context.lineTo(outgoing[0], outgoing[1]);
    context.stroke();
  }

  context.setLineDash([]);
  for (const [x, y] of points) {
    context.beginPath();
    context.arc(x, y, 4.2, 0, Math.PI * 2);
    context.fillStyle = '#fbffff';
    context.fill();
    context.lineWidth = 1.4;
    context.strokeStyle = '#2d79b1';
    context.stroke();
  }

  if (annotation) {
    context.fillStyle = '#698397';
    context.font = '21px system-ui';
    context.fillText(annotation, 53, 160);
  }
}
