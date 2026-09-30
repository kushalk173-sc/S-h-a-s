/**
 * A zone's outline.
 *
 * THE ONE PLACE THE BOARD DIVERGES FROM THE GENERATED SPEC, deliberately.
 * ---------------------------------------------------------------------
 * UI-SPEC §4.2 draws zone polygons with a `PAPER_050`/`PAPER_100`/`PAPER_200`
 * fill and separates neighbours with a 1.5-unit `TABLE_900` seam, because §4.2
 * treats the board as a parchment sheet.
 *
 * `docs/AUTHENTIC-SHASN-REFERENCE.md` §6.1 (VERIFIED against the official
 * `map.png`) says the real board is a **topographic contour map, not a
 * choropleth**: "Zones are not colour-coded. The land texture continues through
 * them. Only the borders are drawn", in a **thick desaturated slate-blue**
 * (≈4 units at board scale), and the borders are "the dominant graphic element
 * after the land".
 *
 * The reference wins, because it is ground truth about the physical object and
 * because an alternating parchment fill over a contour texture would read as
 * an elevation ramp — the exact choropleth mistake the reference warns about.
 * A dark seam is also invisible on a near-black ground, so the seam has nothing
 * to separate. Hence:
 *
 *   · unfilled zones  → no fill at all; the contour texture runs through
 *   · zone borders    → 4 units, `--map-border`, round joins
 *   · separation      → the border IS the separator
 *   · `central`       → the printed inset: olive fill, heavier border, plus the
 *                       dashed inner rule §4.2 asks for. The reference has it
 *                       filled ("a distinct olive-tinted inset… a dark knot in
 *                       the middle of the map") and so do we — it is the only
 *                       filled zone, which is what makes it an inset rather
 *                       than a peer.
 *   · majority held   → the 8% seat tint §2.9 specifies, applied as a fill that
 *                       only exists when a majority is held. The tint measures
 *                       1.17:1 and carries nothing; the real signal is the 3px
 *                       seat border, the seal disc and the flipped pegs.
 *   · hover lift      → §4.2 lifts the zone FILL, which cannot happen on an
 *                       unfilled zone. Lifted here as a border thickening to
 *                       2.5px `INK_500`. Still exactly one zone at a time.
 */

import { toClosedPath } from './useBoardGeometry';
import type { BoardZone, Point } from './types';

export const ZONE_BORDER_WIDTH = 4;
export const ZONE_BORDER_HELD_WIDTH = 3;
export const CENTRAL_BORDER_WIDTH = 6;
export const CENTRAL_INSET = 6;
export const ZONE_GAP = 1.5;

export type ZoneOutlineProps = {
  readonly zone: BoardZone;
  /** The zone's polygon from the generated geometry, by id. */
  readonly poly: readonly Point[];
  /** Seat colour token of the majority holder, or null. */
  readonly holderFill: string | null;
  /** This zone's slot is hovered or focused: lift it, and only it (§4.2). */
  readonly lifted: boolean;
  /** During a gerrymander, this is a legal zone pair — the POSITIVE seam. */
  readonly adjacencyHighlight: boolean;
};

/**
 * Shrink a polygon inward by `units` on every edge, in board units.
 *
 * Not a centroid scale: central is roughly 200 × 240 units, so a single
 * percentage would inset the short axis by twice the intended distance. Each
 * axis is scaled by its own extent, which is what "6 units inside its polygon"
 * (§4.2) actually means. The factor is clamped so a degenerate axis cannot
 * invert the polygon.
 */
function insetPolygon(poly: readonly Point[], units: number): string {
  if (poly.length === 0) return '';
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const sx = Math.max(0, (spanX - units * 2) / spanX);
  const sy = Math.max(0, (spanY - units * 2) / spanY);
  return toClosedPath(
    poly.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy] as Point),
  );
}

export function ZoneOutline({
  zone,
  poly,
  holderFill,
  lifted,
  adjacencyHighlight,
}: ZoneOutlineProps) {
  const d = toClosedPath(poly);
  const isCentral = zone.id === 'central';
  const held = holderFill !== null;

  return (
    <g
      className="shasn-zone-outline"
      data-zone-id={zone.id}
      data-zone-name={zone.name}
      data-held={held ? 'true' : 'false'}
    >
      {/* Majority tint. Texture, not information: at 8% it measures 1.17:1
          against the land, so removing colour entirely leaves the majority
          unmistakable (§2.9, §9.7). */}
      {held ? <path d={d} fill={holderFill} fillOpacity={0.08} style={{ mixBlendMode: 'multiply' }} /> : null}

      {/* During a gerrymander, a 4px POSITIVE seam between exactly the legal
          zone pairs. Illegal pairs are never drawn; the slots dim instead
          (§4.2, §6.2 G5). */}
      {adjacencyHighlight ? (
        <path
          d={d}
          fill="none"
          stroke="var(--positive)"
          strokeWidth={4}
          strokeLinejoin="round"
          data-testid="adjacency-seam"
        />
      ) : null}

      {isCentral ? (
        <>
          {/* The printed olive inset. The only filled zone on the board. */}
          <path
            d={d}
            fill="var(--map-central)"
            stroke="var(--map-border)"
            strokeWidth={CENTRAL_BORDER_WIDTH}
            strokeLinejoin="round"
            strokeLinecap="round"
            data-testid="central-fill"
          />
          {/* §4.2: the dashed inner rule that marks central as an inset rather
              than a peer region. */}
          <path
            d={insetPolygon(poly, CENTRAL_INSET)}
            fill="none"
            stroke="var(--paper-400)"
            strokeWidth={2}
            strokeDasharray="6 5"
            strokeLinejoin="round"
            aria-hidden="true"
            data-testid="central-dashed"
          />
        </>
      ) : (
        <path
          d={d}
          fill="none"
          stroke={lifted ? 'var(--ink-500)' : 'var(--map-border)'}
          strokeWidth={lifted ? 2.5 : ZONE_BORDER_WIDTH}
          strokeLinejoin="round"
          strokeLinecap="round"
          data-lifted={lifted ? 'true' : 'false'}
        />
      )}

      {/* Held zones get a heavier seat-coloured border: the load-bearing
          majority channel, since it survives greyscale at any scale (§2.9). */}
      {held ? (
        <path
          d={d}
          fill="none"
          stroke={holderFill}
          strokeWidth={ZONE_BORDER_HELD_WIDTH}
          strokeLinejoin="round"
          strokeLinecap="round"
          data-testid="held-border"
        />
      ) : null}
    </g>
  );
}

export default ZoneOutline;
