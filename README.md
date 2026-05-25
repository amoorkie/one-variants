# One Variants

Figma plugin for merging duplicate component variants into one canonical source.

## What it does

1. Select a component set or 2+ variants inside one component set.
2. Review the generated preview thumbnail for each variant and choose which variant is canonical.
3. Run a dry-run scan for instances that still point to duplicate variants.
4. Apply the merge: duplicate-variant instances are swapped to the canonical variant, and selected duplicate variants are visually synced to the canonical variant by default.
5. Optionally remove duplicate variants after an all-pages scan.

The plugin is intentionally explicit. It does not silently delete variants or choose a canonical variant without review. If no external instances are found, the default source-variant sync still updates the selected duplicate variants so their previews change in the list.

## Community assets

Figma Community listing assets are in `assets/community/`:

- `icon-128.png` - plugin icon, 128 x 128.
- `thumbnail-1920x1080.png` - main listing thumbnail.
- `screenshot-01-select-by-preview.png` - preview-first selection.
- `screenshot-02-pick-canonical.png` - canonical variant selection.
- `screenshot-03-merge-result.png` - apply result summary.
- `screenshot-04-clean-set.png` - duplicate cleanup state.

## Build

```bash
npm install
npm run verify
```

Import `manifest.json` as a Figma development plugin.

## Publish checklist

1. Run `npm run verify`.
2. Import `manifest.json` in Figma and smoke-test the merge on a copied component set.
3. Upload `assets/community/icon-128.png` as the icon.
4. Upload `assets/community/thumbnail-1920x1080.png` plus the screenshot images as listing media.
