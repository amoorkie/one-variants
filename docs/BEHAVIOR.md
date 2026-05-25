# Behavior

## Main flow

- If the selection contains a `COMPONENT_SET`, the plugin lists all variants in that set.
- If the selection contains variants from the same `COMPONENT_SET`, those variants are preselected as the merge group.
- The first selected variant becomes the initial canonical variant, but the user can change it.
- Each variant card includes a PNG preview exported from the source variant, so merge decisions can be made visually instead of by variant names only.
- `Analyze` counts target instances and reports paths. If source-variant sync is enabled, the report also says that selected variants will be updated on apply.
- `Apply` recomputes the plan, swaps target instances with `instance.swapComponent(canonical)`, syncs selected duplicate variants to the canonical visual structure by default, refreshes the variant list, and reports success/failure.
- Source-variant sync preserves each duplicate variant's name and canvas position, but replaces its root visual/layout properties and children with clones from the canonical variant. This makes the preview update even when external instance count is `0`.

## Deleting duplicate variants

Deleting variants is allowed only with `All pages` scope. This avoids deleting a source variant while instances outside the scanned scope still point to it.

## Detection

Structural duplicate groups are helper suggestions. They compare size, common visual properties, and child tree summaries. They are not treated as proof because plugin code cannot reliably do pixel-level visual comparison.
