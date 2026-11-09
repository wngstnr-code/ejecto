"use client";

import { useEffect, useRef } from "react";
import { lenisInstance } from "./smooth-scroll";

/**
 * Custom scrollbar: a short free-standing bar (30% of the screen height), on the right edge.
 * The native scrollbar is hidden in globals.css. Drag the thumb or click the track to scroll.
 */
export function ScrollBar() {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tr = track.current;
    const th = thumb.current;
    if (!tr || !th) return;

    const metrics = () => {
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const trackH = tr.clientHeight;
      const thumbH = Math.max(28, (window.innerHeight / doc.scrollHeight) * trackH);
      return { max, trackH, thumbH };
    };

    const paint = () => {
      const { max, trackH, thumbH } = metrics();
      th.style.height = `${thumbH}px`;
      th.style.transform = `translateY(${(window.scrollY / max) * (trackH - thumbH)}px)`;
    };

    const scrollToRatio = (ratio: number, immediate: boolean) => {
      const { max } = metrics();
      const y = Math.min(1, Math.max(0, ratio)) * max;
      if (lenisInstance) lenisInstance.scrollTo(y, { immediate });
      else window.scrollTo(0, y);
    };

    let dragOffset = 0;
    let dragging = false;
    const onThumbDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      dragOffset = e.clientY - th.getBoundingClientRect().top;
      th.setPointerCapture(e.pointerId);
      th.dataset.dragging = "1";
    };
    const onThumbMove = (e: PointerEvent) => {
      if (!dragging) return;
      const { trackH, thumbH } = metrics();
      const top = e.clientY - tr.getBoundingClientRect().top - dragOffset;
      scrollToRatio(top / (trackH - thumbH), true);
    };
    const onThumbUp = (e: PointerEvent) => {
      dragging = false;
      th.releasePointerCapture(e.pointerId);
      delete th.dataset.dragging;
    };
    const onTrackDown = (e: PointerEvent) => {
      if (e.target === th) return;
      const { trackH, thumbH } = metrics();
      const top = e.clientY - tr.getBoundingClientRect().top - thumbH / 2;
      scrollToRatio(top / (trackH - thumbH), false);
    };

    paint();
    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", paint);
    const ro = new ResizeObserver(paint);
    ro.observe(document.body);
    th.addEventListener("pointerdown", onThumbDown);
    th.addEventListener("pointermove", onThumbMove);
    th.addEventListener("pointerup", onThumbUp);
    th.addEventListener("pointercancel", onThumbUp);
    tr.addEventListener("pointerdown", onTrackDown);
    return () => {
      window.removeEventListener("scroll", paint);
      window.removeEventListener("resize", paint);
      ro.disconnect();
      th.removeEventListener("pointerdown", onThumbDown);
      th.removeEventListener("pointermove", onThumbMove);
      th.removeEventListener("pointerup", onThumbUp);
      th.removeEventListener("pointercancel", onThumbUp);
      tr.removeEventListener("pointerdown", onTrackDown);
    };
  }, []);

  return (
    <div
      ref={track}
      className="group fixed right-2 top-[35vh] z-[60] hidden h-[30vh] w-2.5 cursor-pointer rounded-full bg-line/70 mix-blend-normal backdrop-blur sm:block"
      aria-hidden
    >
      <div
        ref={thumb}
        className="absolute inset-x-0 top-0 cursor-grab rounded-full border border-ink hazard-stripes-thin transition-[background] data-[dragging]:cursor-grabbing group-hover:bg-hazard group-hover:bg-none"
      />
    </div>
  );
}
