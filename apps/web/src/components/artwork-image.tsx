/// Progressive artwork for the web/desktop UI.
///
/// The server stores TMDB's original image, but decoding a 4K backdrop for
/// every poster card would waste memory. This component hands the browser a
/// responsive `srcset` (so it downloads and decodes only the pixels the layout
/// needs, up to the true original) and paints a small placeholder first, then
/// cross-fades to the full image when it is ready. A placeholder is also all
/// that shows while the server is still downloading the original.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactEventHandler,
} from "react";
import { artworkUrl } from "@/lib/artwork-url";
import { cx } from "@/lib/cx";

export type ArtworkKind = "poster" | "backdrop" | "thumb" | "logo";

/** Candidate widths for `srcset`; the server resizes from the local original. */
const WIDTHS: Record<ArtworkKind, number[]> = {
  poster: [342, 500, 780, 1000, 1280, 1600],
  backdrop: [780, 1280, 1600, 1920, 2400, 3200, 3840],
  thumb: [300, 500, 780, 1280],
  logo: [300, 500, 780, 1200],
};

/** Width descriptor for the full original, larger than every resized candidate. */
const ORIGINAL_DESCRIPTOR: Record<ArtworkKind, number> = {
  poster: 3000,
  backdrop: 5120,
  thumb: 2000,
  logo: 2400,
};

/** A cheap placeholder, sized to reuse the derivatives the server already makes. */
const PLACEHOLDER_WIDTH: Record<ArtworkKind, number> = {
  poster: 500,
  backdrop: 1600,
  thumb: 300,
  logo: 500,
};

const DEFAULT_SIZES: Record<ArtworkKind, string> = {
  poster: "200px",
  backdrop: "100vw",
  thumb: "160px",
  logo: "320px",
};

function resizeUrl(url: URL, width: number | "original", preview = false): string {
  const next = new URL(url);
  next.searchParams.set("w", String(width));
  if (preview) next.searchParams.set("preview", "1");
  else next.searchParams.delete("preview");
  return next.toString();
}

export interface ArtworkImageProps {
  /** API artwork path (for example `/api/images/12`) or an absolute URL. */
  src: string | null | undefined;
  kind: ArtworkKind;
  alt?: string;
  className?: string;
  /** Extra classes for the blurred placeholder layer. */
  placeholderClassName?: string;
  sizes?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  decoding?: "async" | "sync" | "auto";
  style?: CSSProperties;
  onError?: ReactEventHandler<HTMLImageElement>;
}

export function ArtworkImage({
  src,
  kind,
  alt = "",
  className,
  placeholderClassName,
  sizes,
  loading = "lazy",
  fetchPriority,
  decoding = "async",
  style,
  onError,
}: ArtworkImageProps) {
  const fallback = artworkUrl(src);
  const imageRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [placeholderFailed, setPlaceholderFailed] = useState(false);

  const source = useMemo(() => {
    if (!fallback || typeof window === "undefined") return null;
    try {
      const url = new URL(fallback, window.location.origin);
      // Only Plexy's own artwork route supports sizes and placeholders.
      if (!url.pathname.includes("/api/images/")) return null;
      const widths = WIDTHS[kind];
      const candidates = widths.map((width) => `${resizeUrl(url, width)} ${width}w`);
      candidates.push(`${resizeUrl(url, "original")} ${ORIGINAL_DESCRIPTOR[kind]}w`);
      return {
        // Modern browsers pick from `srcset`; this is the fallback for clients
        // that ignore it, and still gives them a high-resolution image.
        src: resizeUrl(url, widths[widths.length - 1]!),
        srcSet: candidates.join(", "),
        placeholder: resizeUrl(url, PLACEHOLDER_WIDTH[kind], true),
      };
    } catch {
      return null;
    }
  }, [fallback, kind]);

  useEffect(() => {
    setLoaded(false);
    setShowPlaceholder(false);
    setPlaceholderFailed(false);
  }, [source?.src]);

  // Only spend a request on the placeholder if the full image is not already
  // ready. Cached images therefore skip the extra fetch entirely.
  useEffect(() => {
    if (loaded || !source) {
      setShowPlaceholder(false);
      return;
    }
    const timer = window.setTimeout(() => setShowPlaceholder(true), 90);
    return () => window.clearTimeout(timer);
  }, [loaded, source?.src]);

  // A cached image can already be complete before React attaches onLoad.
  useEffect(() => {
    if (imageRef.current?.complete) setLoaded(true);
  }, [source?.src]);

  if (!fallback) return null;

  if (!source) {
    return (
      <img
        src={fallback}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={decoding}
        style={style}
        className={className}
        onError={onError}
      />
    );
  }

  return (
    <>
      {showPlaceholder && !placeholderFailed && (
        <img
          src={source.placeholder}
          alt=""
          aria-hidden
          loading={loading}
          fetchPriority={fetchPriority}
          decoding="async"
          className={cx(
            "pointer-events-none absolute inset-0 h-full w-full object-cover",
            className,
            placeholderClassName,
            "scale-105 blur-xl transition-opacity duration-300",
            loaded ? "opacity-0" : "opacity-100",
          )}
          onError={() => setPlaceholderFailed(true)}
        />
      )}
      <img
        ref={imageRef}
        src={source.src}
        srcSet={source.srcSet}
        sizes={sizes ?? DEFAULT_SIZES[kind]}
        alt={alt}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={decoding}
        style={style}
        className={cx(
          className,
          "transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setLoaded(true)}
        onError={onError}
      />
    </>
  );
}
