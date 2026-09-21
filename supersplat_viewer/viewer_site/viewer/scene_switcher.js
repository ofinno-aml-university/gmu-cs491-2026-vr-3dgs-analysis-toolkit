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
    const backend = params.has('webgl') ? 'webgl' : 'webgpu';
    const otherBackendUrl = () => {
        const url = new URL(location.href);
        if (backend === 'webgl') url.searchParams.delete('webgl');
        else url.searchParams.set('webgl', '');
        return url.pathname + url.search.replace('webgl=', 'webgl');
    };

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
        select.add(new Option(backend === 'webgl' ? '↺ Reload this scene on WebGPU' : '↺ Reload this scene on WebGL2', otherBackendUrl()));
        let matched = false;
        for (const scene of scenes) {
            for (const format of scene.formats) {
                const size = format.size ? `, ${format.size}` : '';
                // scene links keep the backend this page was opened with
                const option = new Option(`${scene.title} (${format.label}${size})`, catalog.viewerUrl(format, backend));
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

        // Backend badge under the drop-down: the graphics device actually in use, the splat sort
        // path, and whether a VR session can start on it. Read from the app the viewer exposes
        // once the scene has loaded (window.app), so it reflects reality, not the request.
        const badge = document.createElement('div');
        badge.id = 'backendBadge';
        Object.assign(badge.style, {
            position: 'fixed',
            top: 'calc(max(16px, env(safe-area-inset-top)) + 46px)',
            right: 'max(16px, env(safe-area-inset-right))',
            zIndex: '1000',
            padding: '4px 8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            borderRadius: '6px',
            background: 'rgba(0, 0, 0, 0.55)',
            color: '#9be59b'
        });
        badge.textContent = 'renderer: starting…';
        document.body.appendChild(badge);
        const sortNames = { 1: 'CPU sort', 2: 'GPU sort' };
        const update = () => {
            const refusal = document.getElementById('loadingText')?.textContent || '';
            if (refusal.startsWith('WebGPU is required') || refusal.startsWith('WebGL2 was requested')) {
                badge.textContent = `${backend} requested: viewer refused to start (no fallback)`;
                badge.style.color = '#ff8a80';
                return true;
            }
            const app = window.app;
            if (!app) return false;
            const device = app.graphicsDevice.deviceType;
            const sort = sortNames[app.scene.gsplat.currentRenderer] || `renderer ${app.scene.gsplat.currentRenderer}`;
            const vr = app.xr.supported ? (app.xr.isAvailable('immersive-vr') ? 'VR: available on this device' : 'VR: not available on this device') : 'VR: no WebXR';
            badge.textContent = `${device} · ${sort} · ${vr}`;
            badge.style.color = device === 'webgpu' ? '#9be59b' : device === 'webgl2' ? '#ffd166' : '#ff8a80';
            return true;
        };
        const poll = setInterval(() => {
            if (update()) clearInterval(poll);
        }, 500);
        setTimeout(() => clearInterval(poll), 120000);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
