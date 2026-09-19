// scene_switcher.js — adds a scene drop-down to the SuperSplat viewer page.
//
// Injected by ../../generate_viewer_page.mjs through the viewer package's renderViewerHtml
// (headExtras), so the viewer's own source stays unmodified. Choosing an entry navigates to a fresh
// viewer page, which unloads the current scene completely before the next one starts loading.
(function () {
    'use strict';

    const params = new URL(location.href).searchParams;
    if (!params.has('content')) {
        // the viewer page was opened without a scene: go to the picker instead
        location.replace('/');
        return;
    }
    if (params.has('noui')) return;
    const current = params.get('content');

    const build = async () => {
        const catalog = window.sceneCatalog;
        const select = document.createElement('select');
        select.id = 'sceneSwitcher';
        select.title = 'Switch scene';
        Object.assign(select.style, {
            position: 'fixed',
            top: 'max(16px, env(safe-area-inset-top))',
            right: 'max(16px, env(safe-area-inset-right))',
            zIndex: '1000',
            maxWidth: '55vw',
            padding: '10px 12px',
            fontSize: '16px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            background: 'rgba(0, 0, 0, 0.65)',
            color: '#fff'
        });
        select.add(new Option('Loading scenes…', ''));
        document.body.appendChild(select);

        let scenes = [];
        try {
            scenes = await catalog.load();
        } catch (err) {
            console.warn('scene list unavailable', err);
        }

        select.replaceChildren();
        select.add(new Option('⌂ All scenes', '/'));
        let matched = false;
        for (const scene of scenes) {
            for (const format of scene.formats) {
                const size = format.size ? `, ${format.size}` : '';
                const option = new Option(`${scene.title} (${format.label}${size})`, catalog.viewerUrl(format));
                if (format.url === current) {
                    option.selected = true;
                    matched = true;
                }
                select.add(option);
            }
        }
        if (!matched) {
            const option = new Option('(current scene)', '');
            option.selected = true;
            select.insertBefore(option, select.firstChild);
        }
        select.addEventListener('change', () => {
            if (select.value) location.href = select.value;
        });
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
