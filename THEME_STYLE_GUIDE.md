# EastMesh Theme Style Guide

This guide defines the visual language for EastMesh-branded web surfaces in this repository
(landing pages, MC Stats dashboards, flasher, and future tools).

## Goals

- Keep EastMesh experiences visually consistent across products.
- Avoid accidental fallback to third-party defaults (for example, BeerCSS purple tokens).
- Make branding updates token-driven and easy to apply.
- Maintain readability and accessible contrast in dark-first interfaces.

## Brand Color Tokens

Use semantic tokens first, hex values second.

### Core Accent Palette

| Token | Value | Usage |
|---|---|---|
| `--accent-primary` | `#36a167` | Primary interactive color (buttons, focus borders, links) |
| `--accent-hover` | `#49c27d` | Hover state for primary interactive controls |
| `--accent-strong` | `#2f8f4e` | Stronger emphasis actions, selected tabs, active chips |
| `--accent-strong-hover` | `#3fae61` | Hover state for strong accent surfaces |

### Flasher Accent Tokens

The flasher UI keeps a local token set that should map to the same brand intent:

| Token | Value | Notes |
|---|---|---|
| `--flasher-accent` | `#36a167` | Mirrors EastMesh primary accent |
| `--flasher-accent-hover` | `#49c27d` | Mirrors EastMesh hover accent |

When a component library defines its own semantic tokens (for example, BeerCSS `--primary`),
remap those tokens to EastMesh tokens in the app shell/theme root.

## Surface & Text Language

EastMesh interfaces are dark-first and favor neutral backgrounds with green accents:

- Primary dark background around `#222222`.
- Layered containers around `#303030` and `#343434`.
- Primary text in high-contrast cool white (`#e6eaf0`-ish range).
- Secondary text with reduced emphasis (`#9aa4b2`-ish range).

### Contrast Guidance

- Ensure body text remains readable against dark backgrounds.
- Keep contrast high for active controls and focus rings.
- Do not use pure saturated green for long text passages; reserve it for UI emphasis.

## Interaction States

### Focus

Focus indicators are part of brand identity and must use EastMesh green tones:

- Focus border: EastMesh primary accent.
- Focus ring: transparentized EastMesh accent (tokenized shadow).
- Avoid default browser/library purple focus styles.

### Hover / Active / Selected

- Hover: `--accent-hover` (or local equivalent).
- Active/selected: `--accent-strong`.
- Keep state transitions subtle and fast (no flashy animations for data-heavy dashboards).

## Typography & Shape

- Prefer modern sans stacks already used in app surfaces (`Inter`, `Source Sans 3`, system fallback).
- Use medium radius components (8-12px) for inputs/cards/buttons.
- Preserve spacing rhythm (8px base multiples where possible).

## Implementation Rules

1. **Use tokens, not hardcoded colors** in components.
2. **Define cross-app semantic tokens** in shared styles (`static/css/material.css`) when possible.
3. **Override third-party theme tokens early** (e.g., `body.dark`) before component rules.
4. **Document one-off branding decisions** in this guide so they can be reused.

## Component Library Integration

### BeerCSS (Flasher)

BeerCSS dark mode defaults to purple `--primary`. To align with EastMesh:

- Override BeerCSS `--primary` token family in flasher theme scope.
- Keep values sourced from `--flasher-accent` variables.
- Validate focused input, select, button, and toggle states after updates.

### Material CSS (Dashboards)

Dashboard themes already use accent tokens in `static/css/material.css`.

- Reuse `--accent-*` and `--focus-ring` variables.
- Add new tokens centrally before page-level overrides.

## QA Checklist for Theme Changes

- [ ] Focus states are EastMesh green (not purple/blue defaults).
- [ ] Primary/hover/active colors match token values.
- [ ] Dark and light themes both retain accessible contrast.
- [ ] No new hardcoded hex colors were introduced when a token exists.
- [ ] Flasher, dashboards, and landing pages remain visually consistent.

## Maintenance

When adjusting brand colors or visual language:

1. Update this guide first.
2. Update shared tokens.
3. Update app-specific token bridges (for example, flasher BeerCSS overrides).
4. Note the change in PR description so downstream deployments can verify visuals quickly.
