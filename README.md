
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
| Link rendering        | Filled ribbon (`sankeyLinkHorizontal`) | Stroked centerline (`sankeyLinkCircular`) — see below      |
| Acyclic output        | —                                  | **Byte-for-byte identical** (the original code path is reused)  |

Everything from the original API (`nodeId`, `nodeAlign`, `nodeSort`,
`nodeWidth`, `nodePadding`, `nodes`, `links`, `linkSort`, `size`, `extent`,
`iterations`) is preserved unchanged.

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

For normal (acyclic) links the centerline is the same cubic Bézier shape as
`d3.sankeyLinkHorizontal`, just stroked instead of filled — so the visual
result matches.

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
```

---

## `examples/circular.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>d3-sankey-circular — example</title>
<style>
  body { font: 12px sans-serif; margin: 20px; }
  .node rect { stroke: #000; stroke-opacity: 0.2; }
  .lane { stroke: #ddd; stroke-dasharray: 4 4; }
  svg { border: 1px solid #eee; }

  /* LINKS ARE STROKED, NOT FILLED. */
  .link {
    fill: none;
    stroke-linejoin: round;
    stroke-linecap: butt;
  }
  .link.normal   { stroke: #bbb; stroke-opacity: 0.5; }
  .link.circular { stroke: crimson; stroke-opacity: 0.45; }

  /* DEBUG OVERLAYS */
  .debug-centerline { fill: none; stroke: #0a0; stroke-width: 1; stroke-dasharray: 2 2; }
  .debug-corner     { fill: #06f; stroke: #fff; stroke-width: 0.5; }
  .debug-endpoint   { fill: #f0f; stroke: #fff; stroke-width: 0.5; }
  .debug-hidden     { display: none; }
</style>

<!--
  This example loads the library straight from source via ../src/index.js.
  d3 (for selections) and d3-array (used by the layout) come from a CDN.
-->
<script type="importmap">
{
  "imports": {
    "d3-array": "https://esm.sh/d3-array@3"
  }
}
</script>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
</head>

<body>
<h3>d3-sankey-circular — a → b → c → a, with a self-loop on b</h3>
<label><input type="checkbox" id="dbg" checked> show debug overlay</label>
<br>
<svg width="800" height="400"></svg>

<script type="module">
import { sankey, sankeyLinkCircular } from "../src/index.js";

const width = 800, height = 400;
const extent = [[10, 10], [width - 10, height - 10]];

const data = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }],
  links: [
    { source: "a", target: "b", value: 10 },
    { source: "b", target: "c", value: 8 },
    { source: "b", target: "d", value: 2 },
    { source: "c", target: "e", value: 8 },
    { source: "d", target: "e", value: 2 },
    { source: "e", target: "a", value: 4 },  // back-edge (routes top)
    { source: "c", target: "b", value: 3 },  // back-edge (short cycle)
    { source: "b", target: "b", value: 2 }   // self-loop
  ]
};

const s = sankey()
  .nodeId(d => d.id)
  .nodeWidth(20)
  .nodePadding(20)
  .extent(extent);

const graph = s(data);

// Quick sanity dump of the link layout.
console.table(graph.links.map(l => ({
  s: l.source.id,
  t: l.target.id,
  circular: l.circular,
  type: l.circularLinkType,
  y0: Math.round(l.y0),
  y1: Math.round(l.y1),
  w: Math.round(l.width)
})));

const linkPath = sankeyLinkCircular().debug(true);
const svg = d3.select("svg");

// --- Lane guides (visual reference for the node band edges) ---
const bandTop = Math.min(...graph.nodes.map(n => n.y0));
const bandBottom = Math.max(...graph.nodes.map(n => n.y1));

svg.append("line").attr("class", "lane")
  .attr("x1", extent[0][0]).attr("x2", extent[1][0])
  .attr("y1", bandTop).attr("y2", bandTop);

svg.append("line").attr("class", "lane")
  .attr("x1", extent[0][0]).attr("x2", extent[1][0])
  .attr("y1", bandBottom).attr("y2", bandBottom);

// --- Links (stroked centerlines) ---
const linkG = svg.append("g");
linkG.selectAll("path")
  .data(graph.links)
  .join("path")
    .attr("class", d => "link " + (d.circular ? "circular" : "normal"))
    .attr("d", linkPath)
    .attr("stroke-width", d => Math.max(1, d.width));

// --- Debug overlay: thin centerline + corner/endpoint markers ---
const dbgG = svg.append("g").attr("class", "debug");

dbgG.selectAll("path.debug-centerline")
  .data(graph.links)
  .join("path")
    .attr("class", "debug-centerline")
    .attr("d", linkPath);

const allPts = [];
for (const l of graph.links) {
  const pts = linkPath.points(l);
  pts.forEach((pt, i) => {
    const isEnd = (i === 0 || i === pts.length - 1);
    allPts.push({ x: pt.x, y: pt.y, isEnd, circular: l.circular });
  });
}

dbgG.selectAll("circle")
  .data(allPts)
  .join("circle")
    .attr("class", d => d.isEnd ? "debug-endpoint" : "debug-corner")
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r", d => d.isEnd ? 3 : 2.5);

d3.select("#dbg").on("change", function () {
  dbgG.classed("debug-hidden", !this.checked);
});

// --- Nodes ---
const node = svg.append("g").selectAll("g")
  .data(graph.nodes).join("g").attr("class", "node");

node.append("rect")
  .attr("x", d => d.x0).attr("y", d => d.y0)
  .attr("width", d => d.x1 - d.x0)
  .attr("height", d => Math.max(1, d.y1 - d.y0))
  .attr("fill", "#69b");

node.append("text")
  .attr("x", d => d.x0 - 6).attr("y", d => (d.y0 + d.y1) / 2)
  .attr("dy", "0.35em").attr("text-anchor", "end")
  .text(d => d.id);
</script>
</body>
</html>
```

---

## Notes on what I did

**README placeholders to replace:** `@yourname/d3-sankey-circular` (package name) and `(your name)` (copyright). I used a scoped name as we discussed in step 2 — swap in whatever you actually published.

**The example now lives in `examples/`** and imports from `../src/index.js` instead of `./src/index.js`, since it's one directory deeper than your old `test.html`. I also:
- Dropped the unused `d3-shape` / `d3-path` importmap entries (your code doesn't use them — `sankeyLinkCircular` builds path strings by hand).
- Changed the heading to mention the self-loop, which the data actually contains.
- Added explanatory comments at the two **REQUIRED** spots (`fill: none` and `stroke-width`) since that's the #1 thing a new user will get wrong.

**One thing to verify:** the README's API reference assumes you kept `link.points`, `link.debug`, and the `graph.circularReservation` shape exactly as in your original. If your step-7 cleanup (removing the dead `link.extent`/`link.circularGap` stubs) or step-4 module-scope extraction changed any field names on `circularReservation` or `circularPathData`, grep the README for those names and reconcile. The fields I documented: `top, bottom, gutter, gap, topStack, bottomStack` and `points, radius, type, selfLoop, laneY, sourceX, targetX, sourceY, targetY`.

Want me to also add a short **CHANGELOG.md** and a **"Differences that could surprise upstream users"** section, or are you good to commit step 9?