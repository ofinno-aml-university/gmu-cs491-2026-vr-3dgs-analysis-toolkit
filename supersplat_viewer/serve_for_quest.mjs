#!/usr/bin/env node
// Serves the scene list, the SuperSplat viewer and the 3DGS_scenes folder to devices on the local
// network. Plain Node with no dependencies; works the same on macOS, Windows and Linux.
//
//   node serve_for_quest.mjs          (Ctrl-C stops it)
//
//   HTTPS on port 3443 : self-signed certificate from tls_self_signed/; required for VR on the
//                        Quest (WebXR only works on a secure origin)
//   HTTP  on port 3080 : plain; fine for non-VR viewing and local testing
//
// URL                      served from
//   /                      viewer_site/index.html           (the scene list)
//   /scene_catalog.js      viewer_site/
//   /viewer/...            viewer_site/viewer/              (generated page, drop-down, settings)
//                          then supersplat-viewer/public/   (the built viewer: index.js, index.css)
//   /3DGS_scenes/...       3DGS_scenes/                     (a folder URL returns a JSON listing)
//   /3DGS_scenes_converted/...   3DGS_scenes_converted/     (same)
//   /certificate/          a page to install the HTTPS certificate on Apple devices (see README)
//   POST /convert          {"name": "Kitty.ply"}: make a SOG copy of that scene (the "Make SOG copy"
//                          button); runs convert_scenes_to_sog.mjs for one file at a time
//
// Scenes are served as-is. Windows: on the first start Windows Defender Firewall asks whether
// Node may accept connections; allow it for private networks or the Quest cannot connect.
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, promises as fs } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { generateViewerPage } from './generate_viewer_page.mjs';

const HTTPS_PORT = 3443;
const HTTP_PORT = 3080;

const root = path.dirname(fileURLToPath(import.meta.url));
const sceneDir = path.join(root, '3DGS_scenes');
const convertedDir = path.join(root, '3DGS_scenes_converted');
const tlsDir = path.join(root, 'tls_self_signed');

// URL prefix -> folders searched in order. The longest matching prefix wins.
const mounts = [
    { prefix: '/viewer/', roots: [path.join(root, 'viewer_site', 'viewer'), path.join(root, 'supersplat-viewer', 'public')], listing: false },
    { prefix: '/3DGS_scenes/', roots: [sceneDir], listing: true },
    { prefix: '/3DGS_scenes_converted/', roots: [convertedDir], listing: true },
    { prefix: '/', roots: [path.join(root, 'viewer_site')], listing: false }
];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
    '.ply': 'application/octet-stream',
    '.sog': 'application/octet-stream',
    '.spz': 'application/octet-stream'
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.txt', '.md', '.svg']);

const formatSize = (n) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let power = 0;
    while (n >= 1024 && power < units.length - 1) { n /= 1024; power += 1; }
    return `${n.toFixed(0)} ${units[power]}`;
};

const send = (response, statusCode, text, extraHeaders = {}) => {
    response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...extraHeaders });
    response.end(text);
};

// JSON listing of one folder (the shape scene_catalog.js reads: base, type, size text, bytes)
const listDirectory = async (dir, urlPath) => {
    const names = await fs.readdir(dir);
    const files = [];
    for (const name of names) {
        if (name.startsWith('.')) continue;
        let stat;
        try { stat = await fs.stat(path.join(dir, name)); } catch (err) { continue; }
        files.push(stat.isDirectory()
            ? { base: `${name}/`, type: 'folder' }
            : { base: name, type: 'file', size: formatSize(stat.size), bytes: stat.size, modified: stat.mtime.toISOString() });
    }
    files.sort((a, b) => a.base.localeCompare(b.base, undefined, { sensitivity: 'base' }));
    return JSON.stringify({ directory: urlPath, files });
};

const sendFile = (request, response, filePath, stat) => {
    const ext = path.extname(filePath).toLowerCase();
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'ETag': etag,
        'Last-Modified': stat.mtime.toUTCString()
    };
    if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, headers);
        response.end();
        return;
    }
    const gzip = COMPRESSIBLE.has(ext) && stat.size > 1024 && /\bgzip\b/.test(request.headers['accept-encoding'] || '');
    if (gzip) {
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
    } else {
        headers['Content-Length'] = stat.size;
    }
    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
        response.end();
        return;
    }
    const stream = createReadStream(filePath);
    stream.on('error', () => response.destroy());
    if (gzip) stream.pipe(createGzip()).pipe(response);
    else stream.pipe(response);
};

