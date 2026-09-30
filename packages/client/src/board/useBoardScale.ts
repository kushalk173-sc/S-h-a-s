/**
 * Board scale, for the two things that depend on the *rendered* size of the
 * board rather than the viewport size.
 *
 * §3.6 and §8.4 both require a ResizeObserver and explicitly reject a media
 * query: "the board column width depends on player count (§5.13), not on
 * viewport width."
 *
 * Two consumers:
 *   1. Below the 500px floor, `TYPE_ZONE_HOLDER` renders under 10px and is
 *      dropped in favour of the seal disc alone.
 *   2. Below the floor the focus ring is boosted from 2+2 to 3+3 SVG units, so
 *      it never falls under ~1.5 CSS px.
 */

import { useEffect, useState, type RefObject } from 'react';

/** UI-SPEC A.3. The board column must never render below this. */
export const BOARD_MIN_RENDER_W = 500;

export type BoardScale = {
  /** renderedWidth / 1000 — the SVG-to-CSS scale factor. */
  readonly scale: number;
  /** Drop `TYPE_ZONE_HOLDER`; the seal disc carries the majority alone. */
  readonly belowFloor: boolean;
  /** Boost the focus ring so it never renders under ~1.5 CSS px. */
  readonly boostFocus: boolean;
};

const IDLE: BoardScale = { scale: 0.62, belowFloor: false, boostFocus: false };

export function useBoardScale(ref: RefObject<SVGSVGElement | null>): BoardScale {
  const [scale, setScale] = useState(IDLE.scale);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;

    // The SVG has a viewBox, so its own client width is the rendered board
    // width in CSS pixels. No measurement of the parent column is needed.
    const measure = (): void => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setScale(w / 1000);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return {
    scale,
    belowFloor: scale * 1000 < BOARD_MIN_RENDER_W,
    boostFocus: scale * 1000 < BOARD_MIN_RENDER_W,
  };
}
