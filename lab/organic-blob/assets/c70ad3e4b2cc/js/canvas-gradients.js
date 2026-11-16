// colorStops — пары [позиция от 0 до 1, CSS-цвет].
// Создание градиента ничего не рисует: его нужно присвоить fillStyle/strokeStyle.
export function createLinearGradient(context, startX, startY, endX, endY, colorStops) {
  const gradient = context.createLinearGradient(startX, startY, endX, endY);
  for (const [position, color] of colorStops) {
    gradient.addColorStop(position, color);
  }
  return gradient;
}

// Позиция 0 — центр круга, 1 — его внешний радиус. Промежуточные цвета
// интерполируются браузером; alpha = 0 на последней остановке даёт мягкий край.
export function createRadialGradient(context, centerX, centerY, radius, colorStops) {
  const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  for (const [position, color] of colorStops) {
    gradient.addColorStop(position, color);
  }
  return gradient;
}

export function drawRadialGlow(context, centerX, centerY, radius, colorStops) {
  context.fillStyle = createRadialGradient(context, centerX, centerY, radius, colorStops);
  context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
}
