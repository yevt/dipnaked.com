// Одинаковые index и seed всегда дают одно и то же число в диапазоне [0, 1).
// Это детерминированный псевдослучайный сигнал, а не Math.random() на каждом кадре.
function seededRandom(index, seed) {
  const value = Math.sin(index * 127.137 + seed * 414.93) * 43758.5453123;
  return value - Math.floor(value);
}

// Одномерный плавный шум в диапазоне [-1, 1]. position может быть дробным:
// соседние псевдослучайные значения соединяются плавной интерполяцией smoothstep.
export function smoothNoise(position, seed) {
  const leftIndex = Math.floor(position);
  const fraction = position - leftIndex;
  const blend = fraction * fraction * (3 - 2 * fraction);

  return (
    (seededRandom(leftIndex, seed) * (1 - blend)
      + seededRandom(leftIndex + 1, seed) * blend) * 2 - 1
  );
}
