# LED Hardware Catalog

Candidate cabinets and processors for the Engineering Studio's dropdowns, and how a NovaStar system is configured. The Lead Architect wrote it on 2026-11-20 at the owner's request.

**Status: research, not in the app.** Nothing here is built. Alpha 0.1 doesn't change: this is input for the Engineering work (LED Engineering tasks E2–E4), which the owner schedules after Alpha 0.1. No value goes into the app until someone has checked it against the manufacturer's PDF for the exact variant, and filled in the **Checked** column.

## Rules for every value

- **Cite it.** Every number links to where it was read. `S` marks a manufacturer document: a NovaStar, ROE, Absen, Unilumin or Yestech spec sheet or brochure, wherever it's hosted. `D` marks a distributor or rental-house listing, which is weaker.
- **Never guess.** A blank cell means the source doesn't state the value. Don't fill it with a typical value for the class. That matches `CabinetSpecs`, where `null` means "not stated".
- **Show conflicts.** When sources disagree, the table shows both values and the conflicts section explains. The app stores one value only after the PDF settles it.
- **Mark derived values.** Values worked out here, such as power per cabinet from W/m², are marked *derived* with the arithmetic shown.
- **Pixels come from the cabinet's pixel count.** Never from pitch. A cabinet whose pixel count isn't published stays out of the dropdown.
- **App units.** The tables use the data sheets' units. In the app they become integers: µm, px, g, mW, Hz (see `src/domain/cabinets.ts`).
- **Checked.** This means read in the PDF for the exact variant, with a date and initials. Today nothing is checked: every value comes from search results that quote the documents linked below. All were accessed on 2026-11-20.

## Cabinets

Indoor rental cabinets of 500 × 500 mm unless stated. Power is per cabinet: max / average or typical, as published.

| Model | Pitch | Size (mm) | Pixels | Weight | Power max / avg | Refresh | Sources | Checked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ROE Black Pearl BP2V2 | 2.84 mm | 500 × 500 × 90 | 176 × 176 | 9.35 kg | 190 / 95 W (see conflicts) | | S [1], D [2] | — |
| Absen PL2.5 Pro V10 | 2.5 mm | 500 × 500 × 88 | 200 × 200 | 8.6–9.5 kg (conflict) | conflict | | D [3][4][5] | — |
| Absen PL2.9 V10 | 2.97 mm | 500 × 500 × 78 | 168 × 168 | ≈ 8 kg | not readable | | S [6] | — |
| Absen PL3.9 V10 | 3.91 mm | 500 × 500 × 88 | 128 × 128 | 7.7 kg | 540 / 180 W/m² → 135 / 45 W *derived* | 3840 Hz (D) | S [7], D [8] | — |
| Unilumin Upad IV 2.6 | 2.6 mm | 500 × 500 × 70 | 192 × 192 | 6.3 kg | 120 / 40 W | 3840 Hz | D [9][10] | — |
| Unilumin Upad IV-S 2.6 (curved) | 2.6 mm | 500 × 500 × 80 | not stated | 7.7 kg | 150 / 45 W | | D [11] | — |
| Yestech MG6S P2.6 | 2.6 mm | 500 × 500 × 73 | 192 × 192 | 6.7 kg (cube); 5.7 kg (front service) | 450 / 150 W/m² → 112.5 / 37.5 W *derived* | ≥ 3840 Hz | S [12], D [13][14] | — |
| ROE Carbon CB5 MKII (outdoor) | 5.77 mm | 600 × 1200 × 72 | not stated | not found | not found | | S [15] | — |

*Derived* power per cabinet = W/m² × 0.25 m² (a 500 × 500 mm cabinet). Absen gives a ±15 % tolerance on power, and Yestech gives ±15 %.

**Ready for the dropdown once checked:** BP2V2, PL3.9 V10, Upad IV 2.6 and MG6S P2.6. The rest need their PDF first: the PL2.5 Pro and PL2.9 for weight and power, the Upad IV-S and CB5 MKII for pixel counts.

**Still to research** (pixel count, weight and power not found yet): INFiLED DB2.6 and AR series, ROE Black Onyx and Vanish, Unilumin Upad IV 3.9, the outdoor Absen PL Pro range, and the Yestech MG9 and MG10.

