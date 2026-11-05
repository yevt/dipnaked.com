const small = 16, large = 64, dot = 8;
const black = '#090909', white = '#f0f0f0';
const fontSize = 13, referenceFamily = 'Noto Sans Mono';
export const desktopHints = ['esc — справка', 'wasd — движение', 'мышь — обзор'];
export const touchHints = ['справка внизу', 'стик — движение', 'пальцем — обзор'];
export const discCenters = [72, 136, 200, 264];
export const discY = 168;

export async function createHelpArtwork(uppercase = false, family = referenceFamily) {
  const context = document.createElement('canvas').getContext('2d');
  context.textBaseline = 'alphabetic';
  context.textAlign = 'center';
  async function typeStyle(weight, fill) {
    await Promise.all([
      document.fonts.load(`${weight} ${fontSize}px "${referenceFamily}"`, 'м'),
      document.fonts.load(`${weight} ${fontSize}px "${family}"`, 'оОмМ'),
    ]);
    context.font = `${weight} 1000px "${referenceFamily}"`;
    const lower = context.measureText('м');
    context.font = `${weight} 1000px "${family}"`;
    const upper = context.measureText('М');
    const size = uppercase ? fontSize * (lower.actualBoundingBoxAscent + lower.actualBoundingBoxDescent)
      / (upper.actualBoundingBoxAscent + upper.actualBoundingBoxDescent) : fontSize;
    const bounds = context.measureText(uppercase ? 'О' : 'о');
    return { weight, fill, size,
      x: (bounds.actualBoundingBoxLeft - bounds.actualBoundingBoxRight) / 2 * size / 1000,
      baseline: (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2 * size / 1000,
    };
  }
  const [lightType, darkType] = await Promise.all([typeStyle(300, white), typeStyle(400, black)]);
  const circle = (x, y, diameter, fill) =>
    `<circle cx="${x}" cy="${y}" r="${diameter / 2}" fill="${fill}"/>`;
  const backing = Array.from({length: 14}, (_, row) => Array.from({length: 20}, (_, col) =>
    circle((col + .5) * small, (row + .5) * small, small, black)).join('')).join('');
  const arrowCells = [];
  for (let x = -2; x <= 2; x++) arrowCells.push([x, 0]);
  for (let y = 1; y <= 2; y++) arrowCells.push([2 - y, -y], [2 - y, y]);
  const arrow = `<g data-arrow>${arrowCells.map(([x, y]) => circle(264 + x * dot, discY + y * dot, dot, black)).join('')}</g>`;

  return (label, hints, id, splitDiscs = false) => {
    const hintsTop = 72 - (hints.length - 1) * 16;
    const letters = (text, x, y, style = lightType) => Array.from(uppercase ? text.toUpperCase() : text).map((char, i) => char === ' ' ? '' : `
      <g data-cell="${x + i * small},${y}" transform="translate(${x + i * small} ${y})"><text class="circle-letter" style="font-family:'${family}'" x="${style.x}" y="${style.baseline}"
        font-size="${style.size}" font-weight="${style.weight}" fill="${style.fill}" clip-path="url(#${id}-cell)">${char}</text></g>`).join('');
    const labelArt = letters(label, 56, discY, darkType);
    const discClips = splitDiscs ? discCenters.map((x, i) => `<clipPath id="${id}-disc-${i}" clipPathUnits="userSpaceOnUse">${circle(x, discY, large, white)}</clipPath>`).join('') : '';
    // Each rotating disc receives a geometrically clipped copy of the WHOLE
    // inscription. A letter crossing two discs is therefore split, not assigned
    // to whichever disc contains its centre. The glyph-cell clips rotate too.
    const action = splitDiscs
      ? discCenters.map((x, i) => `<g data-rotor="${i}">${circle(x, discY, large, white)}
          <g clip-path="url(#${id}-disc-${i})">${labelArt}${i === 3 ? arrow : ''}</g></g>`).join('')
      : `${discCenters.map(x => circle(x, discY, large, white)).join('')}${labelArt}${arrow}`;
    return `<defs><clipPath id="${id}-cell" clipPathUnits="userSpaceOnUse">${circle(0, 0, small, white)}</clipPath>${discClips}</defs>
      <g data-backing>${backing}</g>
      <g data-hints>${hints.map((line, i) => letters(line, 40, hintsTop + i * 32)).join('')}</g>
      <g data-action>${action}</g>`;
  };
}
