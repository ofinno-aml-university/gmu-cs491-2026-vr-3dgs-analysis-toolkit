// scene_catalog.js — shared by the picker page (/index.html) and the in-viewer drop-down
// (/viewer/scene_switcher.js).
//
// Lists the scene files in /3DGS_scenes/ (the folder students drop files into; .sog copies made by
// convert_scenes_to_sog.mjs live there too), grouped by file name. The raw PLY is always the
// default ("primary") format of a scene; a SOG is only offered as an extra option.
// Relies on the JSON folder listing that serve_for_quest.mjs returns for the folder.
(function () {
    'use strict';

    const SCENE_DIR = '/3DGS_scenes/';
    // above this size a raw PLY gets a "large" note on the picker (a rough guide for the Quest browser)
    const LARGE_RAW_BYTES = 250 * 1024 * 1024;

    // formats the viewer can open; lower rank = preferred as the default button
    const KINDS = {
        ply:            { label: 'PLY',            rank: 0 },
        compressed_ply: { label: 'compressed PLY', rank: 1 },
        sog_folder:     { label: 'SOG folder',     rank: 2 },
        sog:            { label: 'SOG',            rank: 3 }
    };

    const encodePath = (dir, name) => dir + encodeURIComponent(name);

    const listDirectory = async (dir) => {
        const response = await fetch(dir, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) throw new Error(`listing ${dir} failed: HTTP ${response.status}`);
        const data = await response.json();
        return (data.files || []).filter((entry) => entry.base !== '..');
    };

    // the listing reports sizes as text ("522 MB", "1 GB"); turn that into an approximate byte count
    const parseSize = (text) => {
        const m = /^([\d.]+)\s*(B|KB|MB|GB|TB)$/i.exec(text || '');
        if (!m) return null;
        const power = ['B', 'KB', 'MB', 'GB', 'TB'].indexOf(m[2].toUpperCase());
        return Number(m[1]) * 1024 ** power;
    };

    const textFile = async (url) => {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            return response.ok ? await response.text() : '';
        } catch (err) {
            return '';
        }
    };

    // split a file name into the scene name (stem) and the kind of file
    const classify = (name) => {
        const lower = name.toLowerCase();
        const cut = (n) => name.slice(0, -n);
        if (lower.endsWith('.tmp.sog')) return null;                       // conversion in progress
        if (lower.endsWith('.compressed.ply')) return { stem: cut(15), kind: 'compressed_ply' };
        if (lower.endsWith('.ply')) return { stem: cut(4), kind: 'ply' };
        if (lower.endsWith('.sog')) return { stem: cut(4), kind: 'sog' };
        if (lower.endsWith('.converting')) return { stem: cut(11), kind: 'converting' };
        if (lower.endsWith('.failed.txt')) return { stem: cut(11), kind: 'failed' };
        if (lower.endsWith('.txt')) return { stem: cut(4), kind: 'info' };
        return null;
    };

    // "Key: value" lines of a .txt sidecar (Title, Author, Source, License, ...)
    const parseInfo = (text) => {
        const info = {};
        for (const line of text.split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Za-z ]+):\s*(.+?)\s*$/);
            if (m) info[m[1].trim().toLowerCase()] = m[2];
        }
        return info;
    };

    const load = async () => {
        const scenes = new Map();
        const scene = (stem) => {
            if (!scenes.has(stem)) {
                scenes.set(stem, { stem, title: stem, info: {}, formats: [], converting: false, failed: false });
            }
            return scenes.get(stem);
        };
        const addFormat = (stem, kind, url, name, size, bytes, modified) => {
            scene(stem).formats.push({
                kind, label: KINDS[kind].label, rank: KINDS[kind].rank, url, name,
                size: size || '',                       // text from the listing, for display
                bytes: bytes ?? parseSize(size),        // exact when the listing gives it, else approximate
                modified: modified ? Date.parse(modified) : null
            });
        };

        const tasks = [];
        for (const entry of await listDirectory(SCENE_DIR)) {
            const name = entry.base.replace(/\/$/, '');
            if (entry.type === 'folder' || entry.type === 'directory') {
                // an unbundled SOG is a folder holding meta.json (lod-meta.json for streamed LOD)
                tasks.push(listDirectory(encodePath(SCENE_DIR, name) + '/').then((inner) => {
                    const names = inner.map((e) => e.base);
                    const meta = names.includes('lod-meta.json') ? 'lod-meta.json'
                        : names.includes('meta.json') ? 'meta.json' : null;
                    if (meta) addFormat(name, 'sog_folder', encodePath(SCENE_DIR, name) + '/' + meta, `${name}/${meta}`);
                }).catch(() => {}));
                continue;
            }
            const c = classify(name);
            if (!c) continue;
            if (c.kind === 'converting') { scene(c.stem).converting = true; continue; }
            if (c.kind === 'failed') { scene(c.stem).failed = true; continue; }
            if (c.kind === 'info') {
                tasks.push(textFile(encodePath(SCENE_DIR, name)).then((text) => {
                    const s = scene(c.stem);
                    s.info = parseInfo(text);
                    if (s.info.title) s.title = s.info.title;
                }));
            } else if (KINDS[c.kind]) {
                addFormat(c.stem, c.kind, encodePath(SCENE_DIR, name), name, entry.size, entry.bytes, entry.modified);
            }
        }

        await Promise.all(tasks);

        const list = [...scenes.values()].filter((s) => s.formats.length > 0);
        for (const s of list) {
            s.formats.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
            s.primary = s.formats[0];
            s.options = s.formats.slice(1);
            // a .sog older than its .ply is probably a copy of an earlier version of the scene
            const ply = s.formats.find((f) => f.kind === 'ply');
            const sog = s.formats.find((f) => f.kind === 'sog');
            s.staleSog = Boolean(ply && sog && ply.modified && sog.modified && sog.modified < ply.modified);
        }
        list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
        return list;
    };

    // Backend choice for the links: 'webgpu' (default) or 'webgl'. The viewer never falls back, so
    // the flag in the address is the whole decision. The list page stores the choice per browser.
    const BACKEND_KEY = 'viewer_backend';
    const currentBackend = () => {
        try {
            return localStorage.getItem(BACKEND_KEY) === 'webgl' ? 'webgl' : 'webgpu';
        } catch (err) {
            return 'webgpu';
        }
    };
    const setBackend = (backend) => {
        try {
            localStorage.setItem(BACKEND_KEY, backend === 'webgl' ? 'webgl' : 'webgpu');
        } catch (err) {
            // storage unavailable: the choice just does not persist
        }
    };

    // The viewer page for one format on the given backend. The content path is already
    // percent-encoded, so encode it once more as a query value.
    const viewerUrl = (format, backend = currentBackend()) =>
        `/viewer/index.html?${backend === 'webgl' ? 'webgl&' : ''}content=${encodeURIComponent(format.url)}`;

    window.sceneCatalog = { load, viewerUrl, currentBackend, setBackend, LARGE_RAW_BYTES, SCENE_DIR };
})();
