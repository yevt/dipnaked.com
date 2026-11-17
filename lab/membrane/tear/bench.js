import GUI from '../vendor/lil-gui.esm.min.js';
import { TearSolver, tearDefaults } from './solver.js';
import { createTearRenderer } from './renderer.js';

const sheet = document.querySelector('.sheet');
const toggle = document.querySelector('#toggle');
const config = { ...tearDefaults, cameraDistance: 4, seed: 1 };
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let patch = null;
let frame = 0;
let lastTime = 0;

function clear() {
    if (!patch) return;
    cancelAnimationFrame(frame);
    patch.renderer?.dispose();
    patch.bed.remove();
    patch.canvas.remove();
    sheet.classList.remove('still');
    patch = null;
    toggle.textContent = 'Проколоть';
}

function tick(now) {
    patch.solver.advance((now - lastTime) / 1000);
    lastTime = now;
    if (patch.solver.phase === 'done') return clear();
    patch.renderer.draw();
    frame = requestAnimationFrame(tick);
}

function puncture() {
    clear();
    const bed = document.createElement('div');
    const canvas = document.createElement('canvas');
    bed.className = 'bed';
    sheet.append(bed, canvas);
    patch = { bed, canvas };
    toggle.textContent = 'Сузить поток';
    if (!motion.matches) {
        const box = sheet.getBoundingClientRect();
        const solver = new TearSolver({ ...config, pixelsPerUnit: Math.min(box.width, box.height) / 4 });
        const size = Math.min(box.width, box.height) * 0.5 * solver.radiusUnits;
        bed.style.setProperty('--bed-size', size * 0.98 + 'px');
        try {
            patch.renderer = createTearRenderer(canvas, solver, {
                sheet, size, cx: box.left + box.width / 2,
                cy: box.top + box.height / 2, cameraDistance: config.cameraDistance
            });
            patch.solver = solver;
            lastTime = performance.now();
            frame = requestAnimationFrame(tick);
            canvas.addEventListener('webglcontextlost', () => {
                if (canvas === patch?.canvas) clear();
            }, { once: true });
            return;
        } catch (error) {
            console.warn('Статический разрыв.', error);
        }
    }
    sheet.classList.add('still');
    toggle.textContent = 'Закрыть';
}

function togglePatch() {
    if (!patch || ['heal', 'settle'].includes(patch.solver?.phase)) return puncture();
    if (!patch.solver) return clear();
    patch.solver.heal();
    toggle.textContent = 'Проколоть';
}

const gui = new GUI({ title: 'Разрыв листа' });
function slider(folder, key, label, min, max, step) {
    return folder.add(config, key, min, max, step).name(label).onFinishChange(puncture);
}
const seedControl = slider(gui, 'seed', 'Зерно', 1, 999, 1);
gui.add({ randomize() {
    config.seed = 1 + Math.floor(Math.random() * 999);
    seedControl.updateDisplay();
    puncture();
} }, 'randomize').name('Другое зерно');
slider(gui, 'cameraDistance', 'Расстояние камеры', 2.5, 7, 0.1);
const wind = gui.addFolder('Ветер');
slider(wind, 'wind', 'Скорость', 0, 60, 1);
slider(wind, 'nozzleRadius', 'Радиус сопла', 0.25, 0.9, 0.01);
slider(wind, 'shrinkDuration', 'Сужение при закрытии, с', 0.4, 3, 0.1);
const jetAngle = { degrees: Math.atan(config.coneSlope) * 180 / Math.PI };
wind.add(jetAngle, 'degrees', 15, 80, 1).name('Полуугол струи, °').onFinishChange(degrees => {
    config.coneSlope = Math.tan(degrees * Math.PI / 180);
    puncture();
});
wind.close();
const sheetSettings = gui.addFolder('Материал и время');
slider(sheetSettings, 'prickRadius', 'Радиус прокола', 0.03, 0.2, 0.01);
slider(sheetSettings, 'tearStrain', 'Порог разрыва', 0.05, 3, 0.01);
slider(sheetSettings, 'memoryStiffness', 'Упругость возврата', 4, 60, 0.5);
slider(sheetSettings, 'drag', 'Сопротивление', 1, 14, 0.1);
slider(sheetSettings, 'pressDuration', 'Нажим, с', 0.08, 0.4, 0.01);
sheetSettings.close();
if (innerWidth < 700) gui.close();
sheet.addEventListener('click', togglePatch);
toggle.addEventListener('click', togglePatch);
window.addEventListener('resize', clear);
motion.addEventListener('change', clear);
