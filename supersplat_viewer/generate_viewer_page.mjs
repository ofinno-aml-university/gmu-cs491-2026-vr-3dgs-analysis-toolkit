#!/usr/bin/env node
// Regenerates viewer_site/viewer/index.html from the built viewer package (supersplat-viewer/dist),
// adding the scene drop-down (viewer_site/viewer/scene_switcher.js) through the package's own
// renderViewerHtml API, so the viewer source stays unmodified.
// serve_for_quest.mjs runs this at every start; run it by hand after editing supersplat-viewer/src/index.html:
//   node generate_viewer_page.mjs
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function generateViewerPage(root) {
    const modulePath = join(root, 'supersplat-viewer', 'dist', 'index.js');
    if (!existsSync(modulePath)) {
        throw new Error('viewer not built: run "npm run build" inside supersplat-viewer/ first');
    }
    const { renderViewerHtml } = await import(pathToFileURL(modulePath).href);
    const html = renderViewerHtml({
        headExtras: [
            '<script defer src="/scene_catalog.js"></script>',
            '<script defer src="./scene_switcher.js"></script>'
        ].join('\n')
    });
    const outputPath = join(root, 'viewer_site', 'viewer', 'index.html');
    writeFileSync(outputPath, html);
    return outputPath;
}

// run directly: `node generate_viewer_page.mjs`
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const root = dirname(fileURLToPath(import.meta.url));
    generateViewerPage(root)
        .then((outputPath) => console.log(`wrote ${outputPath}`))
        .catch((err) => { console.error(err.message); process.exit(1); });
}
