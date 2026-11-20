const goldenAngle = Math.PI * (3 - Math.sqrt(5));
// A logo is a rounded box: a rectangular core with a radius around it.
// This lets round marks nest between square app icons.
function touches(a, b, gap) {
    const dx = Math.max(0, Math.abs(a.x - b.x) - a.core - b.core);
    const dy = Math.max(0, Math.abs(a.y - b.y) - a.core - b.core);
    return dx * dx + dy * dy < (a.corner + b.corner + gap) ** 2;
}

function serviceLayout(services, cx, cy, unit) {
    const { clientWidth, clientHeight } = document.documentElement;
    const samples = [];
    const count = services.length * 72;
    for (let i = 0; i < count; i++) {
        const r = unit * Math.sqrt(i / count);
        const angle = i * goldenAngle + 0.73;
        const x = r * Math.cos(angle), y = r * Math.sin(angle);
        if (cx + x > 0 && cx + x < clientWidth && cy + y > 0 && cy + y < clientHeight) samples.push({ x, y });
    }

    function fits(mark, neighbours, gap) {
        const { x, y, size, core, corner } = mark;
        const rim = Math.hypot(Math.abs(x) + core, Math.abs(y) + core) + corner;
        const room = Math.min(cx + x, clientWidth - cx - x, cy + y, clientHeight - cy - y);
        return room >= (size + gap) / 2 && rim + gap / 2 <= unit
            && !neighbours.some(other => touches(mark, other, gap));
    }

    // Visit the spiral from the puncture outwards in menu order. Fit the
    // largest common scale for which every mark clears its neighbours and rim.
    function place(scale) {
        const packed = [];
        const gap = scale * 0.065;
        for (const { x, y } of samples) {
            const i = packed.length;
            const size = scale * (1.14 - 0.28 * i / Math.max(1, services.length - 1));
            const corner = size * (services[i].shape === 'round' ? 0.5 : 0.17);
            const core = size / 2 - corner;
            const mark = { x, y, size, corner, core };
            if (!fits(mark, packed, gap)) continue;
            packed.push(mark);
            if (packed.length === services.length) return packed;
        }
    }

    let low = 0, high = 2 * unit / Math.sqrt(services.length);
    let layout = place(0);
    for (let pass = 0; pass < 8; pass++) {
        const scale = (low + high) / 2;
        const trial = place(scale);
        if (trial) { low = scale; layout = trial; }
        else high = scale;
    }
    // Apply optical corrections within the chosen slots, including the hit targets.
    services.forEach(({ opticalOffset }, i) => {
        if (!opticalOffset) return;
        const mark = layout[i];
        const x = mark.x + mark.size * opticalOffset[0];
        const y = mark.y + mark.size * opticalOffset[1];
        const shifted = { ...mark, x, y };
        if (fits(shifted, layout.filter(other => other !== mark), 0)) layout[i] = shifted;
    });
    return layout;
}

function addServices(bed, services, cx, cy, unit) {
    if (!services.length) return;
    const layout = serviceLayout(services, cx, cy, unit);
    const nav = document.createElement('nav');
    nav.className = 'tear-services';
    nav.setAttribute('aria-label', 'Слушать dipnaked');
    services.forEach((service, i) => {
        const { x, y, size, corner } = layout[i];
        const link = document.createElement('a');
        link.className = 'tear-service';
        link.href = service.href;
        link.title = service.name;
        link.setAttribute('aria-label', service.name);
        link.style.setProperty('--offset-x', x + 'px');
        link.style.setProperty('--offset-y', y + 'px');
        link.style.width = size + 'px';
        link.style.height = size + 'px';
        link.style.borderRadius = corner + 'px';
        const icon = new Image();
        icon.src = service.icon;
        icon.alt = '';
        link.append(icon);
        nav.append(link);
    });
    bed.append(nav);
}

export function addPreview(bed, preview, trigger, cx, cy, unit) {
    if (preview.type === 'services') {
        addServices(bed, preview.services, cx, cy, unit);
        return;
    }

    const { clientWidth: width, clientHeight: height } = document.documentElement;
    const reach = unit * 0.77;
    const left = Math.max(-reach, 4 - cx), right = Math.min(reach, width - cx - 4);
    const top = Math.max(-reach, 4 - cy), bottom = Math.min(reach, height - cy - 4);
    const card = document.createElement('div');
    card.className = 'tear-card';
    card.style.setProperty('--offset-x', (left + right) / 2 + 'px');
    card.style.setProperty('--offset-y', (top + bottom) / 2 + 'px');
    card.style.setProperty('--card-width', right - left + 'px');
    card.style.setProperty('--card-height', bottom - top + 'px');
    if (preview.type === 'signature') {
        const sign = new Image();
        sign.className = 'tear-signature';
        sign.src = preview.src;
        sign.alt = preview.alt;
        card.append(sign);
        bed.append(card);
        return;
    }
    const link = document.createElement('a');
    link.className = 'tear-preview';
    link.href = preview.href || trigger.href;
    const label = document.createElement(preview.sectionLabel ? 'a' : 'span');
    label.className = 'tear-label';
    label.textContent = preview.caption;

    if (preview.type === 'text') {
        link.classList.add('tear-note');
        const excerpt = document.createElement('p');
        excerpt.textContent = preview.text;
        link.append(excerpt);
    } else {
        const image = new Image();
        image.src = preview.src;
        image.alt = preview.alt;
        if (preview.size === 'compact') image.className = 'compact';
        if (!preview.href) link.setAttribute('aria-label', trigger.querySelector('.word').textContent + ' — ' + preview.caption);
        link.append(image);
    }
    card.append(link);
    if (preview.sectionLabel) {
        label.href = trigger.href;
        label.setAttribute('aria-label', preview.sectionLabel);
        card.append(label);
    } else {
        link.append(label);
    }
    bed.append(card);
    if (preview.sectionLabel) {
        const tag = label.getBoundingClientRect();
        // At a screen edge the card can be barely wider than its second link.
        // Give the image and the section label separate tap targets there.
        if (right - left < 2 * tag.width || bottom - top < 2 * tag.height) {
            card.classList.add('stacked-links');
        }
    }
    if (preview.type === 'text') {
        const style = getComputedStyle(link);
        const available = bottom - top - label.getBoundingClientRect().height - parseFloat(style.rowGap);
        link.querySelector('p').style.webkitLineClamp = Math.max(1, Math.floor(available / parseFloat(style.lineHeight)));
    }
}
