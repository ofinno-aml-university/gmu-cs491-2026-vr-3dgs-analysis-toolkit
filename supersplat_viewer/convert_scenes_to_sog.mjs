#!/usr/bin/env node
// Converts .ply files in 3DGS_scenes/ to .sog files in the same folder (kitty.ply -> kitty.sog)
// using PlayCanvas splat-transform (installed in scene_tools/). SOG is roughly 10x smaller than a
// raw PLY and much cheaper for the Quest to load. The raw file is left untouched. Plain Node;
// works the same on macOS, Windows and Linux.
//
//   node convert_scenes_to_sog.mjs                 convert every PLY that has no .sog yet, then exit
//   node convert_scenes_to_sog.mjs --watch         keep checking every 30 s for new files
//   node convert_scenes_to_sog.mjs --file kitty.ply [--force]
//                                                  convert one file (used by the "Make SOG copy"
//                                                  button on the scene list, via serve_for_quest.mjs);
//                                                  --force replaces an existing kitty.sog
//
// An existing .sog is never overwritten except with --force, so a .sog someone drops into the
// folder themselves is safe. This is optional and never runs on its own: the raw PLY stays the
// default in the scene list, and a .sog only appears there as an extra button. SOG is lossy
// (quantized positions, scales and rotations; palettized spherical harmonics), so do not use it
// for compression experiments.
//
// While a file converts, <name>.converting exists next to it; a failure leaves <name>.failed.txt
// with the error. The scene list shows both states. Progress is logged to conversion.log next to
// this script. Smallest files go first, and a file modified less than a minute ago is left for the
// next pass (it may still be copying).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLL_MS = 30_000;
const SETTLE_MS = 60_000;

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(root, '3DGS_scenes');
const outputDir = sourceDir; // copies live next to their PLY
const logFile = path.join(root, 'conversion.log');

// the converter's entry script, run with this same Node (no shell shims, so it works on Windows)
const resolveConverter = () => {
    const packageDir = path.join(root, 'scene_tools', 'node_modules', '@playcanvas', 'splat-transform');
    const packageJson = path.join(packageDir, 'package.json');
    if (!existsSync(packageJson)) {
        throw new Error('splat-transform not found: run "npm install" inside scene_tools/ first');
    }
    const { bin } = JSON.parse(readFileSync(packageJson, 'utf8'));
    return path.join(packageDir, typeof bin === 'string' ? bin : bin['splat-transform']);
};

const formatSize = (n) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let power = 0;
    while (n >= 1024 && power < units.length - 1) { n /= 1024; power += 1; }
    return `${n.toFixed(power ? 1 : 0)} ${units[power]}`;
};

const timestamp = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const log = (line) => {
    const text = `${timestamp()}  ${line}`;
    console.log(text);
    appendFileSync(logFile, `${text}\n`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let current = null; // { child, tmp, marker } while a conversion runs
const abort = () => {
    if (current) {
        current.child.kill();
        rmSync(current.tmp, { force: true });
        rmSync(current.marker, { force: true });
    }
    process.exit(130);
};
process.on('SIGINT', abort);
process.on('SIGTERM', abort);

const convertOne = (converter, ply, force = false) => new Promise((resolve) => {
    const stem = path.basename(ply, '.ply');
    const sog = path.join(outputDir, `${stem}.sog`);
    const marker = path.join(outputDir, `${stem}.converting`);
    const failed = path.join(outputDir, `${stem}.failed.txt`);
    const tmp = path.join(outputDir, `${stem}.tmp.sog`);
    const plyTime = statSync(ply).mtimeMs;

    // never overwrite an existing .sog (it may be someone's own file) unless explicitly forced;
    // a previous failure on this same version of the PLY is not retried without --force either
    if (existsSync(sog) && !force) return resolve('skipped');
    if (existsSync(failed) && plyTime <= statSync(failed).mtimeMs && !force) return resolve('skipped');
    rmSync(failed, { force: true });

    log(`converting  ${stem}   (raw ${formatSize(statSync(ply).size)})`);
    writeFileSync(marker, '');
    const started = Date.now();
    const logFd = openSync(logFile, 'a');
    const child = spawn(process.execPath, [converter, '-w', '-q', ply, tmp], { stdio: ['ignore', logFd, logFd] });
    current = { child, tmp, marker };
    child.on('exit', (code) => {
        closeSync(logFd);
        current = null;
        // resolves 'done' or 'failed' (and 'skipped' above when nothing needed doing)
        const ok = code === 0 && existsSync(tmp) && statSync(tmp).size > 0;
        if (ok) {
            renameSync(tmp, sog);
            rmSync(failed, { force: true });
            log(`done        ${stem}   -> ${formatSize(statSync(sog).size)} in ${Math.round((Date.now() - started) / 1000)} s`);
        } else {
            rmSync(tmp, { force: true });
            writeFileSync(failed, `splat-transform exited with status ${code}; see conversion.log\n`);
            log(`FAILED      ${stem}   (status ${code})`);
        }
        rmSync(marker, { force: true });
        resolve(ok ? 'done' : 'failed');
    });
});

// a file that is still being copied in grows; wait until its size has not changed for 2 s
const waitUntilStable = async (file) => {
    let previous = -1;
    for (let i = 0; i < 60; i += 1) {
        const size = statSync(file).size;
        if (size === previous) return;
        previous = size;
        await sleep(2000);
    }
};

const runPass = async (converter) => {
    const now = Date.now();
    const candidates = readdirSync(sourceDir)
        .filter((name) => name.toLowerCase().endsWith('.ply') && !name.toLowerCase().endsWith('.compressed.ply'))
        .map((name) => ({ file: path.join(sourceDir, name), stat: statSync(path.join(sourceDir, name)) }))
        .filter(({ stat }) => stat.isFile() && now - stat.mtimeMs > SETTLE_MS)
        .sort((a, b) => a.stat.size - b.stat.size);
    for (const { file } of candidates) await convertOne(converter, file);
};

const main = async () => {
    const converter = resolveConverter();
    if (!existsSync(sourceDir)) throw new Error(`scene folder missing: ${sourceDir}`);
    mkdirSync(outputDir, { recursive: true });

    const fileIndex = process.argv.indexOf('--file');
    if (fileIndex !== -1) {
        const name = process.argv[fileIndex + 1];
        const ply = name && path.join(sourceDir, path.basename(name));
        if (!ply || !existsSync(ply) || !ply.toLowerCase().endsWith('.ply')) throw new Error(`no such .ply in 3DGS_scenes: ${name}`);
        await waitUntilStable(ply);
        const result = await convertOne(converter, ply, process.argv.includes('--force'));
        process.exit(result === 'failed' ? 1 : 0);
    }

    // leftovers from an interrupted run
    for (const name of readdirSync(outputDir)) {
        if (name.endsWith('.tmp.sog') || name.endsWith('.converting')) rmSync(path.join(outputDir, name), { force: true });
    }
    if (process.argv.includes('--watch')) {
        log(`watching ${sourceDir} (every ${POLL_MS / 1000} s)`);
        for (;;) {
            await runPass(converter);
            await sleep(POLL_MS);
        }
    } else {
        await runPass(converter);
    }
};

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
