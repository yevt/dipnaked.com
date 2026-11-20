const letter = 'assets/d-mask.svg';
const spiral = 'assets/spiral-three.svg';

export const letters = [
    { id: 'd', label: 'Прямо', src: letter },
    { id: 'd-left', label: '45° влево', src: letter + '#left' },
    { id: 'd-right', label: '45° вправо', src: letter + '#right' },
];

function band(id, label, above, below) {
    return {
        id, label,
        src: spiral + '#' + id,
        air: spiral + '#mist-' + above,
        water: spiral + '#ink-' + below,
    };
}

export const spirals = [
    { id: 'contour', label: 'Исходный контур', src: spiral },
    band('even', 'Одинаковая ширина', 'wide', 'wide'),
    band('slim-below', 'Тоньше снизу', 'wide', 'slim'),
    band('slim-above', 'Тоньше сверху', 'slim', 'wide'),
];

export function findSign(id) {
    return [...letters, ...spirals].find(sign => sign.id === id);
}

export function signDescription(sign) {
    return (letters.includes(sign) ? 'Буква D' : 'Спираль') + ', ' + sign.label.toLowerCase();
}

export function showSignOnSheet(logo, sign) {
    if (sign.id === 'contour') return;
    const topImage = logo.querySelector(':scope > img');
    const water = logo.querySelector('.logo-water');
    if (!sign.air) {
        topImage.src = sign.src;
        water.remove();
        return;
    }
    // Clip both complete bands at the same responsive waterline as the original.
    const air = document.createElement('div');
    air.className = 'logo-air';
    air.setAttribute('data-print-clip', '');
    topImage.replaceWith(air);
    topImage.src = sign.air;
    air.append(topImage);
    water.querySelector('img').src = sign.water;
}
