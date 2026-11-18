/// Horizontal shelf with arrow paging and smooth scrolling.
///
/// The header belongs to the page; the shelf itself stays edge-to-edge and can
/// be paged with two quiet circular buttons that appear only when there is more
/// to see.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Poster } from "./poster";
import { cx } from "../lib/cx";
import type { ItemCard } from "../client";

export function Row({
  title,
  items,
  action,
  directPlay = false,
  wide = false,
  id,
}: {
  title: string;
  items: ItemCard[];
  action?: ReactNode;
  /** Cards with a file open the player immediately instead of the detail page. */
  directPlay?: boolean;
  /** Landscape backdrop cards (Continue watching / Next up) instead of posters. */
  wide?: boolean;
  id?: string;
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
    <section id={id} className="group/row relative min-w-0 scroll-mt-24 py-2">
      <div className="mb-3.5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-sans text-[17px] font-bold tracking-[-0.025em] text-foreground sm:text-[19px]">
            {title}
          </h2>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>

      <div className="relative -mx-1">
        <div
          ref={scroller}
          className="scroll-row flex items-start gap-3 overflow-x-auto px-1 py-1.5 sm:gap-3.5"
        >
          {items.map((item) => (
            <Poster
              key={item.id}
              item={item}
              directPlay={directPlay}
              wide={wide}
              className={cx(
                "shrink-0",
                wide
                  ? "aspect-video h-[7.5rem] sm:h-[9rem] md:h-[10.5rem] lg:h-[11.5rem]"
                  : "aspect-[2/3] h-[11.5rem] sm:h-[13rem] md:h-[14.5rem] lg:h-[16rem]",
              )}
            />
          ))}
        </div>

        {scrollEdges.left && (
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => page(-1)}
            className={cx(
              "absolute -left-2 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
              "border border-border bg-background/85 text-foreground shadow-lg backdrop-blur-md",
              "opacity-0 transition-[opacity,transform,background-color] duration-200 group-hover/row:opacity-100 hover:bg-surface-tertiary active:scale-90",
              "focus-visible:opacity-100",
            )}
          >
            <ChevronLeft size={17} />
          </button>
        )}

        {scrollEdges.right && (
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => page(1)}
            className={cx(
              "absolute -right-2 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
              "border border-border bg-background/85 text-foreground shadow-lg backdrop-blur-md",
              "opacity-0 transition-[opacity,transform,background-color] duration-200 group-hover/row:opacity-100 hover:bg-surface-tertiary active:scale-90",
              "focus-visible:opacity-100",
            )}
          >
            <ChevronRight size={17} />
          </button>
        )}
      </div>
    </section>
  );
}
