// test/link-circular-test.js
import {test} from "tape";
import {sankeyLinkCircular} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Extract every numeric coordinate pair from an SVG path string, in order.
// Works for M/L/C/Q since we only care about the (x,y) numbers, not commands.
function coords(d) {
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({x: nums[i], y: nums[i + 1]});
  }
  return pts;
}

// First coordinate pair (the M target).
function start(d) {
  return coords(d)[0];
}

// Last coordinate pair.
function end(d) {
  const c = coords(d);
  return c[c.length - 1];
}

function approx(t, actual, expected, msg, eps = 1e-6) {
  t.ok(Math.abs(actual - expected) < eps,
    `${msg} (got ${actual}, expected ${expected})`);
}

// A minimal NORMAL link: only the fields normalPath reads.
function normalLink({x1 = 100, x0 = 300, y0 = 50, y1 = 80} = {}) {
  return {
    circular: false,
    source: {x1},
    target: {x0},
    y0,
    y1
  };
}

// A minimal CIRCULAR link: a hand-built 6-point centerline + radius, matching
// the shape the layout produces. Defaults form a clean top loop with generous
// segment lengths so the radius is NOT clamped unless we intend it to be.
function circularLink(points, radius = 8, selfLoop = false) {
  return {
    circular: true,
    circularPathData: {points, radius, selfLoop}
  };
}

// A canonical 6-point top-loop centerline:
// leave source -> turn -> into lane -> across -> turn back -> enter target.
function topLoopPoints() {
  return [
    {x: 200, y: 100}, // 0: source face
    {x: 260, y: 100}, // 1: turn up
    {x: 260, y: 20},  // 2: into lane
    {x: 60,  y: 20},  // 3: across
    {x: 60,  y: 110}, // 4: turn back
    {x: 100, y: 110}  // 5: target face
  ];
}

// ---------------------------------------------------------------------------
// Normal links
// ---------------------------------------------------------------------------

test("sankeyLinkCircular() draws a normal link as a cubic Bézier", t => {
  const link = sankeyLinkCircular();
  const d = link(normalLink());
  t.ok(/^M/.test(d), "path begins with a moveto");
  t.ok(/C/.test(d), "path contains a cubic Bézier segment");
  t.notOk(/Q/.test(d), "normal path uses no quadratic segments");
  t.end();
});

test("sankeyLinkCircular() starts a normal link at the source face", t => {
  const link = sankeyLinkCircular();
  const d = link(normalLink({x1: 120, y0: 40}));
  const s = start(d);
  approx(t, s.x, 120, "normal start x == source.x1");
  approx(t, s.y, 40, "normal start y == y0");
  t.end();
});

test("sankeyLinkCircular() ends a normal link at the target face", t => {
  const link = sankeyLinkCircular();
  const d = link(normalLink({x0: 280, y1: 90}));
  const e = end(d);
  approx(t, e.x, 280, "normal end x == target.x0");
  approx(t, e.y, 90, "normal end y == y1");
  t.end();
});

// ---------------------------------------------------------------------------
// Circular links: endpoints honored exactly
// ---------------------------------------------------------------------------

test("sankeyLinkCircular() starts a circular link at the first point", t => {
  const link = sankeyLinkCircular();
  const pts = topLoopPoints();
  const d = link(circularLink(pts));
  const s = start(d);
  approx(t, s.x, pts[0].x, "circular start x == points[0].x");
  approx(t, s.y, pts[0].y, "circular start y == points[0].y");
  t.end();
});

test("sankeyLinkCircular() ends a circular link at the last point", t => {
  const link = sankeyLinkCircular();
  const pts = topLoopPoints();
  const d = link(circularLink(pts));
  const e = end(d);
  approx(t, e.x, pts[5].x, "circular end x == points[5].x");
  approx(t, e.y, pts[5].y, "circular end y == points[5].y");
  t.end();
});

test("sankeyLinkCircular() rounds interior corners with quadratics", t => {
  const link = sankeyLinkCircular();
  const d = link(circularLink(topLoopPoints()));
  const qCount = (d.match(/Q/g) || []).length;
  // 6 points => 4 interior corners => 4 fillets.
  t.equal(qCount, 4, "one quadratic fillet per interior corner");
  t.end();
});

