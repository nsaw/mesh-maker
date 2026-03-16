---
name: frontend-design
description: Guide for designing and implementing UI changes in MeshCraft 3000 that maintain visual consistency with the existing dark industrial/CNC aesthetic. Use this skill whenever the user asks to build, modify, or add any UI component, page section, modal, sidebar panel, control, button, overlay, or visual element. Also use when the user mentions design, styling, layout, CSS, responsive behavior, theming, or wants to add any visible frontend feature — even if they don't explicitly say "design". This skill ensures all UI work follows MeshCraft's established design system rather than producing generic output.
---

## MeshCraft 3000 Design System

MeshCraft is a browser-based 3D mesh generator for CNC machining. The UI has an
industrial, dark-themed aesthetic — think professional CAD/CAM tooling software,
not a consumer web app. Every design decision should reinforce this identity:
precise, technical, and purpose-built for makers.

### Visual Identity

**Dark industrial palette** — The interface uses deep blue-grays with blue accent
lighting, evoking a machine shop control panel. Color creates hierarchy: darker
backgrounds recede, brighter accents draw focus to interactive elements.

**Typography communicates function** — Section headers use condensed uppercase
(Teko) for a mechanical feel. Body text uses Ubuntu for readability. Monospace
(JetBrains Mono) marks data values, making them visually distinct from labels.

**Compact density** — Controls are tightly packed like a hardware control surface.
Padding is minimal but consistent. Every pixel serves a purpose.

---

## Design Tokens

Use CSS custom properties exclusively. Never hardcode color values.

### Colors
```css
--bg: #141418;           /* App background, canvas fill */
--bg2: #1c1c22;          /* Panels (header, sidebar, toolbar) */
--bg3: #24242c;          /* Hover states, elevated surfaces */
--bg4: #2e2e38;          /* Borders, dividers, scrollbar thumbs */
--text: #e0e0e6;         /* Primary text */
--text2: #999;           /* Secondary text, labels */
--text3: #666;           /* Tertiary text, hints, disabled */
--accent: #4eaaff;       /* Primary accent — interactive highlights, active states */
--accent2: #2d7dd2;      /* Accent buttons background, CTAs */
--accent-glow: rgba(78,170,255,0.15);  /* Subtle glow behind active controls */
--warn: #ffaa4e;         /* Warnings, CNC limit alerts */
--green: #4eff9e;        /* Success states, depth map loaded, ShopBot branding */
--red: #ff4e6a;          /* Error states (used sparingly) */
--radius: 8px;           /* Default border radius */
--mono: 'JetBrains Mono', monospace;   /* Monospace font stack */
```

