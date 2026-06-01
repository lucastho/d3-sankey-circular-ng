// sankeyLinkCircular.js
//
// Generates an SVG path that is the CENTERLINE of a link. The link's visible
// thickness comes entirely from stroke-width === link.width at render time
// (fill: none, stroke-linejoin: round, stroke-linecap: round/butt).
//
// Normal links: a cubic Bézier centerline from (source.x1, y0) to (target.x0, y1),
// identical in shape to d3.sankeyLinkHorizontal — but we STROKE it instead of
// filling a ribbon. Same visual result, far simpler.
//
// Circular links: a rounded-corner polyline read straight out of
// link.circularPathData.points (computed by the layout). No inner/outer radius
// math — we round each interior vertex of a single centerline with one radius.
//
// debug: set linkPath.debug(true) to also expose helpers via linkPath.points(d)
// and linkPath.corners(d) for overlay rendering.

export default function sankeyLinkCircular() {
  let _debug = false;

  function link(d) {
    return d.circular ? circularPath(d) : normalPath(d);
  }

  // Centerline of a normal link: a single horizontal cubic Bézier.
  function normalPath(d) {
    const x0 = d.source.x1;
    const x1 = d.target.x0;
    const xi = (x0 + x1) / 2;
    return `M${x0},${d.y0}C${xi},${d.y0} ${xi},${d.y1} ${x1},${d.y1}`;
  }

  // Round a polyline of {x,y} points with a single radius `r`. Endpoints are
  // hit exactly; each interior vertex is replaced by a circular fillet whose
  // radius is clamped so it never exceeds half of either adjacent segment.
  function roundedPolyline(points, r) {
    if (points.length < 2) return "";
    if (points.length === 2) {
      return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;
    }

    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length - 1; ++i) {
      const p0 = points[i - 1];
      const p1 = points[i];     // the corner
      const p2 = points[i + 1];

      const v1x = p0.x - p1.x, v1y = p0.y - p1.y;
      const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);

      if (len1 < 1e-6 || len2 < 1e-6) {
        d += `L${p1.x},${p1.y}`;
        continue;
      }

      // Clamp the fillet radius to fit both adjacent segments.
      const rr = Math.min(r, len1 / 2, len2 / 2);

      const a1x = p1.x + (v1x / len1) * rr;
      const a1y = p1.y + (v1y / len1) * rr;
      const a2x = p1.x + (v2x / len2) * rr;
      const a2y = p1.y + (v2y / len2) * rr;

      d += `L${a1x},${a1y}`;
      // arcTo-style quadratic-ish fillet: use the corner as the control point.
      // A quadratic Bézier through a1 -> (control p1) -> a2 gives a smooth,
      // robust round that never self-intersects, unlike arcTo with bad radii.
      d += `Q${p1.x},${p1.y} ${a2x},${a2y}`;
    }
    const last = points[points.length - 1];
    d += `L${last.x},${last.y}`;
    return d;
  }

  function circularPath(d) {
    const p = d.circularPathData;
    return roundedPolyline(p.points, p.radius);
  }

  // --- debug accessors ---------------------------------------------------
  link.points = function (d) {
    return d.circular ? d.circularPathData.points : [
      { x: d.source.x1, y: d.y0 },
      { x: d.target.x0, y: d.y1 }
    ];
  };

  link.debug = function (_) {
    return arguments.length ? ((_debug = !!_), link) : _debug;
  };

  // Kept for API compatibility (layout owns extents now).
  link.extent = function () { return link; };
  link.circularGap = function () { return link; };

  return link;
}