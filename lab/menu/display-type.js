import { families } from './glyph-families.js';

// One-based positions in the font's ss02 sequence. A phase is shared by
// every character that uses the drawing, including Cyrillic А and Р.
const omittedForms = new Map([['A', 3], ['R', 3], ['P', 2]]);

export function alternateDisplayType(sheet) {
    const characters = new Map();
    const nextPhase = new Map();
    const omittedPhase = new Map();
    for (const family of families) {
        family.forEach((letters, base) => {
            for (const letter of letters) {
                characters.set(letter, { family, base });
                if (omittedForms.has(letter)) {
                    omittedPhase.set(family, (base + omittedForms.get(letter) - 1) % family.length);
                }
            }
        });
    }

    function formOf(letter) {
        const entry = characters.get(letter);
        if (!entry) return 1;
        const { family, base } = entry;
        let phase = nextPhase.get(family) ?? base;
        if (phase === omittedPhase.get(family)) phase = (phase + 1) % family.length;
        nextPhase.set(family, (phase + 1) % family.length);
        return 1 + (phase - base + family.length) % family.length;
    }

    for (const label of sheet.querySelectorAll('.wordmark, .word')) {
        const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            const fixedForm = node.parentElement.closest('[data-glyph-form]');
            const runs = [];
            for (const letter of node.data) {
                const form = formOf(letter);
                // Authored letters still take their place in the page-wide sequence.
                if (fixedForm) continue;
                const last = runs.at(-1);
                if (last && last.form === form) last.text += letter;
                else runs.push({ form, text: letter });
            }
            if (!runs.some(run => run.form > 1)) continue;
            const fragment = document.createDocumentFragment();
            for (const { form, text } of runs) {
                if (form === 1) {
                    fragment.append(text);
                } else {
                    const span = document.createElement('span');
                    span.dataset.glyphForm = form;
                    span.textContent = text;
                    fragment.append(span);
                }
            }
            node.replaceWith(fragment);
        }
    }
    sheet.classList.add('sequenced-type');
}

export function fitSlogan(brand) {
    const mark = brand.querySelector('.wordmark');
    const slogan = brand.querySelector('.slogan');
    const word = document.createRange();
    word.selectNodeContents(mark);
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    const sampleSpacing = 'letterSpacing' in ctx ? 1 : 0;

    function fit() {
        // Both terminal forms of d have a quarter em of blank advance.
        const display = getComputedStyle(mark);
        const end = word.getBoundingClientRect().right - parseFloat(display.fontSize) / 4
            - (parseFloat(display.letterSpacing) || 0);
        const style = getComputedStyle(slogan);
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        // Positive tracking uses the same shaping as the spaced line (including ff).
        ctx.letterSpacing = sampleSpacing + 'px';
        const text = slogan.textContent;
        const ink = ctx.measureText(text);
        const endInset = parseFloat(style.getPropertyValue('--slogan-end-inset')) || 2;
        const width = end - endInset - slogan.getBoundingClientRect().left;
        const gaps = Math.max(1, Array.from(text).length - 1);
        slogan.style.textIndent = ink.actualBoundingBoxLeft + 'px';
        const extra = width - (ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight);
        const tracking = Math.max(0, sampleSpacing + extra / gaps);
        slogan.style.letterSpacing = tracking + 'px';
        slogan.style.whiteSpace = tracking > 0 ? 'nowrap' : 'normal';
    }

    fit();
    const sizes = new ResizeObserver(fit);
    sizes.observe(mark);
    sizes.observe(slogan);
    document.fonts.addEventListener('loadingdone', fit);
}
