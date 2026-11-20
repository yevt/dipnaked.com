import { TearSolver } from '../membrane/tear/solver.js';
import { createTearRenderer } from '../membrane/tear/renderer.js';
import { addPreview } from './preview.js';
import { enableStripes } from './surface.js';
import { alternateDisplayType } from './display-type.js';

const sheet = document.querySelector('.sheet');
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let active = null;
let healing = null;
let frame = 0;
let lastTime = 0;

function removePatch(patch) {
    patch?.renderer?.dispose();
    patch?.element.remove();
}

function tick(now) {
    frame = 0;
    const seconds = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    for (const patch of [healing, active]) {
        if (!patch?.solver) continue;
        patch.solver.advance(seconds);
        if (patch === healing && patch.solver.phase === 'done') {
            removePatch(healing);
            healing = null;
        } else {
            // Canvas and native text can rasterize a pixel apart. Transfer
            // visibility during the same final movement, without a later swap.
            if (patch === healing && patch.solver.phase === 'settle') {
                patch.element.style.opacity = String(1 - patch.solver.settleProgress);
            }
            patch.renderer.draw();
        }
    }
    if (active?.solver || healing?.solver) frame = requestAnimationFrame(tick);
}

function wake() {
    if (frame) return;
    lastTime = performance.now();
    frame = requestAnimationFrame(tick);
}

function closePatch({ animate = true, restoreFocus = false } = {}) {
    if (!active) return;
    const patch = active;
    active = null;
    sheet.inert = false;
    root.classList.remove('tear-open', 'over-preview');
    patch.trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {
        patch.returnFocus?.focus({ preventScroll: true });
    } else if (patch.element.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    removePatch(healing);
    healing = null;
    if (animate && patch.solver) {
        patch.element.inert = true;
        patch.element.classList.add('healing');
        patch.solver.heal();
        healing = patch;
        wake();
    } else {
        removePatch(patch);
    }
}

function reset() {
    closePatch({ animate: false });
    removePatch(healing);
    healing = null;
    cancelAnimationFrame(frame);
    frame = 0;
}

function refreshTexture() {
    active?.renderer?.refreshTexture();
    healing?.renderer?.refreshTexture();
}

function onScroll() {
    // Focusing a menu item may queue a scroll event before Enter opens it.
    // Discard a snapshot only if the sheet has moved since that snapshot.
    const moved = patch => patch && (patch.scrollX !== window.scrollX || patch.scrollY !== window.scrollY);
    if (moved(active)) reset();
    else if (moved(healing)) {
        removePatch(healing);
        healing = null;
    }
}

function uncovered(patch, x, y) {
    if (patch.renderer) return !patch.renderer.covers(x, y);
    return Math.hypot(x - patch.cx, y - patch.cy) < patch.unit;
}

// A grid cell can be much wider than its word. Ranges also preserve the
// individual line boxes of a wrapped caption in any future layout.
function textRange(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range;
}

function hitsLinkText(anchor, x, y) {
    const contains = rect => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        if (node.data.trim() && [...textRange(node).getClientRects()].some(contains)) return true;
    }
    return [...anchor.querySelectorAll('img, svg')].some(image => contains(image.getBoundingClientRect()));
}

