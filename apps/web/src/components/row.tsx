/// Horizontal Netflix-style row of posters with arrow paging and smooth scrolling.
import { useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Poster, cx } from "./poster";
import type { ItemCard } from "../client";

export function Row({
  title,
  items,
  action,
}: {
  title: string;
  items: ItemCard[];
  action?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  if (!items.length) return null;

  const page = (dir: -1 | 1) => {
    if (!scroller.current) return;
    const scrollAmount = scroller.current.clientWidth * 0.85;
    scroller.current.scrollBy({ left: dir * scrollAmount, behavior: "smooth" });
  };

  return (
    <section className="group/row relative min-w-0 my-6">
      <div className="mb-2.5 flex items-baseline justify-between gap-4 px-1 sm:px-2">
        <h2 className="font-display text-lg font-bold tracking-tight text-white sm:text-xl">
          {title}
        </h2>
        {action}
      </div>

      <div className="relative">
        {/* Left scroll chevron button */}
        <button
          aria-label="Scroll left"
          onClick={() => page(-1)}
          className={cx(
            "absolute -left-3 top-1/2 z-30 -translate-y-1/2 flex h-24 w-10 items-center justify-center",
            "rounded-r-md bg-black/60 text-white backdrop-blur-sm transition-all duration-200",
            "opacity-0 hover:bg-black/90 group-hover/row:opacity-100 disabled:pointer-events-none",
          )}
        >
          <ChevronLeft size={24} />
        </button>

        {/* Scroller container */}
        <div
          ref={scroller}
          className="scroll-row flex gap-3 overflow-x-auto px-1 py-3 sm:px-2"
        >
          {items
            .filter((i) => i.kind !== "episode" || i.poster)
            .map((item) => (
              <Poster
                key={item.id}
                item={item}
                wide={item.kind === "episode"}
                className={cx(
                  "shrink-0",
                  item.kind === "episode"
                    ? "aspect-video h-36 sm:h-44"
                    : "aspect-[2/3] h-48 sm:h-56 md:h-64",
                )}
              />
            ))}
        </div>

        {/* Right scroll chevron button */}
        <button
          aria-label="Scroll right"
          onClick={() => page(1)}
          className={cx(
            "absolute -right-3 top-1/2 z-30 -translate-y-1/2 flex h-24 w-10 items-center justify-center",
            "rounded-l-md bg-black/60 text-white backdrop-blur-sm transition-all duration-200",
            "opacity-0 hover:bg-black/90 group-hover/row:opacity-100 disabled:pointer-events-none",
          )}
        >
          <ChevronRight size={24} />
        </button>
      </div>
    </section>
  );
}
