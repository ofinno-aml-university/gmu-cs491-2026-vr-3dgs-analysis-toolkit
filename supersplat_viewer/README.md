# SuperSplat viewer on the Meta Quest — student guide

This folder serves 3D Gaussian Splatting (3DGS) scenes from the `3DGS_scenes` folder to the
SuperSplat viewer, opened in the Quest's browser over the local Wi-Fi network. Scenes are shown
from their raw PLY files by default. Only one scene is ever loaded at a time. Everything runs on
Node.js and works the same on macOS, Windows and Linux.

## Setup (once per computer)

1. Install Node.js 20 or newer (https://nodejs.org).
2. In a terminal (macOS Terminal, or PowerShell / Command Prompt on Windows), inside this folder:

       cd supersplat-viewer
       npm install
       npm run build
       cd ../scene_tools
       npm install
       cd ..
       node make_certificate.mjs

   The second `npm install` is only needed for the optional SOG conversion. The last command
   creates the HTTPS certificate in `tls_self_signed/` (it needs `openssl`, which macOS and Git for
   Windows include); the certificate is specific to each computer and is not in the repository.

## Quick start

1. In this folder run:

       node serve_for_quest.mjs

   It prints the address to use, for example `https://192.168.148.31:3443/`. The address can change
   when the computer reconnects to the network, so always read it from the printout.
   Windows: on the first start, Windows Defender Firewall asks whether Node may accept
   connections. Allow it for private networks, or the Quest cannot connect.
2. Put the Quest on the same Wi-Fi network and open that address in the Quest browser.
   The browser warns that the certificate is not trusted (it is self-signed): choose
   **Advanced → Proceed**.
3. The page lists every scene in `3DGS_scenes`. Press **Open PLY** on one of them.
4. In the viewer, the **VR** button is in the bottom toolbar. To change scene, use the drop-down in
   the top-right corner of the viewer, or choose **⌂ All scenes** in it to get back to the list.
5. Ctrl-C in the terminal stops the server.

Plain `http://<address>:3080/` also works for non-VR viewing on any device, but the VR button only
appears on the `https` address (WebXR requires a secure origin).

### Choosing the backend (WebGPU or WebGL2)

The backend is an explicit choice and the viewer never falls back from one to the other, in 2D
or in VR. WebGPU is the default; `?webgl` in the viewer address chooses WebGL2. If the chosen
backend is unavailable the viewer refuses to start and says why on the page. The **Backend**
switch on the scene list applies the choice to every link and is remembered per browser; inside
the viewer, the scene drop-down keeps the current backend and has a "Reload this scene on ..."
entry for the other one. The badge under the drop-down shows the device actually in use (green
for WebGPU, amber for WebGL2), the splat sort path (GPU sort on WebGPU, CPU sort worker on
WebGL2), and whether a VR session can start on that device. Use it to A/B the two backends: same
scene, same format, same performance-mode setting, one backend at a time.

### Apple Vision Pro, iPhone, iPad

Safari does not offer a reliable way past the certificate warning, and it also refuses a
certificate that is valid for more than 825 days or lacks the `serverAuth` extended key usage
(`make_certificate.mjs` creates one that meets these rules). Install the certificate once:

1. On the device, open `http://<address>:3080/certificate/` (the plain `http` address) and press
   **Download certificate**; allow the profile download.
2. Settings → General → VPN & Device Management (Vision Pro: Settings → General → Device
   Management) → install the *supersplat-viewer-local* profile.
3. Settings → General → About → Certificate Trust Settings → turn on full trust for it.
4. Open the `https` address. No warning should appear, and the VR button works.

If the device never reaches the server at all (nothing appears in the server's terminal when you
open the address), Safari was denied local-network access: Settings → Privacy & Security →
Local Network → turn on Safari. The certificate contains the computer's network addresses; when
they change, run `node make_certificate.mjs`, restart the server and install the new certificate.

## Adding scenes

Drop a `.ply` file into `3DGS_scenes` (spaces in names are fine) and press **Reload list** on the
page. `.compressed.ply` and `.sog` files work too. A text file with the same name, for example
`Kitty.txt` next to `Kitty.ply`, is shown as the caption; use lines like

    Title: Kitty
    Author: ...
    License: ...
    Source: https://...

Each scene opens in a fresh page, so the previous scene is unloaded before the next one starts.

## Large scenes and the optional SOG copy

A raw PLY holds 248 bytes per Gaussian (with three bands of spherical harmonics), so files of
several hundred MB are common. The Quest browser has limited memory, and the list flags raw PLYs
above 250 MB. If a scene fails to load on the Quest, make a compact copy of it: press
**Make SOG copy** on that scene in the list. The computer running the server converts the file
(seconds to a minute; a 1.16 GB PLY took 53 s on a MacBook Pro), the row shows "converting…"
meanwhile, and an **Open SOG** button appears when it is done. Copies land in
`3DGS_scenes_converted/<name>.sog`, roughly 10 to 20 times smaller than the PLY. To convert every
scene at once instead, run this on the serving computer:

    node convert_scenes_to_sog.mjs

(`--watch` keeps it running and converts new files as they appear.) SOG is a lossy format
(quantized positions, scales and rotations, palettized spherical harmonics), so keep using the PLY
for anything related to compression work. Nothing is converted unless someone asks for it, one
file at a time. If a conversion fails, the row says so and offers **Retry SOG copy**; the reason is
in `3DGS_scenes_converted/conversion.log`. The converted folder can be deleted at any time.

## Folder layout

    3DGS_scenes/               scenes you drop in (served as-is; provided separately, never committed)
    3DGS_scenes_converted/     optional SOG copies made by convert_scenes_to_sog.mjs (not committed)
    supersplat-viewer/         the viewer's source: release v1.31.2 (commit 96f6251) of
                               https://github.com/playcanvas/supersplat-viewer, changed only so
                               the backend is explicit with no fallback (index.ts, index.html,
                               xr.ts, ui.ts)
    viewer_site/               the web pages around the viewer:
        index.html                 scene list page
        scene_catalog.js           reads the folder listing (shared by the list and the drop-down)
        viewer/index.html          generated viewer page (do not edit; see below)
        viewer/scene_switcher.js   the scene drop-down inside the viewer
        viewer/settings.json       viewer settings (no fixed camera: the scene is auto-framed)
    serve_for_quest.mjs        the web server (HTTPS 3443, HTTP 3080); plain Node, no dependencies
    convert_scenes_to_sog.mjs  optional PLY -> SOG conversion
    generate_viewer_page.mjs   rebuilds viewer/index.html from the built viewer (run by the server)
    make_certificate.mjs       creates the self-signed HTTPS certificate (820 days; rerun when expired)
    tls_self_signed/           the HTTPS certificate and key, made by make_certificate.mjs (not committed)
    scene_tools/               npm package holding the converter (splat-transform)

The server maps URLs to folders directly (`/viewer/` is served from `viewer_site/viewer/` and then
from `supersplat-viewer/public/`; `/3DGS_scenes/` from `3DGS_scenes/`), so there are no symlinks
or copies to keep in sync. The ports are two constants at the top of `serve_for_quest.mjs`.

## Working on the viewer code

The viewer is the `supersplat-viewer` release with one local change (explicit backend, no
fallback); the scene list and drop-down live outside it. To change the viewer:

    cd supersplat-viewer
    npm run build        # or: npm run watch   (rebuilds on every save)

Reload the page on the Quest afterwards; the server reads the build output directly. If you edit
`supersplat-viewer/src/index.html` itself, restart `serve_for_quest.mjs` (or run
`node generate_viewer_page.mjs`) to regenerate the viewer page.

A scene can also be opened directly, without the list:

    https://<address>:3443/viewer/index.html?content=/3DGS_scenes/Kitty.ply

The viewer's other URL parameters (`ministats`, `noanim`, `noui`, ...) are listed in
`supersplat-viewer/README.md`.

## Troubleshooting

- **"port 3443 is already in use"**: another program holds the port, or a previous run of the
  server is still open in another terminal. Close it, or change the port constants at the top of
  `serve_for_quest.mjs`. (The SuperSplat *editor* dev server uses port 3000, which is why this
  setup uses 3443/3080.)
- **The Quest cannot connect at all**: check both devices are on the same Wi-Fi, and on Windows
  that the firewall allowed Node (Windows Security → Firewall → Allow an app).
- **No VR button**: you opened the `http` address, or the browser cannot start WebXR on the
  chosen device (the badge under the drop-down says "VR: not available"). The viewer does not
  fall back to the other backend, by design; pick the other one with the Backend switch.
- **"WebGPU is required" on the page**: the browser has no WebGPU or it is disabled; choose
  WebGL2 with the Backend switch (or `?webgl`) instead.
- **Certificate warning every visit (Quest)**: expected with a self-signed certificate; proceed.
  Apple devices: install the certificate as described above.
- **Certificate expired or the computer's address changed**: run `node make_certificate.mjs`
  (needs `openssl`, which macOS and Git for Windows include), restart the server, and reinstall it
  on Apple devices. The server warns at start when the certificate is about to expire.
- **"Could not list the scene folder"**: the server is not running.
- **Scene loads but the Quest browser crashes or reloads**: out of memory; try the SOG copy.