## Processors

`GbE` is a Gigabit Ethernet output, the port a chain of cabinets plugs into. **Per port** is the pixel load one port carries, under the conditions its source states.

| Model | Outputs | Total load | Per port | Max size | Sources | Checked |
| --- | --- | --- | --- | --- | --- | --- |
| NovaStar MCTRL4K | 16 GbE + 4 fiber (fiber copies GbE: OPT1 = 1–8, OPT2 = 9–16) | 8.8 M px (HDMI/DP), 8.3 M px (DVI) | 650 000 px at 8-bit; 320 000 at 10/12-bit | input 4096 × 2160 @ 60 Hz | S [16], D [17] | — |
| NovaStar MCTRL660 Pro | 6 GbE + 2 × 10G fiber | 1920 × 1200 @ 60 Hz (2 304 000 px, *derived*) | | 1920 × 1200 | S [18], D [19] | — |
| NovaStar VX600 | 6 GbE + 2 × 10G fiber | 3.9 M px (D) | | conflict, see below | S [20], D [21] | — |
| NovaStar VX1000 | 10 GbE | 6.5 M px | 650 000 px (D only) | width 10 240, height 8192 | S [22], D [23] | — |
| NovaStar MX40 Pro (COEX) | 20 GbE + 4 × 10G fiber | 9 M px (spec V1.4.0) | load = sum of loaded cabinets | 4096 × 2160 @ 60 Hz; width up to 8192, height up to 7680 | S [24][25] | — |
| NovaStar H series 4K sending card (16 RJ45 + 2 fiber), for H2/H5/H9/H15 | 16 GbE + 2 fiber | 10.4 M px per card; 10 240 px per side | 650 000 px at 8-bit; 320 000 at 10-bit | | S [26], D [27] | — |
| Brompton Tessera SX40, S8 | | | | | **not found** | — |

H series frames hold several cards. Blizzard's H2 sheet gives 26 M px for the H2 and 39 M px for the H5 with 4K sending cards [27]. One reseller lists 52 M px for the H2, which doesn't match: check NovaStar's H2 and H5 sheets.

**Brompton:** the searches returned nothing usable. Brompton's processors feed XD boxes over fiber, and their port rules differ from NovaStar's. Read Brompton's own documentation before adding them, and don't model them as NovaStar.

**Receiving cards** (the card inside each cabinet, such as the NovaStar A8s Pro and A10s Pro) limit how many pixels one cabinet can have. They aren't researched yet. The cabinet maker's `.rcfgx` file already fits the card to the cabinet.

## Conflicts

- **BP2V2 power:** ROE has published 160 / 80 W (older spec sheet), 185 / 92 W (2021 brochure) and 190 / 95 W (2024 brochure and the Korean sheet). The table uses the newest, 190 / 95 W, until the current PDF confirms it.
- **PL2.5 Pro V10:** weight is 8.6 kg [3], 9.08 kg [5] or 9.5 kg [4]. Power is 192.5 W per panel [3], 540 W [5] or 600 / 200 W/m², which is 150 / 50 W *derived* [4]. These can't all be right, so it stays out until Absen's PDF settles it.
- **PL2.9 V10:** the cut sheet's table doesn't extract cleanly. 680 / 230 W/m² may belong to a different column.
- **PL3.9 V10:** the spec sheet (V20221201) gives 540 / 180 W/m². The cut sheet may show 680 / 230 W/m² next to it. The spec sheet is used.
- **VX600 maximum size:** NovaStar's sheet gives 3840 px wide (3840 × 648 @ 60 Hz) and 2784 px tall (800 × 2784 @ 60 Hz). A third-party Q&A says 10 240 × 8192. Use NovaStar's figures.
- **Per-port figures:** 650 000 px at 8-bit is NovaStar's own figure for the MCTRL4K and the H series card. For the VX1000 only a reseller states it. Port capacity falls at higher bit depth, at higher frame rates and with features such as HDR. The app must show the basis next to every per-port number (the `portBasis` field), never a bare number.

