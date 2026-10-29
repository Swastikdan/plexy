/// Horizontal Netflix-style row of posters with arrow paging and smooth scrolling.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Poster, cx } from "./poster";
import type { ItemCard } from "../client";
import { prefetchAssets } from "../lib/asset-prefetch";
import { prefetchTriggerEnabled, prefetchWindow } from "../lib/prefetch-config";

export function Row({
  title,
  items,
  action,
  directPlay = false,
  wide = false,
}: {
  title: string;
  items: ItemCard[];
  action?: ReactNode;
  /** Cards with a file open the player immediately instead of the detail page. */
  directPlay?: boolean;
  /** Landscape backdrop cards (Continue watching / Next up) instead of posters. */
  wide?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const updateScrollEdges = () => {
      const maxScroll = element.scrollWidth - element.clientWidth;
      setScrollEdges({
        left: element.scrollLeft > 1,
        right: maxScroll > 1 && element.scrollLeft < maxScroll - 1,
      });
    };

    updateScrollEdges();
    element.addEventListener("scroll", updateScrollEdges, { passive: true });
    window.addEventListener("resize", updateScrollEdges);

    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);

    return () => {
      element.removeEventListener("scroll", updateScrollEdges);
      window.removeEventListener("resize", updateScrollEdges);
      observer.disconnect();
    };
  }, [items]);

  // Warm a small window of artwork just past the visible cards. A throttled
  // scroll handler (one run per animation frame, at most every 250 ms) keeps
  // this from firing on every event or warming the whole row.
  useEffect(() => {
    const element = scroller.current;
    if (!element || items.length === 0 || typeof IntersectionObserver === "undefined") return;

    let visible = false;
    let frame = 0;
    let lastRun = 0;

    const warmAhead = () => {
      if (!visible || !prefetchTriggerEnabled("scroll")) return;
      const bounds = element.getBoundingClientRect();
      const children = Array.from(element.children) as HTMLElement[];
      let lastVisible = -1;
      for (let index = 0; index < children.length; index++) {
        const rect = children[index]!.getBoundingClientRect();
        if (rect.right > bounds.left && rect.left < bounds.right) lastVisible = index;
      }
      if (lastVisible < 0) return;
      const upcoming = items.slice(lastVisible + 1, lastVisible + 1 + prefetchWindow());
      for (const item of upcoming) prefetchAssets([item.poster, item.backdrop]);
    };

    const schedule = () => {
      if (!visible || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const now = performance.now();
        if (now - lastRun < 250) return;
        lastRun = now;
        warmAhead();
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) warmAhead();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    element.addEventListener("scroll", schedule, { passive: true });

    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items]);

  if (!items.length) return null;

  const page = (dir: -1 | 1) => {
    if (!scroller.current) return;
    const scrollAmount = scroller.current.clientWidth * 0.85;
    scroller.current.scrollBy({ left: dir * scrollAmount, behavior: "smooth" });
  };

  return (
    <section className="group/row relative min-w-0 my-6">
      <div className="mb-3 flex items-baseline justify-between gap-4 px-1 sm:px-2">
        <h2 className="font-sans text-base font-semibold tracking-tight text-ink sm:text-lg">
          {title}
        </h2>
        {action}
      </div>

      <div className="relative">
        {/* Left scroll chevron button */}
        {scrollEdges.left && <button
          aria-label="Scroll left"
          onClick={() => page(-1)}
          className={cx(
            "absolute -left-3 top-1/2 z-30 -translate-y-1/2 flex h-24 w-9 items-center justify-center",
            "bg-canvas/80 text-ink-muted transition-all duration-200",
            "opacity-0 hover:text-ink hover:bg-canvas group-hover/row:opacity-100 disabled:pointer-events-none",
            "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ink",
          )}
        >
          <ChevronLeft size={20} />
        </button>}

        {/* Scroller container */}
        <div
          ref={scroller}
          className="scroll-row flex gap-2.5 overflow-x-auto px-1 py-2 sm:px-2"
        >
        {items
          .map((item) => (
            <Poster
              key={item.id}
              item={item}
              directPlay={directPlay}
              wide={wide}
              className={cx(
                "shrink-0",
                wide
                  ? "aspect-video h-36 sm:h-44 md:h-52"
                  : "aspect-[2/3] h-48 sm:h-56 md:h-64",
              )}
            />
          ))}
        </div>

        {/* Right scroll chevron button */}
        {scrollEdges.right && <button
          aria-label="Scroll right"
          onClick={() => page(1)}
          className={cx(
            "absolute -right-3 top-1/2 z-30 -translate-y-1/2 flex h-24 w-9 items-center justify-center",
            "bg-canvas/80 text-ink-muted transition-all duration-200",
            "opacity-0 hover:text-ink hover:bg-canvas group-hover/row:opacity-100 disabled:pointer-events-none",
            "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ink",
          )}
        >
          <ChevronRight size={20} />
        </button>}
      </div>
    </section>
  );
}
