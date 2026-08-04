# Control Center Grid Icon Contract

This document records the layout behavior measured in Raycast so future icon
changes do not repeat the same size and alignment regressions.

## What went wrong

Three different coordinate systems were initially treated as if they were the
same:

1. the Grid column box;
2. the visible rounded item tile;
3. the non-transparent artwork inside an image.

With an eight-column Control Center Grid, the observed column pitch is about
100 px while the visible rounded tile is about 91 px and anchored at the
column's top-left. Raycast centers `Grid.Item.content` in the larger column box,
not in the visible 91 px tile. A mathematically centered image therefore looks
about 4.5 px too far right and down inside the visible tile.

Using a built-in Raycast `Icon` did not solve this because Grid does not expose
a per-item icon-size prop. Built-in icons rendered too large. A transparent
template plus `Grid.Inset.Large` then applied two independent safe areas and
rendered far too small.

## Current geometry

The Control Center uses one shared contract:

- eight columns in every section;
- `Grid.Inset.Zero` because the assets already include their safe area;
- a 256 × 256 transparent PNG canvas;
- monochrome artwork tinted with `Color.PrimaryText` at runtime;
- maximum artwork dimension of 72 px;
- artwork optical center at `(116.5, 116.5)`, not the mathematical canvas
  center `(127.5, 127.5)`.

The compensated center follows the measured layout:

```text
116.5 / 256 × 100 ≈ 45.5
```

That is the center of the visible 91 px tile. The resulting artwork appears at
about 28 px in Raycast, providing a middle ground between the oversized native
Grid glyphs and the undersized double-inset version.

## Implementation rules

- Use `CONTROL_GRID_COLUMNS` and `CONTROL_GRID_INSET` from `src/utils/theme.ts`.
- Use `compactGridIcon()` for every Control Center tile.
- Do not pass built-in `Icon` values directly to `Grid.Item.content`.
- Do not add another inset or manually change an individual asset's padding.
- Do not restore semantic neon colors. Template assets must remain monochrome
  and use Raycast's theme-aware primary text tint.
- Avoid Grid accessories when the title and subtitle already communicate the
  state; they compete with truncated text in compact layouts.

## Verification

Run:

```bash
npm test
npm run build
npm run lint
```

`scripts/test-grid-icons.mjs` decodes every PNG and fails when its canvas,
maximum artwork size, or optical center changes. `scripts/test-ui-contract.mjs`
locks the shared column count, inset, icon source, and removal of the obsolete
hard-coded Quick Actions view.

Raycast can change its native Grid rendering in a future release. If a visual
regression appears after such an update, measure the column pitch and visible
tile bounds again, update this document and the contract test together, and
only then regenerate the entire icon set as one batch.
