/**
 * The Volatile Area cog.
 *
 * From `docs/AUTHENTIC-SHASN-REFERENCE.md` §6.1 layer 6 (VERIFIED against the
 * official `map.png`): the real board marks the 11 Volatile Areas as **large
 * dark cog / sunburst rosettes** — "a ring of radial black tick-marks with
 * gaps", roughly 2.5× the diameter of a voter area. They are deliberately
 * conspicuous and read as gear or explosion.
 *
 * SCALE ADAPTATION (the one place this departs from the reference)
 * ---------------------------------------------------------------
 * The reference's "2.5× a voter area" is measured against the *printed* voter
 * dot, which is much smaller than UI-SPEC §4.3's 34-unit slot well. Scaled
 * literally to our wells, a 2.5× rosette would be 85 units across and would
 * swamp its neighbours: the measured minimum centre-to-centre distance between
 * slots is 52.84, so rosettes would collide and destroy the one thing the
 * board must keep — a clean read of where the slots are.
 *
 * So the cog is drawn as a *ring* of radial ticks outside the normative
 * 34×34 rounded-square well, reaching 54 units across. It keeps the
 * silhouette (a spiked black ring, unmistakably a cog), fits inside the
 * measured minimum distance, and leaves §4.5's Volatile shape rule — rounded
 * square, in every occupancy state, at every scale — completely untouched.
 *
 * Decorative: `aria-hidden`, because the slot's `aria-label` already says
 * "Volatile Area" (§8.5), so hiding the glyph hides nothing.
 */

export type VolatileRosetteProps = {
  /** Board-space centre. */
  readonly x: number;
  readonly y: number;
  /** Ticks in the ring. 12 reads as a cog; fewer reads as a sunburst. */
  readonly ticks?: number;
  /** Outer radius. Defaults to just inside the 52.84 min centre distance. */
  readonly outerRadius?: number;
  /** Inner radius of the tick marks. */
  readonly innerRadius?: number;
  /** Token, so the resting board never spends colour here (§2.8). */
  readonly colour?: string;
  /** Tick stroke width. */
  readonly strokeWidth?: number;
};

export function VolatileRosette({
  x,
  y,
  ticks = 12,
  outerRadius = 27,
  innerRadius = 20,
  colour = 'var(--map-rosette)',
  strokeWidth = 3,
}: VolatileRosetteProps) {
  const arms: string[] = [];
  for (let i = 0; i < ticks; i += 1) {
    // The gap: rotate inward on a fixed 2-of-3 duty cycle so the ring reads as
    // separate cogs rather than a solid disc.
    if (i % 3 === 2) continue;
    const a = (i / ticks) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    arms.push(
      `M ${(cos * innerRadius).toFixed(2)} ${(sin * innerRadius).toFixed(2)} ` +
        `L ${(cos * outerRadius).toFixed(2)} ${(sin * outerRadius).toFixed(2)}`,
    );
  }

  return (
    <g
      aria-hidden="true"
      transform={`translate(${x} ${y})`}
      className="shasn-rosette"
      data-testid="volatile-rosette"
    >
      {/* A hairline base ring, so the ticks have something to hang from and the
          rosette still reads as a disc at 500px board width. */}
      <circle r={innerRadius - 2} fill="none" stroke={colour} strokeWidth={1} opacity={0.55} />
      <path
        d={arms.join(' ')}
        stroke={colour}
        strokeWidth={strokeWidth}
        strokeLinecap="butt"
        fill="none"
      />
    </g>
  );
}

export default VolatileRosette;
