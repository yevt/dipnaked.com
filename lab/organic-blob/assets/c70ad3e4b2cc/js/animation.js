// Часы общие для всех рендеров. Здесь нет геометрии, цветов и DOM-контролов.
export function createAnimationLoop({ renderFrame, getSpeed }) {
  let timeSeconds = 0;
  let paused = false;
  let previousTimestamp = null;
  let started = false;

  function redraw() {
    renderFrame(timeSeconds);
  }

  function tick(timestampMilliseconds) {
    if (previousTimestamp === null) previousTimestamp = timestampMilliseconds;

    // Ограничение шага предотвращает большой скачок после неактивной вкладки.
    const elapsedSeconds = Math.min((timestampMilliseconds - previousTimestamp) / 1000, 0.06);
    previousTimestamp = timestampMilliseconds;

    if (!paused) {
      timeSeconds += elapsedSeconds * getSpeed();
      redraw();
    }

    requestAnimationFrame(tick);
  }

  return {
    get paused() {
      return paused;
    },
    start() {
      if (started) return;
      started = true;
      redraw();
      requestAnimationFrame(tick);
    },
    togglePause() {
      paused = !paused;
      if (paused) redraw();
    },
    reset() {
      timeSeconds = 0;
      redraw();
    },
    redraw,
  };
}
