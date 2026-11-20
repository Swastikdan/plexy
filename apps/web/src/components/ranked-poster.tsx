/// A poster with its rank in the library's Top 10. The numeral sits on the art
/// so the row reads as a chart rather than another shelf of covers.
import { Poster } from "./poster";
import type { ItemCard } from "../client";
import { cx } from "../lib/cx";

export function RankedPoster({
  item,
  rank,
  className,
}: {
  item: ItemCard;
  rank: number;
  className?: string;
}) {
  return (
    <div className={cx("relative shrink-0", className)}>
      <Poster
        item={item}
        className="aspect-[2/3] h-[12rem] sm:h-[13.5rem] md:h-[15rem] lg:h-[16.5rem]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-9 left-1.5 font-display text-[2.4rem] leading-none text-white drop-shadow-[0_3px_10px_rgba(0,0,0,0.75)] sm:text-[3rem]"
      >
        {rank}
      </span>
      <span className="sr-only">Rank {rank}</span>
    </div>
  );
}
