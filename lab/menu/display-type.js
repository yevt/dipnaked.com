import { families } from './glyph-families.js';

export function alternateDisplayType(sheet) {
    const characters = new Map();
    const nextPhase = new Map();
    for (const family of families) {
        family.forEach((letters, base) => {
            for (const letter of letters) characters.set(letter, { family, base });
        });
    }

    function formOf(letter) {
        const entry = characters.get(letter);
        if (!entry) return 1;
        const { family, base } = entry;
        const phase = nextPhase.get(family) ?? base;
        nextPhase.set(family, (phase + 1) % family.length);
        return 1 + (phase - base + family.length) % family.length;
    }

    for (const label of sheet.querySelectorAll('.wordmark, .slogan, .word, .sub')) {
        const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            const runs = [];
            for (const letter of node.data) {
                const form = formOf(letter);
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
