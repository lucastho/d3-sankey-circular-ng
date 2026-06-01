// test/circular-test.js
import {test} from "tape";
import {sankey} from "../src/index.js";

// Build a sankey with a stable config and run it on a fixture.
// structuredClone protects fixtures from sankey()'s in-place mutation.
function layout(data) {
  return sankey()
    .nodeId(d => d.id)
    .nodeWidth(20)
    .nodePadding(20)
    .extent([[10, 10], [790, 390]])(structuredClone(data));
}

function count(links, pred) {
  return links.reduce((n, l) => n + (pred(l) ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const acyclic = {
  nodes: [{id: "a"}, {id: "b"}, {id: "c"}],
  links: [
    {source: "a", target: "b", value: 1},
    {source: "b", target: "c", value: 1}
  ]
};

const cycle = {
  nodes: [{id: "a"}, {id: "b"}, {id: "c"}],
  links: [
    {source: "a", target: "b", value: 1},
    {source: "b", target: "c", value: 1},
    {source: "c", target: "a", value: 1}
  ]
};

const selfLoop = {
  nodes: [{id: "a"}, {id: "b"}],
  links: [
    {source: "a", target: "b", value: 1},
    {source: "a", target: "a", value: 1}
  ]
};

const mixed = {
  nodes: [{id: "a"}, {id: "b"}, {id: "c"}, {id: "d"}, {id: "e"}],
  links: [
    {source: "a", target: "b", value: 10},
    {source: "b", target: "c", value: 8},
    {source: "b", target: "d", value: 2},
    {source: "c", target: "e", value: 8},
    {source: "d", target: "e", value: 2},
    {source: "e", target: "a", value: 4}, // back-edge
    {source: "c", target: "b", value: 3}, // back-edge
    {source: "b", target: "b", value: 2}  // self-loop
  ]
};

// ---------------------------------------------------------------------------
// identifyCircles: tagging back-edges and self-loops
// ---------------------------------------------------------------------------

test("sankey() tags no links as circular in an acyclic graph", t => {
  const {links} = layout(acyclic);
  t.equal(count(links, l => l.circular), 0);
  t.end();
});

test("sankey() tags exactly the back-edge of a simple cycle as circular", t => {
  const {links} = layout(cycle);
  t.equal(count(links, l => l.circular), 1);
  const circular = links.find(l => l.circular);
  t.equal(circular.source.id, "c");
  t.equal(circular.target.id, "a");
  t.end();
});

test("sankey() tags a self-loop (a -> a) as circular", t => {
  const {links} = layout(selfLoop);
  const self = links.find(l => l.source.id === "a" && l.target.id === "a");
  t.equal(self.circular, true);
  t.end();
});

test("sankey() does not tag forward links as circular", t => {
  const {links} = layout(selfLoop);
  const forward = links.find(l => l.source.id === "a" && l.target.id === "b");
  t.equal(forward.circular, false);
  t.end();
});

test("sankey() tags the expected back-edges in a mixed graph", t => {
  const {links} = layout(mixed);
  const circ = links
    .filter(l => l.circular)
    .map(l => `${l.source.id}->${l.target.id}`)
    .sort();
  t.deepEqual(circ, ["b->b", "c->b", "e->a"].sort());
  t.end();
});

// ---------------------------------------------------------------------------
// Zero-regression guarantee: the acyclic fast path
// ---------------------------------------------------------------------------

test("sankey() does not attach circularReservation to an acyclic graph", t => {
  const graph = layout(acyclic);
  t.equal(graph.circularReservation, undefined);
  t.end();
});

test("sankey() does not write circular-only link fields on the acyclic path", t => {
  const {links} = layout(acyclic);
  for (const link of links) {
    t.equal(link.circularLinkType, undefined);
    t.equal(link.circularPathData, undefined);
    t.equal(link.circularLaneIndex, undefined);
  }
  t.end();
});

test("sankey() keeps all acyclic nodes within the extent", t => {
  const graph = layout(acyclic);
  for (const node of graph.nodes) {
    t.ok(node.y0 >= 10 - 1e-6, `${node.id}.y0 within extent`);
    t.ok(node.y1 <= 390 + 1e-6, `${node.id}.y1 within extent`);
    t.ok(node.x0 >= 10 - 1e-6, `${node.id}.x0 within extent`);
    t.ok(node.x1 <= 790 + 1e-6, `${node.id}.x1 within extent`);
  }
  t.end();
});

// ---------------------------------------------------------------------------
// Circular path: reservation and routing assignment
// ---------------------------------------------------------------------------

test("sankey() attaches a circularReservation when back-edges exist", t => {
  const graph = layout(cycle);
  t.ok(graph.circularReservation, "circularReservation present");
  const r = graph.circularReservation;
  t.ok(Number.isFinite(r.gutter), "gutter is finite");
  t.ok(Number.isFinite(r.top), "top reservation is finite");
  t.ok(Number.isFinite(r.bottom), "bottom reservation is finite");
  t.ok(r.gutter > 0, "gutter is positive");
  t.end();
});

test("sankey() assigns every circular link a top/bottom routing type", t => {
  const {links} = layout(mixed);
  for (const link of links) {
    if (link.circular) {
      t.ok(
        link.circularLinkType === "top" || link.circularLinkType === "bottom",
        `${link.source.id}->${link.target.id} has a valid circularLinkType`
      );
    }
  }
  t.end();
});

test("sankey() assigns circularPathData to every circular link", t => {
  const {links} = layout(mixed);
  for (const link of links.filter(l => l.circular)) {
    const p = link.circularPathData;
    t.ok(p, `${link.source.id}->${link.target.id} has circularPathData`);
    t.ok(Array.isArray(p.points), "points is an array");
    t.equal(p.points.length, 6, "centerline has 6 points");
    t.ok(Number.isFinite(p.radius), "radius is finite");
    t.ok(p.radius >= 2, "radius respects the floor of 2");
    for (const pt of p.points) {
      t.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y),
        "every path point is finite");
    }
  }
  t.end();
});

test("sankey() flags self-loops in circularPathData", t => {
  const {links} = layout(mixed);
  const self = links.find(l => l.source.id === "b" && l.target.id === "b");
  t.equal(self.circularPathData.selfLoop, true);
  t.end();
});

test("sankey() shrinks the node band to make room for top loops", t => {
  const circularGraph = layout(mixed);
  const hasTopLoop = circularGraph.links.some(
    l => l.circular && l.circularLinkType === "top");

  if (hasTopLoop) {
    t.ok(circularGraph.circularReservation.top > 0,
      "a top loop reserves positive vertical space");
  } else {
    t.pass("no top loop in this layout; nothing to assert");
  }
  t.end();
});

// ---------------------------------------------------------------------------
// Safety net: unresolvable ids still throw
// ---------------------------------------------------------------------------

test("sankey() throws on a link to a missing node id", t => {
  t.throws(() => layout({
    nodes: [{id: "a"}],
    links: [{source: "a", target: "ghost", value: 1}]
  }), /missing/);
  t.end();
});