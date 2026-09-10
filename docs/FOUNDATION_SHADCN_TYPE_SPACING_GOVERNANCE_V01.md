# Foundation shadcn content-role governance V01

This contract makes shadcn/ui's Base UI `base-nova` registry, Tailwind v4 utilities, CSS variables, and Lucide the UI authority for the Foundation management center and `foundation-events`.

## Content roles

| Content role | Required composition |
| --- | --- |
| Page-level title | `text-2xl font-semibold leading-snug`; Chinese and mixed-script titles do not use negative tracking by default |
| Primary panel, Card, or Dialog title | `text-xl font-medium leading-snug` |
| Region or section title | `text-lg font-medium leading-snug` |
| Important body copy and strong information | `text-base leading-relaxed` |
| Default UI, Tabs, Button, Select, Tree, Menu, Sidebar, and Input | `text-sm font-normal`; local shadcn primitives own control variants |
| Supporting descriptions | `text-xs leading-relaxed text-muted-foreground` |
| Status and machine metadata | `text-xs leading-normal text-muted-foreground` |
| Raw identifiers, routes, and code | `font-mono text-xs leading-normal` |

These are Tailwind v4 utilities and their generated shadcn theme variables (`--text-xs` through `--text-2xl`). Product CSS and feature code must not declare pixel font sizes, arbitrary `text-[…]` classes, local font-size variables, or page-level `--space-*` aliases.

## Cross-platform font policy 023

For new Foundation projects, the Tailwind v4 `@theme` / `@theme inline` `--font-sans` variable is the only normal UI font-family authority:

```css
--font-sans: "Geist Variable", "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif;
```

The base stack above is the safe fallback. Before React mounts, Foundation writes a read-only `data-font-platform` marker from the browser platform and keeps `--font-sans: var(--foundation-font-sans)` as the single Tailwind authority. Windows and macOS both prefer PingFang SC for Simplified Chinese when it is locally available; Windows then falls back to Microsoft YaHei UI / Microsoft YaHei. The marker changes candidate order only; it is independent from `.dark`, stores no user data, and does not inspect or install fonts.

- Foundation packages Geist Variable once under its existing OFL-1.1 dependency for Latin letters and digits. It does not add a second `@font-face`, remote font request, or font CDN.
- macOS Simplified Chinese falls through to the locally installed PingFang SC. Windows Simplified Chinese first tries locally installed PingFang SC, then Microsoft YaHei UI or Microsoft YaHei. Foundation references those family names but never copies, embeds, installs, or redistributes Apple or Microsoft font files.
- `html lang="zh-CN"`, `font-sans`, and normal inheritance keep body text, form controls, and local shadcn primitives on the same family contract. `.dark` changes color tokens only and never introduces another font stack.
- Chinese or mixed-script titles do not receive `tracking-tight` by default. `leading-none` is reserved for proven single-line internals; wrapping titles use `leading-snug`, body copy uses `leading-relaxed`, and compact metadata uses `leading-normal`.
- Proportional numerals remain the default. `tabular-nums` is allowed only in a named data composition or aligned amount/metric column, never on `html`, `body`, a page shell, or all controls.
- Existing projects remain `preserve-and-inventory`. Adoption requires inventory of the project's existing family, glyph coverage, primitives, content roles, and specialist engines; 023 does not silently replace a mature design system.

## Spacing roles

| Content role | Required composition |
| --- | --- |
| Page or primary detail shell | `p-6` and `gap-6` |
| Panel, card, dialog, inspector shell | shadcn component defaults or `p-4` and `gap-4` |
| Field, list, toolbar, and action group | `gap-2` |
| Micro metadata and tightly related labels | `gap-1` |

Raw pixel spacing and arbitrary spacing utilities are not accepted in product content. Tailwind's canonical scale is the only general spacing scale.

## Approved geometry exceptions

The following values describe runtime geometry rather than content spacing and may remain explicit when a Tailwind utility cannot express the contract:

- React Flow node dimensions, handles, edge labels, thumbnail transforms, and canvas grid geometry.
- The floating panel's persisted position, width, height, independent edge resize hit areas, drag strip, and collapsed control position.
- The preview iframe's runtime device width and height, canvas frame, thumbnail iframe, and asset-preview viewport.
- Workspace top bar, toolbar, status bar, docked-panel minimum width, breakpoint, and minimum application viewport dimensions.

These exceptions must stay named by their business or engine role. They must not be generalized into a replacement `--space-*` or local typography scale.

## 020R1 universal application policy

The machine-readable authority is `packages/core/ui-policy.mjs`. It applies to Foundation-created projects without importing Management Center layout decisions:

- New projects use `shadcn-first`. When no visual direction is specified, the installed project preset is the default.
- Existing projects use `preserve-and-inventory` and are classified as existing shadcn, mature non-shadcn, unstable UI, or specialist-engine projects before modification.
- Composition order is existing local shadcn components, built-in variants, then documented custom UI.
- Page layout may arrange primitives externally but must not redefine primitive typography, semantic colors, or internal spacing.
- Custom UI requires a missing suitable primitive or variant, a bounded documented reason, affected locations, and verification evidence.
- Dependency upgrades require explicit task authorization.

Product-specific experience decisions are not universal policy. The Management Center profile lives in `apps/management-center/src/foundation-ui-profile.mjs`; React Flow is registered there as a specialist engine whose nodes, handles, edges, labels, background, controls, typography, and internal spacing keep their own engine contract. Ordinary controls around that engine remain shadcn-owned.
