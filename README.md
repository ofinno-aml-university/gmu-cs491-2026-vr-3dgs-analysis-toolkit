# VR 3DGS Analysis Toolkit

**George Mason University CS491 | Fall 2026 - Spring 2027 | Sponsored by Ofinno**

Build an interactive VR toolkit for inspecting compression artifacts in 3D Gaussian splatting scenes. Stereo viewing can reveal holes, floaters and differences between the two eye views that are difficult to inspect on a monitor.

[Read the project one-pager (PDF)](project-1-one-pager-public-v1.1.pdf)

**Status:** Project setup. Implementation, installation commands and demos will be added as the team develops the toolkit. The one-pager summarizes the project; the accepted sponsor RFP defines the detailed requirements.

## What we are building

The starting point is **SuperSplat**, using TypeScript/JavaScript for the application and Python where useful for supporting tools. A Quest 3S headset and tracked controllers are the target interaction platform. Ofinno supplies a headset on loan and project scene inputs.

| Area | Purpose |
| --- | --- |
| Reveal | Inspect a scene using a controller-driven cut plane, crop regions and opacity controls. |
| Re-render | View splat centers or outlines and color the scene by attributes. |
| Quantify | Probe individual splats and extend toward region statistics and histograms. |

## Scope and success criteria

- **Tier 1: VR proof of concept.** Load a real scene and inspect it in stereo at an interactive frame rate, with a reproducible build.
- **Tier 2: MVP.** Deliver a hand-held cut plane, attribute coloring and a single-splat probe with deterministic selection. Use the original `.ply` data for attribute inspection.
- **Tier 3: Extensions.** Select stretch features such as A/B comparison, histograms, saved regions or floater triage after the MVP works.

The Fall semester focuses on understanding the codebase, validating interactions and producing the PoC and Spring plan. Spring develops and integrates the MVP. Confirm performance targets and feature acceptance criteria against the RFP with the project contacts.

## Getting started

1. Review the sponsor RFP and course syllabus with the team.
2. Inspect SuperSplat's loading, rendering and interaction paths; record the upstream version and dependencies.
3. Confirm access to the headset, controllers and scenes, including redistribution permissions.
4. Establish a small baseline scene and record frame time and memory use on the target device.
5. Add setup commands and a repeatable smoke test when the first working build is committed.

Desktop and WebXR emulation can support development, but stereo quality and controller interactions need testing on the headset.

## Course assignments

Copied from the Fall 2026 syllabus assignment table (August 16, 2026).

| Assignment | Date due | Description | Points | Team / individual |
| --- | --- | --- | --- | --- |
| Assignment 5. PoC Proposal | 2026-10-02 | Proof of Concept Study | 10 | Team |
| Assignment 15. PoC Report | 2026-11-20 | Project Deliverable | 10 | Team |
| Assignment 16. PoC Presentation | 2026-12-04 | Team pres w/indiv grades | 10 | Individual |
| Assignment 19. Implementation Proposal | 2026-12-04 | Implement Solution | 10 | Team |
| Assignment 21. Customer satisfaction | 2026-12-04 | Cust submits to prof | 14 | Individual |

Spring class date on syllabus page 6: 2027-04-30 Presentation. The Fall assignment table does not assign an ID or points to this date. Weekly reports, monthly reports, the project notebook, professor satisfaction and attendance stay in the syllabus. Later course announcements take precedence over this page.

## Collaboration and contact

Use the **project Teams group chat** for coordination and sponsor questions. Plan a 30-minute sponsor meeting every two weeks, with the recurring slot agreed in that chat. The team separately schedules its sponsor review. Keep technical tasks, decisions and reproducible bug reports in GitHub Issues; submit changes through pull requests with a short description and validation evidence. Agree on the review workflow with the project contacts.

Ofinno project contacts: **Stephen**. Student team: **Team Parallax (4 students)**.

Sponsor contact: **Chia-Yang Tsai (Ofinno)**. Student contact details and Teams invitation links are not published here.

## License

Original project code is released under the [MIT License](LICENSE). Contributors retain copyright in their contributions. MIT permits commercial reuse, including use in a startup, subject to its notice requirements.

Third-party code, model weights, datasets and media remain subject to their own licenses. Record their sources and license terms before adding them. The Ofinno name and logo in the sponsor one-pager identify the sponsor; the MIT software license grants no trademark rights or endorsement.
