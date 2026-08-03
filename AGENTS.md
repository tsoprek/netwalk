# ConneCat standalone parity contract

## Relationship to production

This repository is the cleaned, standalone edition of the production Catwalk client. The production visual source of truth is:

- `~/new-ce-lab/ce-lab-catwalk/client`
- This may also be referred to as `~/new-ce-lab/catwalk/client` in requests and older notes.

ConneCat removes broker, enrollment, remote synchronization, and other hosted-only dependencies. It keeps local equivalents where appropriate. Those architectural removals do not authorize a redesign.

## Visual parity is required

All shared screens must remain visually and behaviorally 1:1 with the production client: layout, DOM hierarchy, pane geometry, spacing, typography, borders, controls, responsive behavior, interaction states, and theme behavior.

Before changing any shared UI:

1. Inspect the corresponding production component and every relevant rule in the production `src/styles.css`.
2. Port the production structure and styles first.
3. Remove or replace only code that requires hosted services; do not simplify the surrounding UI.
4. Treat screenshots as supporting evidence and the production source as the implementation reference.
5. Compare both clients at the same viewport, color scheme, workspace design, content zoom, and data state.

The intentional product differences are the ConneCat name/logo, standalone status copy, and features that fundamentally require removed hosted services. Preserve production wording and visuals everywhere else unless the request explicitly changes them.

## Themes

Production theme IDs and exact Light, Medium, and Dark palette values are a compatibility contract. Do not rename themes, substitute approximate colors, or synthesize a scheme when production provides an explicit palette. The standalone palette mirror lives in `src/theme/productionThemeSchemes.ts`; keep it synchronized with production site configuration.

When modifying appearance code, verify at least Light, Medium, and Dark for every affected theme. A theme is not visually compatible if only its default scheme matches.

## Validation

For shared UI work, run the relevant tests and production build, then perform a side-by-side visual check against the production client. For native changes, also run `cargo fmt --check`, `cargo check`, and the relevant Rust tests.