## How a NovaStar system is configured

In **NovaLCT**, NovaStar's free configuration software for Windows, connected to the processor over USB or Ethernet. An overview of the procedure:

1. **Cabinet files.** Under *Screen Configuration → Receiving Card*, load the cabinet maker's file (`.rcfgx`) and send it to the receiving cards. It sets the module type, scan and timing, and the cabinet's pixel size. Without it you read the current settings back from a card. Wrong files give wrong images and can damage modules, so use only the maker's file for the exact model.
2. **Screen connection.** Physically connect the processor and the cabinets following the cabling drawing. Then, in advanced login mode, open *Screen Configuration → Screen Connection* and enter, for each Ethernet port:
   - the columns and rows of receiving cards (cabinets) it drives;
   - each cabinet's size in pixels;
   - the cable path between cabinets (serpentine, by columns or rows, and where it starts);
   - its offset in the processor's canvas.

   Unused positions are disconnected.
3. **Send and save.** Send to the hardware, then save to the receiving cards and the processor. Back up three files: receiving card configuration, screen configuration and system configuration.
4. **Optional.** Brightness, colour temperature, per-cabinet calibration (correction coefficients), and redundancy: a second cable on the far end of each chain, from another port.

**What Pixel Lab can produce: a *Nova setup sheet*.** A printable sheet for the technician to enter by hand in step 2:
- for each port: its cabinets, columns × rows, cable path and start corner, pixel load against its capacity, and its offset in the canvas;
- total pixels against the processor's limits;
- power per screen and per circuit;
- weight per screen and per hanging line.

Everything comes from `resolveMapping` and the cabinet's checked data.

**What it can't produce:** NovaLCT's `.rcfgx`, screen configuration and system configuration files. Their formats aren't publicly documented. The same rule applies as for Resolume presets ([RESOLUME](../integrations/RESOLUME.md)): no invented formats. If NovaStar publishes a format, or one is tested against real hardware, this can be reconsidered.

Sources for this procedure: [28][29][30]. They're secondary sources. The NovaLCT manual for the firmware in use is authoritative.

## Worked example

A 12 × 6 wall of ROE BP2V2 on one MCTRL4K, using the unchecked values above.

| | Calculation | Result |
| --- | --- | --- |
| Resolution | 12 × 176 by 6 × 176 | 2112 × 1056 px = 2 230 272 px |
| Fits the processor? | 2 230 272 ≤ 8 800 000; 2112 ≤ 4096 | Yes |
| Pixels per cabinet | 176 × 176 | 30 976 px |
| Most cabinets on one port (8-bit) | ⌊650 000 ÷ 30 976⌋ | 20 |
| Fewest ports | ⌈2 230 272 ÷ 650 000⌉ | 4 |
| Practical plan | 3 whole columns per port: 18 cabinets, 557 568 px each (86 % of capacity) | 4 ports, 8 with redundancy |
| Power, max | 72 × 190 W | 13 680 W |
| Power, average | 72 × 95 W | 6 840 W |
| Circuits, 230 V / 16 A (80 % loading)\* | ⌊(230 × 16 × 0.8) ÷ 190⌋ = 15 cabinets per circuit → ⌈72 ÷ 15⌉ | 5 circuits |
| Circuits, 120 V / 20 A (80 % loading)\* | ⌊1920 ÷ 190⌋ = 10 per circuit → ⌈72 ÷ 10⌉ | 8 circuits |
| Weight, cabinets only | 72 × 9.35 kg | 673.2 kg |
| Weight per column | 6 × 9.35 kg | 56.1 kg (ROE allows up to 20 hanging, 12 stacked [1]) |

\* Circuits are planned on **maximum** power, not average. The 80 % loading is an assumption common in practice, not a rule from these sources. Local electrical code and a qualified electrician decide.

Rigging, frames, cables and processors aren't included. These are planning estimates. Safety-relevant values carry the disclaimer from `EngineeringSummary` and need qualified review, as the ROADMAP requires.

## How it would enter the app

A proposal only. The owner decides when (after Alpha 0.1), and the Lead Architect then reviews it as a contract change.