// Apple devices refuse WebXR and show warnings on a self-signed certificate unless it is installed
// and trusted once; /certificate/ serves the public certificate (never the key) with the steps.
let certificateDer = null;
const CERT_FILE = 'supersplat_viewer_local.crt';
const certificatePage = (host) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install the certificate</title><style>body{font:18px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:700px;margin:0 auto;padding:24px 16px;background:#101114;color:#e8e8e8}
a.button{display:inline-block;padding:12px 20px;border-radius:10px;background:#f26722;color:#fff;font-weight:600;text-decoration:none}code{background:#23262c;padding:1px 6px;border-radius:6px}ol li{margin-bottom:8px}</style></head><body>
<h1>Install the certificate (Apple devices)</h1>
<p>This server uses a self-signed HTTPS certificate. Chrome-based browsers (Meta Quest) let you click through the warning. Safari on Vision Pro, iPhone and iPad needs the certificate installed and trusted once; after that the <code>https</code> address opens without any warning.</p>
<p><a class="button" href="/certificate/${CERT_FILE}">Download certificate</a></p>
<ol>
<li>Safari asks to allow a configuration profile download: choose <b>Allow</b>.</li>
<li>Open <b>Settings → General → VPN &amp; Device Management</b> (on Vision Pro: Settings → General → Device Management), select the downloaded profile <i>supersplat-viewer-local</i> and choose <b>Install</b>.</li>
<li>Open <b>Settings → General → About → Certificate Trust Settings</b> and turn on full trust for <i>supersplat-viewer-local</i>.</li>
<li>Open <a href="https://${host}:${HTTPS_PORT}/"><code>https://${host}:${HTTPS_PORT}/</code></a> (this link).</li>
</ol>
<p>Do this from the plain <code>http://</code> address (port 3080) if the <code>https</code> one is blocked. The certificate covers the server's current network addresses; if the computer's address changes, run <code>node make_certificate.mjs</code>, restart the server and install the new certificate the same way.</p>
</body></html>`;

// "Make SOG copy" requests, one conversion at a time; each runs the converter script for one file
const converterScript = path.join(root, 'convert_scenes_to_sog.mjs');
const conversionQueue = [];
let conversionRunning = null;

const runNextConversion = () => {
    if (conversionRunning || conversionQueue.length === 0) return;
    const name = conversionQueue.shift();
    conversionRunning = name;
    console.log(`${new Date().toLocaleTimeString()}  converting ${name} -> SOG (log: 3DGS_scenes_converted/conversion.log)`);
    const child = spawn(process.execPath, [converterScript, '--file', name], { stdio: 'ignore' });
    const finish = (text) => {
        console.log(`${new Date().toLocaleTimeString()}  ${name}: ${text}`);
        conversionRunning = null;
        runNextConversion();
    };
    child.on('error', (err) => finish(`could not start the converter: ${err.message}`));
    child.on('exit', (code) => finish(code === 0 ? 'SOG copy ready' : `conversion FAILED (status ${code})`));
};

const requestConversion = async (name) => {
    const lower = typeof name === 'string' ? name.toLowerCase() : '';
    if (!lower.endsWith('.ply') || lower.endsWith('.compressed.ply') || /[\\/]/.test(name) || name.startsWith('.')) {
        return { code: 400, body: { error: 'not a convertible .ply file name' } };
    }
    let plyStat;
    try {
        plyStat = await fs.stat(path.join(sceneDir, name));
    } catch (err) {
        return { code: 404, body: { error: 'no such file in 3DGS_scenes' } };
    }
    if (!plyStat.isFile()) return { code: 404, body: { error: 'no such file in 3DGS_scenes' } };
    const stem = name.slice(0, -4);
    try {
        const sogStat = await fs.stat(path.join(convertedDir, `${stem}.sog`));
        if (sogStat.mtimeMs >= plyStat.mtimeMs) return { code: 200, body: { status: 'exists' } };
    } catch (err) {
        // no copy yet
    }
    if (conversionRunning === name || conversionQueue.includes(name)) return { code: 202, body: { status: 'running' } };
    mkdirSync(convertedDir, { recursive: true });
    await fs.rm(path.join(convertedDir, `${stem}.failed.txt`), { force: true }); // an explicit request retries
    await fs.writeFile(path.join(convertedDir, `${stem}.converting`), '');   // shown on the list while queued
    const startsNow = !conversionRunning;
    conversionQueue.push(name);
    runNextConversion();
    return { code: 202, body: { status: startsNow ? 'started' : 'queued' } };
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
        data += chunk;
        if (data.length > 10_000) {
            reject(new Error('request body too large'));
            request.destroy();
        }
    });
    request.on('end', () => {
        try {
            resolve(data ? JSON.parse(data) : {});
        } catch (err) {
            reject(new Error('request body is not JSON'));
        }
    });
    request.on('error', reject);
});

const handle = async (request, response) => {
    if (request.method === 'POST') {
        const postPath = new URL(request.url, 'http://localhost').pathname;
        if (postPath !== '/convert') return send(response, 404, 'not found');
        let body;
        try {
            body = await readJsonBody(request);
        } catch (err) {
            return send(response, 400, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json; charset=utf-8' });
        }
        const result = await requestConversion(body.name);
        return send(response, result.code, JSON.stringify(result.body), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'method not allowed');

    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch (err) {
        return send(response, 400, 'bad request');
    }
    const segments = pathname.split('/');
    if (pathname.includes('\\') || pathname.includes('\0') || segments.some((s) => s === '..' || s === '.')) {
        return send(response, 400, 'bad request');
    }
    if (segments.some((s) => s.startsWith('.'))) return send(response, 404, 'not found');

    if (pathname === '/server_info.json') {
        return send(response, 200, JSON.stringify({ httpsPort: HTTPS_PORT, httpPort: HTTP_PORT }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    if (pathname === '/certificate') return send(response, 301, '', { Location: '/certificate/' });
    if (pathname === '/certificate/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return response.end(request.method === 'HEAD' ? undefined : certificatePage((request.headers.host || 'localhost').replace(/:\d+$/, '')));
    }
    if (pathname === `/certificate/${CERT_FILE}` && certificateDer) {
        response.writeHead(200, {
            'Content-Type': 'application/x-x509-ca-cert',
            'Content-Disposition': `attachment; filename="${CERT_FILE}"`,
            'Content-Length': certificateDer.length,
            'Cache-Control': 'no-cache'
        });
        return response.end(request.method === 'HEAD' ? undefined : certificateDer);
    }

    // a mount's folder requested without the trailing slash: redirect so relative links work
    const bare = mounts.find((m) => m.prefix !== '/' && pathname === m.prefix.slice(0, -1));
    if (bare) return send(response, 301, '', { Location: bare.prefix });

    const mount = mounts.find((m) => pathname.startsWith(m.prefix)); // mounts are ordered longest first
    const relative = pathname.slice(mount.prefix.length);

    for (const mountRoot of mount.roots) {
        const filePath = path.join(mountRoot, ...relative.split('/'));
        if (!filePath.startsWith(mountRoot)) return send(response, 400, 'bad request');
        let stat;
        try {
            stat = await fs.stat(filePath);
        } catch (err) {
            continue; // not in this root; try the next one
        }
        if (stat.isDirectory()) {
            if (!pathname.endsWith('/')) return send(response, 301, '', { Location: `${pathname}/` });
            const indexPath = path.join(filePath, 'index.html');
            try {
                const indexStat = await fs.stat(indexPath);
                return sendFile(request, response, indexPath, indexStat);
            } catch (err) {
                // no index page here
            }
            if (mount.listing) {
                const body = await listDirectory(filePath, pathname);
                response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
                return response.end(request.method === 'HEAD' ? undefined : body);
            }
            continue;
        }
        return sendFile(request, response, filePath, stat);
    }
    send(response, 404, 'not found');
};

const seenClients = new Set();
const requestListener = (request, response) => {
    const started = Date.now();
    const from = request.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '?';
    if (!seenClients.has(from)) {
        seenClients.add(from);
        console.log(`new device ${from}: ${request.headers['user-agent'] || '(no user agent)'}`);
    }
    response.on('finish', () => {
        console.log(`${new Date().toLocaleTimeString()}  ${from}  ${request.method} ${request.url}  ${response.statusCode}  ${Date.now() - started} ms`);
    });
    handle(request, response).catch((err) => {
        console.error(`error handling ${request.url}:`, err.message);
        if (!response.headersSent) send(response, 500, 'server error');
        else response.destroy();
    });
};

// adapters of virtual machines, containers, VPNs and the like: listed separately, since a
// headset on the Wi-Fi cannot reach them (Parallels: bridge100/101, VMware: vmnet, Hyper-V and
// WSL: vEthernet, VirtualBox host-only, Docker, VPN tunnels)
const VIRTUAL_ADAPTER = /^(bridge|vmnet|utun|awdl|llw|anpi|docker|veth|br-|virbr|lxc|tailscale|zt)|vethernet|virtualbox|vmware|hyper-v|wsl|tap|tun/i;

const lanAddresses = () => {
    const physical = [];
    const virtual = [];
    for (const [name, entries] of Object.entries(networkInterfaces())) {
        for (const entry of entries || []) {
            if (entry.family !== 'IPv4' || entry.internal) continue;
            (VIRTUAL_ADAPTER.test(name) ? virtual : physical).push({ name, address: entry.address });
        }
    }
    return { physical, virtual };
};

const listen = (server, port, label) => new Promise((resolve, reject) => {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            reject(new Error(`port ${port} (${label}) is already in use: another program, or a previous run of this script. Stop it, or change ${label === 'https' ? 'HTTPS_PORT' : 'HTTP_PORT'} at the top of serve_for_quest.mjs`));
        } else if (err.code === 'EACCES') {
            reject(new Error(`port ${port} (${label}) is not allowed on this machine (permission or a reserved port range); change the port at the top of serve_for_quest.mjs`));
        } else {
            reject(err);
        }
    });
    server.listen(port, '0.0.0.0', () => resolve(server));
});

const main = async () => {
    if (!existsSync(path.join(root, 'supersplat-viewer', 'public', 'index.js'))) {
        throw new Error('viewer build missing: run "npm install" and "npm run build" inside supersplat-viewer/ first');
    }
    const keyPath = path.join(tlsDir, 'server_key.pem');
    const certPath = path.join(tlsDir, 'server_cert.pem');
    if (!existsSync(keyPath) || !existsSync(certPath)) {
        throw new Error('HTTPS certificate missing. Create one with:  node make_certificate.mjs');
    }
    const certificate = new X509Certificate(readFileSync(certPath));
    certificateDer = certificate.raw;
    const daysLeft = (new Date(certificate.validTo) - Date.now()) / 86_400_000;
    if (daysLeft < 0) {
        console.warn(`WARNING: the HTTPS certificate expired on ${certificate.validTo}. Run: node make_certificate.mjs`);
    } else if (daysLeft < 30) {
        console.warn(`WARNING: the HTTPS certificate expires in ${Math.ceil(daysLeft)} days (${certificate.validTo}). Run: node make_certificate.mjs`);
    }
    mkdirSync(sceneDir, { recursive: true });
    if (existsSync(convertedDir)) {
        for (const name of await fs.readdir(convertedDir)) {
            if (name.endsWith('.converting') || name.endsWith('.tmp.sog')) await fs.rm(path.join(convertedDir, name), { force: true });
        }
    }

    // the viewer page is regenerated from the current build at every start
    await generateViewerPage(root);

    const httpsServer = createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, requestListener);
    // a browser that rejects the certificate closes the connection during the handshake; log why
    httpsServer.on('tlsClientError', (err, socket) => {
        const from = (socket.remoteAddress ?? socket._parent?.remoteAddress ?? '?').replace(/^::ffff:/, '');
        console.log(`${new Date().toLocaleTimeString()}  ${from}  TLS handshake failed: ${err.code || ''} ${err.message}`);
    });
    // Port 3443 also accepts plain http (an address typed without "https://") and redirects it.
    // A TLS handshake starts with byte 0x16; anything else is treated as plain http.
    const redirectToHttps = createHttpServer((request, response) => {
        const host = (request.headers.host || 'localhost').replace(/:\d+$/, '');
        response.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${request.url}` });
        response.end();
    });
    const tlsPort = createNetServer((socket) => {
        socket.on('error', () => {});
        socket.once('data', (chunk) => {
            socket.pause();
            socket.unshift(chunk);
            (chunk[0] === 0x16 ? httpsServer : redirectToHttps).emit('connection', socket);
            process.nextTick(() => socket.resume());
        });
    });
    const https = await listen(tlsPort, HTTPS_PORT, 'https');
    const http = await listen(createHttpServer(requestListener), HTTP_PORT, 'http');

    const { physical, virtual } = lanAddresses();
    console.log('\nOpen one of these on the Quest (same Wi-Fi network):');
    for (const { name, address } of physical) {
        console.log(`  https://${address}:${HTTPS_PORT}/    (VR-capable, via ${name})`);
        console.log(`  http://${address}:${HTTP_PORT}/     (no VR,      via ${name})`);
    }
    if (physical.length === 0) console.log('  (no network adapter with an IPv4 address found; is Wi-Fi on?)');
    if (virtual.length > 0) {
        console.log(`  Ignore these virtual adapters (VM/VPN), not reachable from the Quest: ${virtual.map((v) => `${v.address} via ${v.name}`).join(', ')}`);
    }
    console.log('The HTTPS certificate is self-signed: on the Quest choose Advanced -> Proceed on the first visit.');
    console.log(`Apple devices (Vision Pro, iPhone): install it once via http://<address>:${HTTP_PORT}/certificate/`);
    console.log(`Scenes: drop .ply files into ${sceneDir} and reload the page. Ctrl-C stops the server.\n`);

    const shutdown = () => {
        console.log('\nstopping');
        https.close();
        http.close();
        setTimeout(() => process.exit(0), 200).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
};

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