function openPatch(cx, cy, trigger, preview) {
    const unit = Math.min(root.clientWidth, root.clientHeight) / 4;
    const element = document.createElement('section');
    element.className = 'tear';
    element.tabIndex = -1;
    element.setAttribute('aria-label', preview ? trigger.querySelector('.word').textContent : 'Разрыв листа');
    element.style.setProperty('--unit', unit + 'px');
    element.style.left = cx + 'px';
    element.style.top = cy + 'px';
    const bed = document.createElement('div');
    bed.className = 'tear-bed';
    element.append(bed);

    const patch = {
        element, trigger, cx, cy, unit, solver: null, renderer: null,
        scrollX: window.scrollX, scrollY: window.scrollY,
        returnFocus: trigger || document.activeElement
    };
    document.body.append(element);
    if (preview) addPreview(bed, preview, trigger, cx, cy, unit);
    if (!reducedMotion.matches) {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        element.append(canvas);
        try {
            const solver = new TearSolver({
                seed: crypto.getRandomValues(new Uint32Array(1))[0],
                pixelsPerUnit: unit,
            });
            const size = 2 * unit * solver.radiusUnits;
            element.style.setProperty('--bed-size', size * 0.98 + 'px');
            patch.renderer = createTearRenderer(canvas, solver, { sheet, cx, cy, size });
            patch.solver = solver;
            canvas.addEventListener('webglcontextlost', () => {
                if (active !== patch && healing !== patch) return;
                patch.element.classList.add('static');
                patch.solver = null;
                patch.renderer = null;
                canvas.remove();
                if (healing === patch) {
                    removePatch(healing);
                    healing = null;
                }
            }, { once: true });
        } catch (error) {
            console.warn('Переход на статический разрыв.', error);
            canvas.remove();
        }
    }
    if (!patch.renderer) element.classList.add('static');
    active = patch;
    root.classList.add('tear-open');
    sheet.inert = true;
    trigger?.setAttribute('aria-expanded', 'true');
    (bed.querySelector('a') || element).focus({ preventScroll: true });
    if (patch.solver) wake();
}

async function enableMenu() {
    const response = await fetch(new URL('./previews.json', import.meta.url));
    if (!response.ok) throw new Error('previews.json: ' + response.status);
    const previews = await response.json();
    for (const trigger of sheet.querySelectorAll('a[data-preview]')) {
        const preview = previews[trigger.dataset.preview];
        if (!preview) continue;
        trigger.setAttribute('aria-expanded', 'false');
        if (preview.src) new Image().src = preview.src;
    }
    root.classList.add('tear-ready');

    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.target.closest('.surface-picker')) return;
        if (active) {
            // Keyboard activation of a content link has no pointer coordinates.
            if (event.detail === 0 && active.element.contains(event.target.closest('a[href]'))) return;
            if (uncovered(active, event.clientX, event.clientY)) return;
            event.preventDefault();
            event.stopPropagation();
            closePatch();
            return;
        }
        if (!sheet.contains(event.target) || event.metaKey || event.ctrlKey ||
            event.shiftKey || event.altKey) return;
        let trigger = event.target.closest('a');
        if (trigger && event.detail && !hitsLinkText(trigger, event.clientX, event.clientY)) trigger = null;
        const preview = trigger && previews[trigger.dataset.preview];
        if (trigger && !preview) return;
        event.preventDefault();
        if (trigger && event.detail === 0) {
            const label = trigger.querySelector('.word') || trigger;
            label.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            const word = textRange(label).getBoundingClientRect();
            openPatch(word.x + word.width / 2, word.y + word.height / 2, trigger, preview);
        } else {
            openPatch(event.clientX, event.clientY, trigger, preview);
        }
    }, true);

    document.addEventListener('auxclick', event => {
        if (event.button === 1 && active?.element.contains(event.target.closest('a[href]')) &&
            !uncovered(active, event.clientX, event.clientY)) event.preventDefault();
    }, true);

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && active) {
            event.preventDefault();
            closePatch({ restoreFocus: true });
        }
    });
    document.addEventListener('pointermove', event => {
        if (!active || event.pointerType === 'touch') return;
        const link = event.target.closest('a[href]');
        root.classList.toggle('over-preview', active.element.contains(link) && uncovered(active, event.clientX, event.clientY));
    }, { passive: true });
    window.addEventListener('resize', reset);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', reset);
    reducedMotion.addEventListener('change', reset);
    document.fonts.addEventListener('loadingdone', refreshTexture);
}

alternateDisplayType(sheet);
enableStripes(sheet, refreshTexture);
enableMenu().catch(error => console.warn('Меню работает в режиме обычных ссылок.', error));
