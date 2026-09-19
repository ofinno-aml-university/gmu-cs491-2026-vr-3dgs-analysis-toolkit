#!/usr/bin/env node
// Creates (or replaces) the self-signed HTTPS certificate in tls_self_signed/. Needs the `openssl`
// command: present on macOS and Linux, and on Windows inside Git for Windows.
//
//   node make_certificate.mjs
//
// Apple devices (Vision Pro, iPhone, iPad, Safari on Mac) only accept a server certificate whose
// validity is at most 825 days and which carries a subjectAltName and the serverAuth extended key
// usage, so those are set here. The current network addresses go into the subjectAltName. Devices
// that accepted the previous certificate will show their warning once more after this runs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(root, 'tls_self_signed');
const keyPath = path.join(dir, 'server_key.pem');
const certPath = path.join(dir, 'server_cert.pem');
const VALID_DAYS = 820; // Apple's limit is 825

const findOpenssl = () => {
    const candidates = ['openssl'];
    if (process.platform === 'win32') {
        candidates.push('C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe');
    }
    for (const candidate of candidates) {
        const probe = spawnSync(candidate, ['version'], { encoding: 'utf8' });
        if (!probe.error && probe.status === 0) return candidate;
    }
    throw new Error('openssl not found. macOS/Linux: install it with your package manager. Windows: install Git for Windows (https://git-scm.com), which includes openssl.');
};

const addresses = new Set(['127.0.0.1']);
for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) addresses.add(entry.address);
    }
}
const host = hostname().replace(/\.local$/i, '');
const names = new Set(['localhost', host, `${host}.local`]);
const subjectAltName = [...[...addresses].map((a) => `IP:${a}`), ...[...names].map((n) => `DNS:${n}`)].join(',');

const openssl = findOpenssl();
mkdirSync(dir, { recursive: true });
const result = spawnSync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', String(VALID_DAYS), '-nodes',
    '-keyout', keyPath, '-out', certPath,
    '-subj', '/CN=supersplat-viewer-local',
    '-addext', `subjectAltName=${subjectAltName}`,
    '-addext', 'extendedKeyUsage=serverAuth',
    '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
    '-addext', 'basicConstraints=critical,CA:TRUE'
], { encoding: 'utf8' });
if (result.status !== 0) {
    console.error(result.stderr || result.error?.message || 'openssl failed');
    process.exit(1);
}
console.log(`wrote ${certPath} and ${keyPath}`);
console.log(`valid ${VALID_DAYS} days; subjectAltName = ${subjectAltName}`);
console.log('Restart serve_for_quest.mjs to use it. Devices that accepted the old certificate will ask once more.');
