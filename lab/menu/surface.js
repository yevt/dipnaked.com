import { loadTubeProfile, stripeDrawing } from './continuous-tube.js';

export function enableStripes(sheet, refreshTexture) {
    const anchor = sheet.querySelector('.logo-slot');
    const picker = document.querySelector('.surface-picker');
    const toggle = picker.querySelector('input');
    const params = new URLSearchParams(location.search);
    const logo = sheet.querySelector('.logo');
    logo.addEventListener('load', refreshTexture);
    const mark = params.get('mark');
    if (mark === 'drain' || mark === 'drain-void') {
        logo.src = `assets/${mark}.svg`;
        document.querySelector('link[rel="icon"]').href = logo.src;
    }
    picker.hidden = !params.has('compare');
    toggle.checked = params.get('stripes') === '1';

    const field = new Image();
    field.className = 'surface-field';
    field.alt = '';
    field.hidden = true;
    sheet.prepend(field);
    let profile, loading, lastPrint;

    function placeField() {
        if (!toggle.checked) {
            if (!field.hidden) {
                field.hidden = true;
                refreshTexture();
            }
            return;
        }
        if (!profile) {
            loading ??= loadTubeProfile().then(result => {
                profile = result;
                placeField();
            }).catch(error => {
                loading = null;
                console.warn('Не удалось загрузить рисунок полосок.', error);
            });
            return;
        }
        const page = sheet.getBoundingClientRect(), sign = anchor.getBoundingClientRect();
        if (!sign.width || !page.width || !page.height) return;
        const key = [page.width, page.height, sign.left - page.left, sign.top - page.top,
            sign.width, devicePixelRatio].join('/');
        if (key !== lastPrint) {
            lastPrint = key;
            field.src = stripeDrawing(profile, page, sign);
        } else if (field.hidden && field.complete && field.naturalWidth) {
            field.hidden = false;
            refreshTexture();
        }
    }

    field.addEventListener('load', () => {
        if (!toggle.checked) return;
        field.hidden = false;
        refreshTexture();
    });
    toggle.addEventListener('change', () => {
        const url = new URL(location.href);
        if (toggle.checked) url.searchParams.set('stripes', '1');
        else url.searchParams.delete('stripes');
        history.replaceState(null, '', url);
        placeField();
    });
    const observer = new ResizeObserver(placeField);
    for (const element of [sheet, sheet.querySelector('.safe'), anchor]) observer.observe(element);
    window.addEventListener('resize', placeField);
    document.fonts.addEventListener('loadingdone', placeField);
    placeField();
}