### Semantic Usage
| Token | When to use |
|-------|-------------|
| `--bg` | Page-level background, canvas area |
| `--bg2` | Container panels — header, sidebar, toolbars, export bar |
| `--bg3` | Hover/pressed states on `--bg2` surfaces, elevated cards |
| `--bg4` | All borders, dividers, inactive slider tracks |
| `--accent` | Interactive element highlights, active pill borders, slider thumbs |
| `--accent2` | Filled button backgrounds (Export, CTA buttons) |
| `--green` | CNC-specific badges, success indicators, sponsor branding |
| `--warn` | CNC limit warnings (Z height exceeds 6"), tip button |

---

## Typography

Three fonts, each with a specific role:

| Font | Weight(s) | Role | Example |
|------|-----------|------|---------|
| **Teko** | 400, 500, 600 | Section headers, brand text | `MESH DIMENSIONS`, `NOISE PARAMETERS` |
| **Ubuntu** | 300, 400, 500, 700 | Body text, buttons, labels | Control labels, button text |
| **JetBrains Mono** | 400, 500 | Data values, code, badges | Slider values, version badge, stats |

### Font Sizing Scale
```
9px   — Sub-labels (profile pills, CNC badges)
10px  — Small buttons (btn-sm), stat text, hints
11px  — Control labels, checkbox labels, select inputs
12px  — Text inputs, upload zone text, descriptions
13px  — Base body font size, sponsor description
14px  — Section titles (Teko)
16px  — Brand name
22px  — Sponsor name (modal)
```

### Text Conventions
- Section titles: `text-transform: uppercase; letter-spacing: 1.2px; font-family: 'Teko'`
- Button text: `text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700`
- Data values: `font-family: var(--mono); color: var(--accent)`
- Hint/helper text: `font-size: 10px; color: var(--text3)`

---

## Component Patterns

### Buttons

Three tiers:
```
.btn              — Default: bg3 fill, bg4 border, text color. Hover → bg4/text3 border.
.btn.btn-accent   — Primary action: accent2 fill, accent border, white text. Hover → accent fill.
.btn.btn-sm       — Compact: 4px 10px padding, 10px font.
```

Always: `font-family: 'Ubuntu'; text-transform: uppercase; letter-spacing: 0.8px; border-radius: var(--radius)`

### Pill Buttons (Presets/Profiles)
```css
.preset-pill {
  padding: 4px 10px;
  border-radius: 20px;        /* Full round ends */
  border: 1px solid var(--bg4);
  background: var(--bg);
  font-size: 10px;
  text-transform: uppercase;
}
.preset-pill:hover  { border-color: var(--accent); color: var(--accent); }
.preset-pill.active { background: var(--accent2); border-color: var(--accent); color: #fff; }
```

### Sliders
```css
input[type="range"] {
  height: 4px;
  background: var(--bg4);     /* Track */
  border-radius: 2px;
}
/* Thumb: 14x14px circle, accent fill, bg2 border, subtle glow shadow */
```

Label pattern: `<label text> ........... <monospace value>` using flexbox `justify-content: space-between`.

### Sections (Collapsible)
```
.section-header → flex row: title (left) + arrow (right)
.section-body   → content with 4px 14px 14px padding
.section.collapsed → arrow rotated -90deg, body hidden
```
Click toggles `collapsed` class. On mobile (≤900px), accordion behavior —
opening one section closes others.

### Text Inputs
```css
background: var(--bg); border: 1px solid var(--bg4); border-radius: 4px;
font-family: var(--mono); font-size: 12px;
:focus { border-color: var(--accent); }
```

### Overlays (Stats, Dims)
```css
background: rgba(20,20,24,0.85);
backdrop-filter: blur(8px);
border: 1px solid var(--bg4);
border-radius: var(--radius);
font-family: var(--mono);
pointer-events: none;          /* Non-interactive info displays */
```

### Modals
```css
/* Backdrop: fixed inset 0, rgba(0,0,0,0.6), backdrop-filter blur(6px) */
/* Modal: bg2 fill, bg4 border, 12px radius, box-shadow 0 20px 60px rgba(0,0,0,0.5) */
/* Entry animation: translateY(20px) scale(0.97) → translateY(0) scale(1) */
```

### CNC Badges
```css
.cnc-badge {
  font-family: var(--mono);
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(78,255,158,0.1);
  color: var(--green);
  border: 1px solid rgba(78,255,158,0.2);
}
/* Warning variant: --warn colors instead of --green */
```

### Toast Notifications
```css
position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
background: var(--accent2); color: #fff;
padding: 8px 20px; border-radius: var(--radius);
font-size: 12px; font-weight: 600;
/* Fade in/out via opacity transition */
```

---

## Layout Architecture

### Desktop (>900px)
```
┌─────────────────────────────────────────────────────┐
│ HEADER (48px fixed)                                 │
├──────────┬──────────────────────────────────────────┤
│ SIDEBAR  │ VIEWPORT                                 │
│ (320px)  │  ┌─ toolbar (36px) ────────────────────┐ │
│ scrolls  │  │ view modes │ action buttons         │ │
│ overflow │  ├────────────────────────────────────────┤
│          │  │                                      │ │
│          │  │         CANVAS (flex: 1)             │ │
│          │  │    stats overlay (bottom-left)       │ │
│          │  │    dims overlay (top-right)          │ │
│          │  │                                      │ │
│          │  ├────────────────────────────────────────┤
│          │  │ EXPORT BAR                           │ │
│          │  │ filename │ formats │ opts │ [Export]  │ │
└──────────┴──┴──────────────────────────────────────┘
```

### Mobile (≤900px)
```
┌────────────────────┐
│ HEADER (42px)      │
├────────────────────┤
│ SIDEBAR (max 35vh) │
│ accordion sections │
├────────────────────┤
│ VIEWPORT (min 60vh)│
│  toolbar (wraps)   │
│  canvas            │
│  export bar (wraps)│
└────────────────────┘
Scroll-to-export FAB (bottom-right)
```

Key responsive changes at ≤900px:
- `.main` switches from `flex-direction: row` to `column`
- Sidebar becomes full-width, max-height 35vh, scrollable
- Preset pills use CSS grid (3-col for presets, 4-col for profiles)
- Brand name and version badge hidden
- Export bar wraps: filename goes full-width

---

## Interaction Patterns

### Transitions
All transitions are fast (0.1–0.15s) to feel snappy like hardware controls:
```css
transition: all 0.12s;     /* Buttons, pills */
transition: all 0.15s;     /* Inputs, larger elements */
transition: opacity 0.2s;  /* Overlays */
transition: opacity 0.25s; /* Modals */
```

### Hover States
- Buttons: background lightens one step (bg3 → bg4)
- Pills: border and text color shift to accent
- Inputs: border shifts to accent
- Links/CTAs: translateY(-1px) + box-shadow for subtle lift

### Active/Selected States
- Mode tabs: accent background, white text
- View buttons: bg3 background, text color
- Format buttons: accent2 background, white text
- Preset pills: accent2 background, accent border, white text

### Canvas Cursors
```css
.canvas-wrap          { cursor: grab; }
.canvas-wrap.dragging { cursor: grabbing; }
.canvas-wrap.panning  { cursor: move; }
```

---

## Implementation Rules

1. **CSS custom properties only** — never hardcode `#141418` or `rgb(78,170,255)`.
   Always use `var(--bg)`, `var(--accent)`, etc.

2. **No external CSS frameworks** — this project uses hand-written CSS in a single
   `styles/main.css` file. No Tailwind, Bootstrap, or CSS-in-JS.

3. **innerHTML is acceptable but XSS-aware** — the sidebar and many UI elements
   are built via string concatenation in TypeScript. When interpolating user-controlled
   values (like `STATE.depthMapName` from file uploads), always escape `<` and `>`:
   ```typescript
   .replace(/</g, '&lt;').replace(/>/g, '&gt;')
   ```

4. **All styles go in `styles/main.css`** — no inline style blocks in HTML, no
   CSS modules, no separate component stylesheets. One file.

5. **Responsive at 900px** — all new components must include a `@media (max-width: 900px)`
   rule handling the column layout, reduced padding, and touch-friendly sizing.

6. **Touch-compatible** — interactive elements need adequate tap targets (minimum
   24x24px). The canvas uses `touch-action: none` for custom gesture handling.

7. **Font loading graceful degradation** — Google Fonts loads Ubuntu, Teko, and
   JetBrains Mono. If fonts fail, the system falls back to `sans-serif` /
   `monospace`. Test that layouts don't break with fallback fonts.

8. **No `console.log`** — this is a production tool, not a debug environment.

9. **Object URL cleanup** — if creating blob URLs for previews or downloads,
   always pair `createObjectURL()` with `revokeObjectURL()`.

10. **Canvas 2D, not WebGL** — the viewport renderer uses Canvas 2D API
    intentionally. Do not introduce WebGL, Three.js, or any GPU-accelerated
    rendering library. Performance is adequate for CNC mesh resolution.

---

## Adding New UI Components

When adding a new component, follow this checklist:

1. **Match existing density** — MeshCraft's controls are compact. New controls
   should use the same padding/margin as adjacent elements.

2. **Use existing component classes** — before creating new CSS, check if an
   existing class (`.btn`, `.preset-pill`, `.control-row`, `.section`, etc.)
   already handles your use case.

3. **Place CSS in the right section** — `main.css` is organized by component
   (HEADER, SIDEBAR, CONTROLS, VIEWPORT, etc.). Add new rules near related
   components, not at the bottom of the file.

4. **Wire controls in TypeScript** — new interactive elements are typically
   wired in `ui.ts:wireControls()`. If they affect mesh generation, pipe
   through `STATE` → `debouncedGenerate()`. If they affect rendering only,
   call `renderViewport()` directly.

5. **URL state persistence** — if the new control adds a STATE key that should
   be shareable, update `serializeConfig()` / `deserializeConfig()` in
   `state.ts`.

6. **Test all view modes** — solid, wireframe, both, and points rendering
   must all still work after UI changes.

7. **Verify Playwright screenshots** — capture verification screenshots to
   `/Users/sawyer/Code/mesh-maker/verification/` to confirm visual correctness.
