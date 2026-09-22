# 3DGS_scenes

Put scene files in this folder: `.ply` (raw 3D Gaussian Splatting), `.compressed.ply` or `.sog`.
Files that share a name are one scene (`kitty.ply` and `kitty.sog` give one entry with a PLY
button and a SOG button), and a `kitty.txt` with `Title:`, `Author:`, `License:` and `Source:`
lines becomes its caption. The scene list page picks up new files on reload.

Nothing in this folder except this file is committed to the repository; the scenes are
distributed separately. See the README one level up for the server and for SOG copies.
