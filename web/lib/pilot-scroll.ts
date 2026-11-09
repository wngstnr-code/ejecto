"use client";

import sim from "@/data/sim-example.json";

/**
 * Scroll progress of the landing sections, shared with the 3D pilot.
 * Written by ScrollTrigger callbacks and read every frame, so it never re-renders React.
 */
export const pilotScroll = {
  hero: 0, // 0 at the top of the page, 1 when the hero has scrolled away
  statement: 0, // progress through the statement section
  toCrash: 0, // 0 when the crash section enters the viewport, 1 when it pins
  crash: 0, // progress through the pinned crash section
  // Sections where the pilot drifts back down under a parachute. Read with getBoundingClientRect each frame.
  howEl: null as HTMLElement | null,
  resultsEl: null as HTMLElement | null,
  safeEl: null as HTMLElement | null,
  ctaEl: null as HTMLElement | null,
};

/** Share of the crash scroll used to draw the chart. The rest plays out the ejection. */
export const DRAW_END = 0.85;
const CHART_DAYS = 45;
/** Crash progress where the seat fires: right after the chart reaches the EJECT day. */
export const LAUNCH_START = (DRAW_END * ((sim.ejectDay ?? 34) + 1)) / CHART_DAYS;