test("sankeyLinkCircular() produces only finite numbers for a circular link", t => {
  const link = sankeyLinkCircular();
  const d = link(circularLink(topLoopPoints()));
  t.notOk(/NaN/.test(d), "no NaN in path");
  t.notOk(/Infinity/.test(d), "no Infinity in path");
  for (const c of coords(d)) {
    t.ok(Number.isFinite(c.x) && Number.isFinite(c.y), "coordinate is finite");
  }
  t.end();
});

// ---------------------------------------------------------------------------
// roundedPolyline radius clamping (exercised via tiny segments)
// ---------------------------------------------------------------------------

test("sankeyLinkCircular() clamps the radius on short segments without NaN", t => {
  const link = sankeyLinkCircular();
  // Deliberately tiny verticals (2px) with a huge requested radius (50).
  // The fillet must clamp to len/2 and never overshoot into NaN.
  const pts = [
    {x: 100, y: 50},
    {x: 120, y: 50},
    {x: 120, y: 52}, // 2px rise — radius must clamp hard here
    {x: 60,  y: 52},
    {x: 60,  y: 54}, // another 2px rise
    {x: 100, y: 54}
  ];
  const d = link(circularLink(pts, 50));
  t.notOk(/NaN/.test(d), "no NaN even with oversized radius on tiny segments");
  // Endpoints must still be hit exactly despite clamping.
  approx(t, start(d).x, 100, "start x preserved under clamping");
  approx(t, start(d).y, 50, "start y preserved under clamping");
  approx(t, end(d).x, 100, "end x preserved under clamping");
  approx(t, end(d).y, 54, "end y preserved under clamping");
  t.end();
});

test("sankeyLinkCircular() handles a degenerate 2-point centerline as a line", t => {
  const link = sankeyLinkCircular();
  const pts = [{x: 10, y: 20}, {x: 90, y: 20}];
  const d = link(circularLink(pts));
  t.ok(/^M10,20L90,20$/.test(d), "2-point path is a plain moveto+lineto");
  t.notOk(/[CQ]/.test(d), "no curve commands for a 2-point path");
  t.end();
});

test("sankeyLinkCircular() collapses a zero-length corner to a lineto", t => {
  const link = sankeyLinkCircular();
  // Middle point duplicates its neighbor: degenerate corner, no fillet.
  const pts = [
    {x: 0,   y: 0},
    {x: 50,  y: 0},
    {x: 50,  y: 0}, // duplicate of previous -> zero-length segment
    {x: 100, y: 0}
  ];
  const d = link(circularLink(pts));
  t.notOk(/NaN/.test(d), "duplicate point does not produce NaN");
  approx(t, end(d).x, 100, "end x still reached");
  approx(t, end(d).y, 0, "end y still reached");
  t.end();
});

// ---------------------------------------------------------------------------
// Generator dispatch + debug accessors
// ---------------------------------------------------------------------------

test("sankeyLinkCircular() dispatches normal vs circular by link.circular", t => {
  const link = sankeyLinkCircular();
  const normal = link(normalLink());
  const circular = link(circularLink(topLoopPoints()));
  t.ok(/C/.test(normal) && !/Q/.test(normal), "normal => cubic, no fillets");
  t.ok(/Q/.test(circular), "circular => quadratic fillets");
  t.end();
});

test("sankeyLinkCircular().points() returns the circular centerline points", t => {
  const link = sankeyLinkCircular();
  const pts = topLoopPoints();
  const out = link.points(circularLink(pts));
  t.equal(out.length, 6, "returns all six centerline points");
  t.deepEqual(out[0], pts[0], "first point matches");
  t.deepEqual(out[5], pts[5], "last point matches");
  t.end();
});

test("sankeyLinkCircular().points() returns endpoints for a normal link", t => {
  const link = sankeyLinkCircular();
  const out = link.points(normalLink({x1: 100, x0: 300, y0: 40, y1: 70}));
  t.equal(out.length, 2, "normal link has two endpoints");
  t.deepEqual(out[0], {x: 100, y: 40}, "source endpoint");
  t.deepEqual(out[1], {x: 300, y: 70}, "target endpoint");
  t.end();
});

test("sankeyLinkCircular().debug() is a chainable getter/setter", t => {
  const link = sankeyLinkCircular();
  t.equal(link.debug(), false, "defaults to false");
  t.equal(link.debug(true), link, "setter returns the generator (chainable)");
  t.equal(link.debug(), true, "getter reflects the set value");
  t.end();
});

