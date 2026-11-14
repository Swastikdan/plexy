/// Horizontal row of posters with arrow paging and smooth scrolling.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Poster } from "./poster";
import { cx } from "../lib/cx";
import type { ItemCard } from "../client";

export function Row({
  title,
  subtitle,
  items,
  action,
  directPlay = false,
  wide = false,
}: {
  title: string;
  subtitle?: string;
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

  if (!items.length) return null;

  const page = (dir: -1 | 1) => {
    if (!scroller.current) return;
    const scrollAmount = scroller.current.clientWidth * 0.85;
    scroller.current.scrollBy({ left: dir * scrollAmount, behavior: "smooth" });
  };

  return (
    <section className="group/row relative min-w-0 py-2">
      <div className="mb-3 flex items-end justify-between gap-4 px-3">
        <div className="min-w-0">
          <h2 className="font-sans text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>

      <div className="relative">
        {/* Left scroll chevron button */}
        {scrollEdges.left && <button
          aria-label="Scroll left"
          onClick={() => page(-1)}
          className={cx(
            "absolute left-0 top-0 bottom-0 z-30 flex w-16 items-center justify-start pl-1",
            "bg-gradient-to-r from-background via-background/80 to-transparent text-muted",
            "transition-[opacity,color] duration-150",
            "opacity-0 hover:text-foreground group-hover/row:opacity-100 disabled:pointer-events-none",
            "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-foreground",
          )}
        >
          <ChevronLeft size={20} />
        </button>}

        <div
          ref={scroller}
          className="scroll-row flex gap-3 overflow-x-auto px-3 py-2"
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
            "absolute right-0 top-0 bottom-0 z-30 flex w-16 items-center justify-end pr-1",
            "bg-gradient-to-l from-background via-background/80 to-transparent text-muted",
            "transition-[opacity,color] duration-150",
            "opacity-0 hover:text-foreground group-hover/row:opacity-100 disabled:pointer-events-none",
            "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-foreground",
          )}
        >
          <ChevronRight size={20} />
        </button>}
      </div>
    </section>
  );
}
