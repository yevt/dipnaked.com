"use strict";

const canvas = document.getElementById("scene");
const sceneContext = canvas.getContext("2d");
const field = document.querySelector(".field");
const cordReading = document.getElementById("extension");
const pauseButton = document.getElementById("pause");
const bonesToggle = document.getElementById("bones-toggle");
const figureSelect = document.getElementById("figure");
let world, scale, dpr;
let paused = false;
let hasMouseInput = false;
let carry = 0;
let previousFrame = null;

function paint() {
  if (!world) return;
  renderScene(sceneContext, world, scale, dpr, bonesToggle.checked);
  const length = world.cordLength;
  const value = length > 0 && length < 1 ? "<1" : String(Math.round(length));
  if (cordReading.value !== value) cordReading.value = value;
}

function sizeView() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  dpr = Math.min(devicePixelRatio || 1, 2);
  // Leave room for a full turn around a cursor near the middle of the field.
  scale = Math.min(width / 580, height / 600, 2.4);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const w = width / scale, h = height / scale;
  if (!world) {
    world = new PuppetWorld(w, h, figureSelect.value);
  } else if (Math.abs(w - world.width) + Math.abs(h - world.height) > 0.01) {
    world.resize(w, h);
  }
  paint();
}

function animate(now) {
  if (hasMouseInput && !paused && !document.hidden && previousFrame !== null) {
    // Cap catch-up after a stalled frame. Never integrate one large, unstable step.
    carry += Math.min(now - previousFrame, STEP_MS * 10);
    let advanced = false;
    while (carry >= STEP_MS) {
      world.step();
      carry -= STEP_MS;
      advanced = true;
    }
    if (advanced) paint();
  }
  previousFrame = now;
  requestAnimationFrame(animate);
}

function togglePause() {
  paused = !paused;
  carry = 0; previousFrame = null;
  pauseButton.setAttribute("aria-pressed", String(paused));
  document.getElementById("pause-label").textContent = paused ? "Продолжить" : "Пауза";
  document.querySelector("#pause-icon path").setAttribute("d", paused ? "M8 5l11 7-11 7z" : "M9 6v12m6-12v12");
}

function resetPose() {
  world.reset(figureSelect.value);
  field.dataset.figure = world.figure;
  canvas.setAttribute("aria-label", figureSelect.selectedOptions[0].textContent + " на упругой нити в невесомости");
  carry = 0; previousFrame = null;
  hasMouseInput = false;
  paint();
}

sizeView();
loadDrawing().then(paint).catch(error => {
  document.getElementById("art-error").hidden = false;
  console.error("Ошибка загрузки слоёв персонажа", error);
  paint();
});
const layoutObserver = new ResizeObserver(sizeView);
layoutObserver.observe(canvas);
window.addEventListener("resize", sizeView);

for (const key of Object.keys(DEFAULT_SETTINGS)) {
  const input = document.getElementById(key);
  const output = document.getElementById(key + "-value");
  function applySlider() {
    const value = input.valueAsNumber;
    world.setSettings({ [key]: value / 100 });
    output.value = value + " %";
    input.style.setProperty("--fill", value + "%");
  }
  input.value = String(Math.round(DEFAULT_SETTINGS[key] * 100));
  input.addEventListener("input", applySlider);
  applySlider();
}

canvas.addEventListener("pointermove", event => {
  if (paused || event.pointerType !== "mouse") return;
  const bounds = canvas.getBoundingClientRect();
  world.setTarget((event.clientX - bounds.left) / scale, (event.clientY - bounds.top) / scale);
  hasMouseInput = true;
});
pauseButton.addEventListener("click", togglePause);
document.getElementById("reset").addEventListener("click", resetPose);
bonesToggle.addEventListener("change", paint);
figureSelect.addEventListener("change", resetPose);
document.addEventListener("visibilitychange", () => { previousFrame = null; carry = 0; });
document.addEventListener("keydown", event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest("textarea, [contenteditable=true]")) return;
  if (event.target.closest("select") && !canvas.matches(":hover")) return;
  if (event.code === "Space") {
    if (event.target.closest("input, button") && !canvas.matches(":hover")) return;
    event.preventDefault();
    togglePause();
  }
  if (event.code === "KeyR") resetPose();
});
requestAnimationFrame(animate);
