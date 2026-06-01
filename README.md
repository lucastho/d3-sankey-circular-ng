
# d3-sankey-circular

A fork of [d3-sankey](https://github.com/d3/d3-sankey) that adds support for
**circular links** (back-edges and self-loops).

When a graph is acyclic, this fork behaves **exactly** like the original
d3-sankey — same layout, same output, no extra fields written. Circular support
only activates when the graph actually contains a cycle.

This fork also ships a new link generator, `sankeyLinkCircular`, which renders
links as **stroked centerlines** rather than filled ribbons. The visible
thickness of a link comes entirely from `stroke-width`, which makes circular
routing dramatically simpler to compute and draw.

> Fork of [d3/d3-sankey](https://github.com/d3/d3-sankey) (ISC).
> Original work © Mike Bostock. Circular-link additions © (your name).
>Circularity concepts from Tom Shanley's d3-sankey-circular (https://observablehq.com/@tomshanley/sankey-circular-deconstructed) onto the modern codebase.
> Mostly produced by Claude


## Installing

```bash
npm install @yourname/d3-sankey-circular
```

```js
import { sankey, sankeyLinkCircular } from "@yourname/d3-sankey-circular";
```

In a browser via importmap (see [`examples/`](./examples)):

```html
<script type="module">
  import { sankey, sankeyLinkCircular } from "@yourname/d3-sankey-circular";
</script>
```

## What's different from d3-sankey

| Concern               | d3-sankey                          | this fork                                                        |
| --------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Cyclic graphs         | Throws `"circular link"`           | Detects back-edges and routes them as loops                     |
| Self-loops (`a → a`)  | Not supported                      | Supported                                                       |
| Link rendering        | Filled ribbon (`sankeyLinkHorizontal`) | Stroked centerline (`sankeyLinkCircular`) — replaces the ribbon generator |
| Acyclic output        | —                                  | **Byte-for-byte identical** (the original code path is reused)  |

Everything from the original API (`nodeId`, `nodeAlign`, `nodeSort`,
`nodeWidth`, `nodePadding`, `nodes`, `links`, `linkSort`, `size`, `extent`,
`iterations`) is preserved unchanged.

## Migrating from d3-sankey

This fork **does not export `sankeyLinkHorizontal`**. Use `sankeyLinkCircular`
for all links — it renders normal links as stroked centerlines with the same
shape. Remember the [stroked-centerline rendering model](#rendering-model-stroked-centerlines):
set `fill: none` and `stroke-width` on your links.




## Rendering model: stroked centerlines

This is the most important thing to understand before using the library.

`sankeyLinkCircular` returns an SVG path string describing the **centerline** of
each link — a single line down the middle of the ribbon, not the ribbon's
outline. You give that line its thickness with CSS/SVG:

```css
.link {
  fill: none;               /* REQUIRED — there is no ribbon to fill */
  stroke-linejoin: round;
  stroke-linecap: butt;
}
```

```js
svg.append("g")
  .selectAll("path")
  .data(graph.links)
  .join("path")
    .attr("class", d => d.circular ? "link circular" : "link normal")
    .attr("d", linkPath)
    .attr("stroke-width", d => Math.max(1, d.width)); // REQUIRED
```

If you forget `fill: none` or `stroke-width`, your links will render as solid
black blobs or hairlines. This differs from upstream d3-sankey, where you fill a
closed ribbon path and never set `stroke-width`.

For normal (acyclic) links the centerline is the same cubic Bézier *shape*
as upstream d3-sankey's `sankeyLinkHorizontal`, just stroked instead of
filled — so the visual result matches. (This fork does not export
`sankeyLinkHorizontal` itself; `sankeyLinkCircular` handles both normal and
circular links.)


## API reference (additions)

### Layout output

When the input graph contains at least one cycle, `sankey(graph)` writes these
extra fields:

**On each circular link:**

- `link.circular` — `true` for back-edges and self-loops, `false` otherwise.
  (Set to `false` on every link for acyclic graphs.)
- `link.circularLinkType` — `"top"` or `"bottom"`, the side the loop is routed
  on.
- `link.circularPathData` — the geometry consumed by `sankeyLinkCircular`:

  ```
  {
    points: [{x, y}, ...],  // centerline vertices (source → ... → target)
    radius,                 // corner-fillet radius
    type,                   // "top" | "bottom"
    selfLoop,               // boolean
    laneY,                  // the horizontal lane the loop runs along
    sourceX, targetX, sourceY, targetY
  }
  ```

**On the graph:**

- `graph.circularReservation` — the vertical/horizontal space reserved inside
  the extent for loop routing:

  ```
  {
    top,         // px reserved above the node band for "top" loops
    bottom,      // px reserved below the node band for "bottom" loops
    gutter,      // px reserved left/right so out-and-around curves don't clip
    gap,         // spacing between stacked loops
    topStack,    // links routed on top, in stacking order
    bottomStack  // links routed on bottom, in stacking order
  }
  ```

For acyclic graphs neither `graph.circularReservation` nor the circular link
fields are written.

### `sankeyLinkCircular()`

Constructs a link path generator for use with the layout above.

- **`linkPath(link)`** — returns the SVG path `d` string for a link. Dispatches
  to a circular or normal centerline automatically based on `link.circular`.

- **`linkPath.points(link)`** — returns the array of `{x, y}` vertices for a
  link. Useful for debug overlays (drawing corner/endpoint markers). For normal
  links this is the two endpoints; for circular links it's
  `link.circularPathData.points`.

- **`linkPath.debug([boolean])`** — get/set a debug flag. With no arguments,
  returns the current flag; with an argument, sets it and returns the generator.

## How the circular layout works

A short tour, in case you need to extend it:

1. **Detect cycles.** A DFS tags every back-edge (and self-loop) as
   `link.circular`. Ignoring those links, the remaining graph is a DAG, so the
   original depth/height/breadth passes run unmodified (they just skip circular
   links).

2. **Phase 1 — measure.** Run the standard acyclic layout in the *full* extent.
   This is a throwaway pass whose only purpose is to learn each link's `width`
   and each node's `y` position. Those tell us how thick each loop lane must be
   and whether a loop should route over the top or under the bottom.

3. **Reserve space.** Sum the loop widths (plus gaps) on each side to compute how
   much vertical room the loops need, and reserve left/right gutters so the
   out-and-around bends don't clip the extent — all *inside* the user's extent,
   so there's no new sizing API.

4. **Phase 2 — final layout.** Re-run the same layout confined to the shrunken
   band. The routing side decided in phase 1 stays frozen so the reservation
   can't oscillate against a re-decided route.

5. **Path data.** Build each loop's centerline: out the source's right face, up
   (or down) into its lane, across, and back down (or up) into the target's left
   face, with rounded corners.

If the graph is acyclic, only step 1 (which finds nothing) and the standard
layout run.

## Examples

See [`examples/circular.html`](./examples/circular.html) for a runnable demo
with a debug overlay (centerline, corner markers, and lane guides).

## License

ISC. See [`LICENSE`](./LICENSE). Original d3-sankey © Mike Bostock; circular
additions © (your name).

