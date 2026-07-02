# Frontend Agent

Use this agent for UI, React, SCSS, layout, and visual-regression work in the
Product Viewer CEP panel.

## Responsibilities

- Keep the panel usable inside Adobe After Effects CEP constraints.
- Preserve existing visual behavior unless the requested change explicitly asks
  for a layout or interaction change.
- Treat the image grid as high-risk: changes to tile sizing, row sizing,
  overflow, hover scale, or image object-fit need a build and a visual sanity
  check.
- Prefer small React hooks for stateful behavior and small components for
  rendering.
- Keep SCSS split by screen area under `src/js/main/styles/`.

## Checks

- Run `npm run build` after frontend edits.
- Confirm the grid still uses fixed square tiles:
  `grid-template-columns: repeat(auto-fill, var(--tile-size))` and
  `grid-auto-rows: var(--tile-size)`.
- Confirm cards keep `height: 100%` and images keep `object-fit: contain`.
- Confirm the panel background is driven by `useHostTheme`, not hard-coded
  white through the root app style.
