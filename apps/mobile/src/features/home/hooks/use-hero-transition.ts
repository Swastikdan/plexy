import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { ItemCard } from "@/core/library/catalog-api";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { motion } from "@/shared/theme";

const easeOut = Easing.bezier(...motion.easeOut);

/** Keep the currently displayed title until it fades out; ignore superseded completions. */
export function useHeroTransition(items: ItemCard[]) {
  const [visible, setVisible] = useState<{
    id: string | null;
    revision: number;
  }>({
    id: items[0]?.publicId ?? null,
    revision: 0,
  });
  const [changing, setChanging] = useState(false);
  const opacity = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const itemsRef = useRef(items);
  useLayoutEffect(() => { itemsRef.current = items; }, [items]);
  const requestedId = useRef<string | null>(visible.id);
  const [requested, setRequested] = useState(visible.id);
  const revision = useRef(0);
  const entering = useRef<number | null>(null);
  const mounted = useRef(true);

  const finish = useCallback((version: number) => {
    if (mounted.current && version === revision.current) setChanging(false);
  }, []);

  const commit = useCallback((version: number) => {
    if (!mounted.current || version !== revision.current) return;
    entering.current = version;
    setVisible({ id: requestedId.current, revision: version });
  }, []);

  useLayoutEffect(() => {
    if (entering.current !== visible.revision) return;
    entering.current = null;
    const version = visible.revision;
    opacity.set(
      withTiming(
        1,
        { duration: motion.duration.enter, easing: easeOut },
        (finished) => {
          if (finished) runOnJS(finish)(version);
        },
      ),
    );
  }, [visible, opacity, finish]);

  const select = useCallback(
    (index: number, animate = false) => {
      const list = itemsRef.current;
      const target = list[Math.max(0, Math.min(list.length - 1, index))];
      if (!target || (animate && requestedId.current === target.publicId))
        return;
      const version = ++revision.current;
      requestedId.current = target.publicId;
      setRequested(target.publicId);
      entering.current = null;
      cancelAnimation(opacity);
      if (!animate) {
        setVisible({ id: target.publicId, revision: version });
        opacity.set(1);
        setChanging(false);
        return;
      }
      setChanging(true);
      opacity.set(
        withTiming(
          0,
          { duration: motion.duration.exit, easing: easeOut },
          (finished) => {
            if (finished) runOnJS(commit)(version);
          },
        ),
      );
    },
    [opacity, commit],
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      const list = itemsRef.current;
      if (!list.length) return;
      const index = list.findIndex(
        (item) => item.publicId === requestedId.current,
      );
      // Wrap around: past the last slide returns to the first and vice versa.
      select((Math.max(0, index) + direction + list.length) % list.length);
    },
    [select],
  );

  const fallbackId = items[0]?.publicId ?? null;
  if ((visible.id !== fallbackId && !items.some(item => item.publicId === visible.id)) ||
      (changing && !items.some(item => item.publicId === requested))) {
    setVisible({ id: fallbackId, revision: visible.revision + 1 });
    setRequested(fallbackId);
    setChanging(false);
  }
  useLayoutEffect(() => {
    if (!items.some(item => item.publicId === requestedId.current)) {
      revision.current++;
      entering.current = null;
      requestedId.current = fallbackId;
      cancelAnimation(opacity);
      opacity.set(1);
    }
  }, [items, fallbackId, opacity]);
  const invalidateTransition = useCallback(() => { revision.current++; }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidateTransition();
      cancelAnimation(opacity);
    };
  }, [opacity, invalidateTransition]);

  const contentStyle = useAnimatedStyle(
    () => ({
      opacity: opacity.get(),
      transform: [{ translateY: reducedMotion ? 0 : (1 - opacity.get()) * 8 }],
    }),
    [reducedMotion],
  );
  const activeItem =
    items.find((item) => item.publicId === visible.id) ?? items[0];
  return {
    activeItem,
    // While a transition is running, the dots jump to the requested slide
    // right away — they answer the gesture immediately instead of trailing
    // the fade by the full exit + enter duration.
    activeIndex: Math.max(
      0,
      items.findIndex(
        (item) =>
          item.publicId ===
          (changing ? requested : activeItem?.publicId),
      ),
    ),
    changing,
    contentStyle,
    select,
    step,
  };
}
