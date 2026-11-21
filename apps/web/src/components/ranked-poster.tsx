/// A landscape title with its rank in the library's Top 10. The oversized
/// numeral sits beside the art the way a chart puts the position first.
import { Poster } from "./poster";
import type { ItemCard } from "@/client";
import { cx } from "@/lib/cx";

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
    <div
      className={cx(
        "group/rank grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-end gap-x-1",
        className,
      )}
    >
      <span
        aria-hidden
        className="row-start-1 select-none self-end pb-1 font-sans text-[3.6rem] font-black leading-[0.72] tracking-[-0.09em] text-white/[0.18] drop-shadow-[0_3px_14px_rgba(0,0,0,0.65)] sm:text-[4.8rem]"
      >
        {rank}
      </span>
      <Poster
        item={item}
        wide
        overlayTitle={false}
        className="col-start-2 row-start-1 aspect-video h-[7.25rem] sm:h-[8.5rem] md:h-[9.75rem]"
      />
      <p className="col-start-2 row-start-2 mt-2 truncate px-0.5 text-[11.5px] font-semibold text-foreground">
        {item.name}
      </p>
      <span className="sr-only">Rank {rank}</span>
    </div>
  );
}
