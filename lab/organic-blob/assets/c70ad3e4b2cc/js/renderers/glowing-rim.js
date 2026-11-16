import { traceClosedCurve } from '../geometry.js';
import { createLinearGradient, createRadialGradient } from '../canvas-gradients.js';

// Пример 1. Все слои используют один контур; цвета закреплены в координатах
// canvas. Движение уже учтено в points, отдельное время этому рендеру не нужно.
export function renderGlowingRim(context, points) {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);

  // 1. Фон: диагональный переход и два широких пятна освещения.
  context.fillStyle = createLinearGradient(context, 0, 0, 720, 720, [
    [0, '#999e99'], [0.48, '#a6b2b1'], [1, '#87a9c4'],
  ]);
  context.fillRect(0, 0, width, height);

  context.fillStyle = createRadialGradient(context, 546, 288, 320, [
    [0, 'rgba(0,54,175,.33)'],
    [0.46, 'rgba(4,63,168,.13)'],
    [1, 'rgba(20,75,150,0)'],
  ]);
  context.fillRect(0, 0, width, height);
  context.fillStyle = createRadialGradient(context, 74, 412, 246, [
    [0, 'rgba(255,80,7,.22)'],
    [0.52, 'rgba(255,110,0,.10)'],
    [1, 'rgba(255,110,0,0)'],
  ]);
  context.fillRect(0, 0, width, height);

  // 2. Заливка с синей тенью, смещённой вправо и вниз.
  context.save();
  context.shadowBlur = 52;
  context.shadowOffsetX = 23;
  context.shadowOffsetY = 12;
  context.shadowColor = 'rgba(10,31,121,.67)';
  context.fillStyle = '#9facac';
  traceClosedCurve(context, points);
  context.fill();
  context.restore();

  // 3. Широкая размытая обводка образует внешний цветной ореол.
  context.save();
  context.filter = 'blur(25px)';
  context.lineWidth = 36;
  context.strokeStyle = createLinearGradient(context, 40, 470, 552, 208, [
    [0, 'rgba(250,95,0,.72)'],
    [0.23, 'rgba(244,36,168,.73)'],
    [0.54, 'rgba(37,57,191,.78)'],
    [0.8, 'rgba(3,57,177,.94)'],
    [1, 'rgba(33,68,208,.7)'],
  ]);
  traceClosedCurve(context, points);
  context.stroke();
  context.restore();

  // 4. Непрозрачная заливка перекрывает внутреннюю половину ореола.
  context.fillStyle = createLinearGradient(context, 115, 110, 544, 612, [
    [0, '#a7b5b3'], [0.48, '#aab1a9'], [1, '#b5bdb1'],
  ]);
  traceClosedCurve(context, points);
  context.fill();

  // 5. Два слабых блика. clip() ограничивает их текущим путём силуэта.
  context.save();
  context.clip();
  context.fillStyle = createRadialGradient(context, 496, 193, 305, [
    [0, 'rgba(255,242,170,.24)'],
    [0.62, 'rgba(255,237,170,.07)'],
    [1, 'rgba(255,237,170,0)'],
  ]);
  context.fillRect(0, 0, width, height);
  context.fillStyle = createRadialGradient(context, 105, 416, 345, [
    [0, 'rgba(20,255,250,.17)'],
    [0.5, 'rgba(20,245,245,.03)'],
    [1, 'rgba(20,245,245,0)'],
  ]);
  context.fillRect(0, 0, width, height);
  context.restore();

  // 6. Три обводки поверх друг друга: цветная кайма, размытый свет,
  // узкая светлая линия. Их ширина и порядок создают эффект преломления.
  context.save();
  context.lineWidth = 12;
  context.strokeStyle = createLinearGradient(context, 44, 410, 555, 360, [
    [0, '#c22875'], [0.34, '#7738dd'], [0.63, '#ec19a7'], [1, '#1b0b88'],
  ]);
  traceClosedCurve(context, points);
  context.stroke();
  context.restore();

  context.save();
  context.filter = 'blur(10px)';
  context.lineWidth = 19;
  context.strokeStyle = createLinearGradient(context, 38, 396, 544, 350, [
    [0, 'rgba(0,255,255,.83)'],
    [0.39, 'rgba(209,255,250,.78)'],
    [0.72, 'rgba(255,246,91,.95)'],
    [1, 'rgba(255,246,66,.95)'],
  ]);
  traceClosedCurve(context, points);
  context.stroke();
  context.restore();

  context.save();
  context.lineWidth = 7.2;
  context.strokeStyle = createLinearGradient(context, 56, 395, 538, 347, [
    [0, '#72ffff'], [0.26, '#f8ffff'], [0.52, '#f9ffed'],
    [0.79, '#fffa87'], [1, '#ffff65'],
  ]);
  traceClosedCurve(context, points);
  context.stroke();
  context.restore();

  // 7. Дополнительный тонкий блик, чуть смещённый вверх и влево.
  context.save();
  context.translate(-1, -3);
  context.lineWidth = 2.1;
  context.strokeStyle = createLinearGradient(context, 69, 280, 548, 330, [
    [0, 'rgba(42,255,244,.65)'],
    [0.3, 'rgba(255,255,249,.95)'],
    [0.72, 'rgba(255,249,155,.95)'],
    [1, 'rgba(255,216,80,.88)'],
  ]);
  traceClosedCurve(context, points);
  context.stroke();
  context.restore();
}