1. **Cabinets:** checked entries become read-only built-in library entries, a list next to `SEED_LIBRARY_CABINETS`, with their `CabinetSpecs` and a citation. The **Add screen** dropdown already lists library cabinets, so they would appear there with no UI change. A citation field on `LibraryCabinet` is a contract change for LED Engineering.
2. **Processors:** checked entries become `ProcessorModel` records (`src/domain/engineering.ts`), which already carry `pixelsPerPort`, `portBasis`, inputs and `sources`. A processor dropdown is part of the Engineering Studio panel (E4).
3. **Calculations:** port load, power, circuits and weight are E2 pure functions in `src/engines/led/`, filling `summarizeEngineering`. Unit tests use this page's worked example.
4. **Nova setup sheet:** a new export entry that reads `EngineeringSummary`. It needs a saved port plan per project (E3, which needs a schema bump).

## Sources

All accessed 2026-11-20. The `S` / `D` tag is as defined above.

1. S. ROE Visual, Black Pearl BP2V2 brochure, 2024-02-03. <https://www.roevisual.com/uploads/files/Product%20File/Black%20Pearl/bp2v2-brochure-en-feb.-3-2024.pdf>. Older: [spec sheet](https://www.roevisual.com/uploads/Images/Products/Black%20Pearl%202%20V2/bp-v2-specs.pdf), [2021 brochure](https://www.roevisual.com/uploads/Images/Products/Black%20Pearl%202%20V2/bp2-v2-brochure-14-apr-2021.pdf)
2. D. Rentex, ROE Black Pearl BP2 V2. <https://www.rentex.com/rental-products/roe-visual-black-pearl-bp2-v2/>
3. D. Rentex, Absen PL2.5 Pro. <https://www.rentex.com/rental-products/absen-pl2-5-pro/>
4. D. Scan, Absen PR2.5 500×500. <https://www.scan.co.uk/products/absen-pr25-500x500mm-led-panel-25mm-pixel-pitch-1500nits-16-bit-brompton-control-ip40-ip21>
5. D. 4Wall, Absen PL2.5 Pro V10 and the LED wall calculator. <https://europe.4wall.com/rentals/9758863/absen-pl2-5-pro-v10>, <https://www.4wall.com/led-wall>
6. S. Absen PL2.9 V10 cut sheet (hosted by Full Compass). <https://fullcompass.com/common/files/86827-PL29V10cutsheet.pdf>
7. S. Absen PL3.9 V10 spec sheet V20221201 (hosted by Full Compass). <https://www.fullcompass.com/common/files/86830-PL39V10specsheet.pdf>
8. D. Full Compass, Absen PL3.9 V10. <https://www.fullcompass.com/prod/623261-absen-pl3-9-v10-pl-series-3-9mm-pixel-pitch-video-wall-panel>
9. D. 4Wall, 2.6mm Unilumin Upad IV. <https://4wall.com/rentals/9759073/2-6mm-unilumin-upad-iv>
10. D. Hartford Rents, Unilumin Upad IV 2.6. <https://hartfordrents.com/product/unilumen-upad-iv-2-6-video-wall-tile-rental>
11. D. 4Wall, 2.6mm Unilumin Upad IV-S. <https://www.4wall.com/rentals/9759075/2-6mm-unilumin-upad-iv-s>
12. S. Yestech, MG6S Series. <https://yes-led.com/product/rental-staging/mg6s-series.html>
13. D. Audioeffetti, Yestech P2.6 MG6 cube (6.7 kg) and front service (5.7 kg). <https://audioeffetti.com/en/category/video/led-walls/yes-tech-p2-6mg6ci20-indoor-ic-icn2153-smd1515-full-black-leds-copper-wire-800-1200-nit-le-3840-hz-500-x-500-mm-6-7-kg-p88995>, <https://audioeffetti.com/en/categorie/video/led-walls/yes-tech-p2-6mg6si21-cw-indoor-front-service-ic-dp3265-smd1515-full-black-led-copper-wire-1200-nit-le-3840-hz-500-x-500-mm-5-7-kg-p18187>
14. D. Ribalto, Yestech P2.6 MG6S. <https://ribalto.com/en/yes-tech-p26-mg6s-p26mg6si21-cw>
15. S. ROE Visual, CB5L MKII brochure, 2024-02-19, and CB MKII specifications, 2023-01-13. <https://www.roevisual.com/uploads/files/Product%20File/CB%20MK%E2%85%A1/cb5l-mkll-brochure-feb-19-2024.pdf>, <https://www.roevisual.com/uploads/files/Product%20File/CB%20MK%E2%85%A1/cb-mkll-specifications-jan-13-2023.pdf>
16. S. NovaStar, MCTRL4K Specifications Rev1.0.1 (hosted by Rentex). <https://www.rentex.com/wp-content/uploads/2018/02/NovaStar-Controller-MCTRL4K-Specifications-Rev1.0.1.pdf>
17. D. B&H, NovaStar MCTRL4K. <https://www.bhphotovideo.com/c/product/1865454-REG/novastar_mctrl4k_controller_sending_box.html/overview>
18. S. NovaStar, MCTRL660 PRO cut sheet (hosted by Full Compass). <https://www.fullcompass.com/common/files/35894-MCTRL660PROCutSheet.pdf>
19. D. B&H, NovaStar MCTRL660 PRO. <https://www.bhphotovideo.com/c/product/1865457-REG/novastar_mctrl660_pro_controller_sending.html>
20. S. NovaStar, VX600 All-in-One Controller Specifications V1.7.1. <https://ret.de/wp-content/uploads/2025/08/VX600-All-in-One-Controller-Specifications-V1.7.1.pdf>
21. D. Markertek, NovaStar VX600. <https://www.markertek.com/product/nva-vx600/novastar-vx600-all-in-one-video-processing-controller-with-6x-rj45-2x-10g-opt-1x-hdmi1-3-outputs>
22. S. NovaStar, VX1000 All-in-One Controller Specifications V1.6.0. <https://skv.lighting/wp-content/uploads/2024/07/VX1000-All-in-One-Controller-Specifications-V1.6.0.pdf>
23. D. Creation Networks, NovaStar VX1000. <https://creationnetworks.net/products/novastar-vx1000-is-an-all-in-one-controller-that-integrates-video-processing-and-video-controlling-in-one-device-up-to-6-5-million-pixels>
24. S. NovaStar, MX40 Pro LED Display Controller Specifications V1.4.0. <https://skv.lighting/wp-content/uploads/2024/07/MX40-Pro-LED-Display-Controller-Specifications-V1.4.0.pdf>
25. S. NovaStar, MX40 Pro Specifications V1.5.1 and V1.0.0. <https://ret.de/wp-content/uploads/2026/07/MX40-Pro-LED-Display-Controller-Specifications-V1.5.1.pdf>, <https://cdn.shopify.com/s/files/1/0150/7190/3844/files/MX40_Pro_LED_Display_Controller_Specifications-V1.0.0.pdf>
26. S. NovaStar, H Series Video Wall Splicer Specifications V1.0.0. <https://cdn.shopify.com/s/files/1/0150/7190/3844/files/H_Series_Video_Wall_Splicer_Specifications-V1.0.0.pdf>
27. D. Blizzard, H2 spec sheet, and Audioeffetti, H series 16×RJ45 card. <https://goknight.com/content/documentation/Blizzard%20H2%20Spec%20Sheet.pdf>, <https://audioeffetti.com/en/categorie/video/video-signal-processing/novastar-h-16xrj45-2xfiber-16x-rj45-2x-fiber-output-card-for-novastar-h-series-h2-h5-h9-h15-video-wall-splicers-p71490>
28. D. Daktronics KB, NovaStar H series screen configuration. <https://www.daktronics.com/en-us/support/kb/000030097>
29. D. Daktronics KB, saving and loading NovaStar configuration files. <https://daktronics.com/en-us/support/kb/DD3803589>
30. S. NovaStar, NovaLCT LED Synchronous Control System User Manual V5.3.01 (hosted by Rentex). <https://www.rentex.com/wp-content/uploads/2018/02/NovaLCT-LED_Synchronous_Control_System_User_Manual_V5.3.01.pdf>
