import {max, min, sum} from "d3-array";
import {justify} from "./align.js";
import constant from "./constant.js";

function ascendingSourceBreadth(a, b) {
  return ascendingBreadth(a.source, b.source) || a.index - b.index;
}

function ascendingTargetBreadth(a, b) {
  return ascendingBreadth(a.target, b.target) || a.index - b.index;
}

function ascendingBreadth(a, b) {
  return a.y0 - b.y0;
}

function value(d) {
  return d.value;
}

function defaultId(d) {
  return d.index;
}

function defaultNodes(graph) {
  return graph.nodes;
}

function defaultLinks(graph) {
  return graph.links;
}

function find(nodeById, id) {
  const node = nodeById.get(id);
  if (!node) throw new Error("missing: " + id);
  return node;
}

function computeLinkBreadths({nodes}) {
  for (const node of nodes) {
    let y0 = node.y0;
    let y1 = y0;
    for (const link of node.sourceLinks) {
      link.y0 = y0 + link.width / 2;
      y0 += link.width;
    }
    for (const link of node.targetLinks) {
      link.y1 = y1 + link.width / 2;
      y1 += link.width;
    }
  }
}

export default function Sankey() {
  let x0 = 0, y0 = 0, x1 = 1, y1 = 1; // extent
  let dx = 24; // nodeWidth
  let dy = 8, py; // nodePadding
  let id = defaultId;
  let align = justify;
  let sort;
  let linkSort;
  let nodes = defaultNodes;
  let links = defaultLinks;
  let iterations = 6;

  function sankey() {
    const graph = {nodes: nodes.apply(null, arguments), links: links.apply(null, arguments)};
    computeNodeLinks(graph);
    identifyCircles(graph);
    computeNodeValues(graph);
    computeNodeDepths(graph);
    computeNodeHeights(graph);

    // Does this graph contain any back-edges? If not, everything below behaves
    // EXACTLY as the original acyclic d3-sankey — reservation is zero, no extra
    // layout pass runs, and circular-only fields are never written. This is the
    // zero-regression guarantee.
    const hasCircular = graph.links.some(l => l.circular);

    if (!hasCircular) {
      // ---- ACYCLIC FAST PATH (unchanged original behavior) ----
      computeNodeBreadths(graph);
      computeLinkBreadths(graph);
      return graph;
    }

    // ---- CIRCULAR PATH (two-phase layout) ----
    //
    // PHASE 1: lay out into the FULL extent to discover link widths and node
    // y-positions. We need widths to know how thick each loop lane must be, and
    // we need y-positions to decide top/bottom routing. Nothing here is kept as
    // final geometry — it's purely a measurement pass.
    computeNodeBreadths(graph);
    computeLinkBreadths(graph);
    selectCircularLinkTypes(graph);   // freezes link.circularLinkType using phase-1 y's

    // -------------------------------------------------------------------------
  // CIRCULAR LAYOUT
  //
  // The acyclic layout fills the entire [y0,y1] x [x0,x1] extent with nodes
  // and forward ribbons, leaving no room for back-edges. To draw a back-edge
  // we route it OUT of the source's right side, UP (or DOWN) into a horizontal
  // "lane" stacked outside the node band, ACROSS, then back DOWN (or UP) into
  // the target's left side.
  //
  // To make room without changing the user's extent (zero new API), we reserve
  // space *inside* the extent: a vertical band at the top for "top" loops, one
  // at the bottom for "bottom" loops, and left/right horizontal gutters so the
  // out-and-around curves never clip the edges.
  // -------------------------------------------------------------------------

  // Gap between adjacent stacked loops, and gap between the node band and the
  // first lane. Kept proportional to nodePadding so it scales sensibly.
  function circularGap() {
    return Math.max(dy, 4);
  }

  function computeCircularReservation(graph) {
    const gap = circularGap();
    const top = [], bottom = [];
    for (const link of graph.links) {
      if (!link.circular) continue;
      (link.circularLinkType === "top" ? top : bottom).push(link);
    }
    top.sort((a, b) => b.width - a.width);
    bottom.sort((a, b) => b.width - a.width);

    // Assign each loop a stack index (0 = closest to node band) on its side and
    // remember it for computeCircularPathData. Total reserved height per side =
    // sum of loop widths + gaps between them + one gap to the node band.
    function reserve(stack) {
      let h = stack.length ? gap : 0;
      stack.forEach((link, i) => {
        link.circularLaneIndex = i;
        h += link.width + (i > 0 ? gap : 0);
      });
      return h;
    }
    const maxLoopHalfWidth = Math.max(0, ...graph.links
  .filter(l => l.circular).map(l => l.width / 2));
    const gutter = Math.min(
      Math.max(dx * 1.5, maxLoopHalfWidth + dx),   // ensure room for the fattest loop's bend
      (x1 - x0) * 0.15
    );
    
    return {
      top: reserve(top),
      bottom: reserve(bottom),
      gutter,
      topStack: top,
      bottomStack: bottom,
      gap
    };
  }


    function computeCircularPathData(graph, reservation) {
    const { gap } = reservation;

    // Anchor lanes to ACTUAL final node positions.
    const bandTop = Math.min(...graph.nodes.map(n => n.y0));
    const bandBottom = Math.max(...graph.nodes.map(n => n.y1));

        function place(stack, side) {
      const edge = side === "top" ? bandTop : bandBottom;
      let cursor = gap;

      stack.forEach(link => {
        const w = link.width;

        // Lane centerline Y, stacked outward from the band edge.
        const laneY = side === "top"
          ? edge - cursor - w / 2
          : edge + cursor + w / 2;
        cursor += w + gap;

        const sourceX = link.source.x1;
        const targetX = link.target.x0;
        const sourceY = link.y0;
        const targetY = link.y1;

        const minTurn = Math.max(3 * w, gap);
        const turnOut = Math.max(minTurn, reservation.gutter * 0.6);

        const rightX = sourceX + turnOut;
        const leftX  = targetX - turnOut;

        // ---- Determine the lane Y with a GUARANTEED minimum vertical rise.
        // The fillet at each corner needs the adjacent segment to be at least
        // 2*radius long, and radius itself depends on the rise. Break the
        // chicken/egg by reserving a fixed minimum rise based on width+gap,
        // then pushing the lane OUTWARD (never inward) to honor it.
        const isSelf = link.source === link.target;

        // For clearance we measure against the relevant node face(s).
        const clearRef = side === "top"
          ? (isSelf ? link.source.y0 : Math.min(sourceY, targetY))
          : (isSelf ? link.source.y1 : Math.max(sourceY, targetY));

        // Minimum rise from the endpoints to the lane.
        const minRise = 2.5 * w + gap;

        let vY;
        if (side === "top") {
          // lane must be ABOVE both endpoints by at least minRise, and also
          // not deeper into the band than its stacked laneY.
          vY = Math.min(laneY, clearRef - minRise);
          // but never let it get CLOSER than minRise to the nearest endpoint
          vY = Math.min(vY, Math.min(sourceY, targetY) - minRise);
        } else {
          vY = Math.max(laneY, clearRef + minRise);
          vY = Math.max(vY, Math.max(sourceY, targetY) + minRise);
        }

        const points = [
          { x: sourceX, y: sourceY },   // 0: leave source face
          { x: rightX,  y: sourceY },   // 1: turn up/down
          { x: rightX,  y: vY },        // 2: into lane
          { x: leftX,   y: vY },        // 3: across
          { x: leftX,   y: targetY },   // 4: turn back
          { x: targetX, y: targetY }    // 5: enter target face
        ];

        // Radius is bounded by the SHORTEST adjacent segment / 2 so no corner
        // collapses. The shortest verticals are the source/target rises.
        const riseSrc = Math.abs(vY - sourceY);
        const riseTgt = Math.abs(vY - targetY);
        const acrossLen = Math.abs(leftX - rightX);
        const radius = Math.max(2, Math.min(
          reservation.gutter * 0.5,
          w * 1.5 + gap,
          riseSrc / 2,
          riseTgt / 2,
          acrossLen / 2,
          turnOut / 2
        ));

        link.circularPathData = {
          points,
          radius,
          type: side,
          selfLoop: isSelf,
          laneY: vY,
          sourceX, targetX, sourceY, targetY
        };
      });
    }

    place(reservation.topStack, "top");
    place(reservation.bottomStack, "bottom");
  }










    // Measure how much vertical room the loops need on each side, then shrink the
    // usable node band by that amount. computeCircularReservation also reserves
    // horizontal gutters so the out-and-around curves don't clip the extent.
    const reservation = computeCircularReservation(graph);
    
    graph.circularReservation = reservation;


    // PHASE 2: re-run the layout inside the shrunk band. Because every breadth
    // function reads the closure y0/y1, temporarily reassigning them is all it
    // takes to confine nodes to the reduced area — no other code changes needed.
    const savedY0 = y0, savedY1 = y1;
    y0 = savedY0 + reservation.top;
    y1 = savedY1 - reservation.bottom;
    const savedX0 = x0, savedX1 = x1;
    x0 = savedX0 + reservation.gutter;
    x1 = savedX1 - reservation.gutter;

    computeNodeBreadths(graph);
    computeLinkBreadths(graph);
    x0 = savedX0; x1 = savedX1;
    y0 = savedY0;
    y1 = savedY1;
    // NOTE: circularLinkType stays FROZEN from phase 1 (decision #2) so the
    // reservation we just applied can't oscillate against a re-decided routing.

    // Now compute the final per-loop geometry (lane stacking, curve control
    // points) using the phase-2 node positions and the reserved lanes.
    computeCircularPathData(graph, reservation);

    return graph;
  }

  sankey.nodeId = function(_) {
    return arguments.length ? (id = typeof _ === "function" ? _ : constant(_), sankey) : id;
  };

  sankey.nodeAlign = function(_) {
    return arguments.length ? (align = typeof _ === "function" ? _ : constant(_), sankey) : align;
  };

  sankey.nodeSort = function(_) {
    return arguments.length ? (sort = _, sankey) : sort;
  };

  sankey.nodeWidth = function(_) {
    return arguments.length ? (dx = +_, sankey) : dx;
  };

  sankey.nodePadding = function(_) {
    return arguments.length ? (dy = py = +_, sankey) : dy;
  };

  sankey.nodes = function(_) {
    return arguments.length ? (nodes = typeof _ === "function" ? _ : constant(_), sankey) : nodes;
  };

  sankey.links = function(_) {
    return arguments.length ? (links = typeof _ === "function" ? _ : constant(_), sankey) : links;
  };

  sankey.linkSort = function(_) {
    return arguments.length ? (linkSort = _, sankey) : linkSort;
  };

  sankey.size = function(_) {
    return arguments.length ? (x0 = y0 = 0, x1 = +_[0], y1 = +_[1], sankey) : [x1 - x0, y1 - y0];
  };

  sankey.extent = function(_) {
    return arguments.length ? (x0 = +_[0][0], x1 = +_[1][0], y0 = +_[0][1], y1 = +_[1][1], sankey) : [[x0, y0], [x1, y1]];
  };

  sankey.iterations = function(_) {
    return arguments.length ? (iterations = +_, sankey) : iterations;
  };

  function computeNodeLinks({nodes, links}) {
    for (const [i, node] of nodes.entries()) {
      node.index = i;
      node.sourceLinks = [];
      node.targetLinks = [];
    }
    const nodeById = new Map(nodes.map((d, i) => [id(d, i, nodes), d]));
    for (const [i, link] of links.entries()) {
      link.index = i;
      let {source, target} = link;
      if (typeof source !== "object") source = link.source = find(nodeById, source);
      if (typeof target !== "object") target = link.target = find(nodeById, target);
      source.sourceLinks.push(link);
      target.targetLinks.push(link);
    }
    if (linkSort != null) {
      for (const {sourceLinks, targetLinks} of nodes) {
        sourceLinks.sort(linkSort);
        targetLinks.sort(linkSort);
      }
    }
  }

  function computeNodeValues({nodes}) {
    for (const node of nodes) {
      node.value = node.fixedValue === undefined
          ? Math.max(sum(node.sourceLinks, value), sum(node.targetLinks, value))
          : node.fixedValue;
    }
  }

  // Tag links that close a cycle (back-edges) via DFS.
  // After this, ignoring link.circular links makes the graph a DAG.
    function identifyCircles({nodes, links}) {
    for (const link of links) link.circular = false;

    const visited = new Set();
    const inStack = new Set();

    function dfs(node) {
      if (visited.has(node)) return;
      inStack.add(node);
      for (const link of node.sourceLinks) {
        if (link.target === node) {
          link.circular = true;          // ← self-loop: a → a
        } else if (inStack.has(link.target)) {
          link.circular = true;          // ordinary back-edge
        } else if (!visited.has(link.target)) {
          dfs(link.target);
        }
      }
      inStack.delete(node);
      visited.add(node);
    }

    for (const node of nodes) {
      if (!visited.has(node)) dfs(node);
    }
  }


  function computeNodeDepths({nodes}) {
    const n = nodes.length;
    let current = new Set(nodes);
    let next = new Set;
    let x = 0;
    while (current.size) {
      for (const node of current) {
        node.depth = x;
        for (const link of node.sourceLinks) {
          if (link.circular) continue;       // ← skip back-edges
          next.add(link.target);
        }
      }
      if (++x > n) throw new Error("circular link");  // now a real safety net
      current = next;
      next = new Set;
    }
  }

  function computeNodeHeights({nodes}) {
    const n = nodes.length;
    let current = new Set(nodes);
    let next = new Set;
    let x = 0;
    while (current.size) {
      for (const node of current) {
        node.height = x;
        for (const link of node.targetLinks) {
          if (link.circular) continue;       // ← skip back-edges
          next.add(link.source);
        }
      }
      if (++x > n) throw new Error("circular link");
      current = next;
      next = new Set;
    }
  }

  function computeNodeLayers({nodes}) {
    const x = max(nodes, d => d.depth) + 1;
    const kx = (x1 - x0 - dx) / (x - 1);
    const columns = new Array(x);
    for (const node of nodes) {
      const i = Math.max(0, Math.min(x - 1, Math.floor(align.call(null, node, x))));
      node.layer = i;
      node.x0 = x0 + i * kx;
      node.x1 = node.x0 + dx;
      if (columns[i]) columns[i].push(node);
      else columns[i] = [node];
    }
    if (sort) for (const column of columns) {
      column.sort(sort);
    }
    return columns;
  }

  function initializeNodeBreadths(columns) {
    const ky = min(columns, c => (y1 - y0 - (c.length - 1) * py) / sum(c, value));
    for (const nodes of columns) {
      let y = y0;
      for (const node of nodes) {
        node.y0 = y;
        node.y1 = y + node.value * ky;
        y = node.y1 + py;
        for (const link of node.sourceLinks) {
          link.width = link.value * ky;
        }
      }
      y = (y1 - y + py) / (nodes.length + 1);
      for (let i = 0; i < nodes.length; ++i) {
        const node = nodes[i];
        node.y0 += y * (i + 1);
        node.y1 += y * (i + 1);
      }
      reorderLinks(nodes);
    }
  }

  function computeNodeBreadths(graph) {
    const columns = computeNodeLayers(graph);
    py = Math.min(dy, (y1 - y0) / (max(columns, c => c.length) - 1));
    initializeNodeBreadths(columns);
    for (let i = 0; i < iterations; ++i) {
      const alpha = Math.pow(0.99, i);
      const beta = Math.max(1 - alpha, (i + 1) / iterations);
      relaxRightToLeft(columns, alpha, beta);
      relaxLeftToRight(columns, alpha, beta);
    }
  }

  // Reposition each node based on its incoming (target) links.
  function relaxLeftToRight(columns, alpha, beta) {
    for (let i = 1, n = columns.length; i < n; ++i) {
      const column = columns[i];
      for (const target of column) {
        let y = 0;
        let w = 0;
        for (const {source, value} of target.targetLinks) {
          let v = value * (target.layer - source.layer);
          y += targetTop(source, target) * v;
          w += v;
        }
        if (!(w > 0)) continue;
        let dy = (y / w - target.y0) * alpha;
        target.y0 += dy;
        target.y1 += dy;
        reorderNodeLinks(target);
      }
      if (sort === undefined) column.sort(ascendingBreadth);
      resolveCollisions(column, beta);
    }
  }

  // Reposition each node based on its outgoing (source) links.
  function relaxRightToLeft(columns, alpha, beta) {
    for (let n = columns.length, i = n - 2; i >= 0; --i) {
      const column = columns[i];
      for (const source of column) {
        let y = 0;
        let w = 0;
        for (const {target, value} of source.sourceLinks) {
          let v = value * (target.layer - source.layer);
          y += sourceTop(source, target) * v;
          w += v;
        }
        if (!(w > 0)) continue;
        let dy = (y / w - source.y0) * alpha;
        source.y0 += dy;
        source.y1 += dy;
        reorderNodeLinks(source);
      }
      if (sort === undefined) column.sort(ascendingBreadth);
      resolveCollisions(column, beta);
    }
  }

  function resolveCollisions(nodes, alpha) {
    const i = nodes.length >> 1;
    const subject = nodes[i];
    resolveCollisionsBottomToTop(nodes, subject.y0 - py, i - 1, alpha);
    resolveCollisionsTopToBottom(nodes, subject.y1 + py, i + 1, alpha);
    resolveCollisionsBottomToTop(nodes, y1, nodes.length - 1, alpha);
    resolveCollisionsTopToBottom(nodes, y0, 0, alpha);
  }

  // Push any overlapping nodes down.
  function resolveCollisionsTopToBottom(nodes, y, i, alpha) {
    for (; i < nodes.length; ++i) {
      const node = nodes[i];
      const dy = (y - node.y0) * alpha;
      if (dy > 1e-6) node.y0 += dy, node.y1 += dy;
      y = node.y1 + py;
    }
  }

  // Push any overlapping nodes up.
  function resolveCollisionsBottomToTop(nodes, y, i, alpha) {
    for (; i >= 0; --i) {
      const node = nodes[i];
      const dy = (node.y1 - y) * alpha;
      if (dy > 1e-6) node.y0 -= dy, node.y1 -= dy;
      y = node.y0 - py;
    }
  }

  function reorderNodeLinks({sourceLinks, targetLinks}) {
    if (linkSort === undefined) {
      for (const {source: {sourceLinks}} of targetLinks) {
        sourceLinks.sort(ascendingTargetBreadth);
      }
      for (const {target: {targetLinks}} of sourceLinks) {
        targetLinks.sort(ascendingSourceBreadth);
      }
    }
  }

  function reorderLinks(nodes) {
    if (linkSort === undefined) {
      for (const {sourceLinks, targetLinks} of nodes) {
        sourceLinks.sort(ascendingTargetBreadth);
        targetLinks.sort(ascendingSourceBreadth);
      }
    }
  }

  // Returns the target.y0 that would produce an ideal link from source to target.
  function targetTop(source, target) {
    let y = source.y0 - (source.sourceLinks.length - 1) * py / 2;
    for (const {target: node, width} of source.sourceLinks) {
      if (node === target) break;
      y += width + py;
    }
    for (const {source: node, width} of target.targetLinks) {
      if (node === source) break;
      y -= width;
    }
    return y;
  }

  // Returns the source.y0 that would produce an ideal link from source to target.
  function sourceTop(source, target) {
    let y = target.y0 - (target.targetLinks.length - 1) * py / 2;
    for (const {source: node, width} of target.targetLinks) {
      if (node === source) break;
      y += width + py;
    }
    for (const {target: node, width} of source.sourceLinks) {
      if (node === target) break;
      y -= width;
    }
    return y;
  }

  // Assign each circular link a routing side: 'top' or 'bottom'.
  // Must run AFTER node y-positions are computed.
  function selectCircularLinkTypes({links}) {
    const yMid = (y0 + y1) / 2;
    for (const link of links) {
      if (!link.circular) continue;
      // Use the average vertical position of the two endpoints.
      const linkMid =
        (link.source.y0 + link.source.y1 + link.target.y0 + link.target.y1) / 4;
      link.circularLinkType = linkMid < yMid ? "top" : "bottom";
    }
  }

  return sankey;
}
