# SCSU Recruitment Flyer

Imported from the Claude Design project **"SCSU On-Campus Job Openings"**
(`SCSU Recruitment Flyer-print.dc.html`). A US-Letter (8.5" × 11") print flyer
advertising on-campus student jobs for Southern California State University.

## Files

| File | Purpose |
| --- | --- |
| `scsu-recruitment-flyer.html` | **Primary deliverable.** Self-contained, print-ready flyer — plain HTML/CSS, no runtime. Open in any browser and print / "Save as PDF". |
| `SCSU Recruitment Flyer-print.dc.html` | Original Claude Design source (editable in the design tool). Renders through the `doc-page` runtime. |
| `support.js`, `doc-page.js` | Claude Design runtime scaffolding required by the `.dc.html` source. |
| `assets/scsu-logo.png` | SCSU seal (1563 × 1563). |
| `assets/qr-code.png` | Application QR code (1968 × 1968). |

## Printing

`scsu-recruitment-flyer.html` is fixed to a single Letter page with
`@page { size: letter; margin: 0 }`. To export a PDF:

1. Open the file in Chrome.
2. Print → Destination "Save as PDF", paper "Letter", margins "None",
   "Background graphics" enabled.

## Design

- **Colors** — navy `#335B82`, orange `#FF9800`, yellow `#EFDC03`.
- **Fonts** — Archivo (display / headings), Public Sans (body), loaded from
  Google Fonts with system-font fallbacks.
- **Contact** — 3470 Wilshire Blvd, Suite 380, Los Angeles, CA 90010 ·
  (213) 382-5300.
