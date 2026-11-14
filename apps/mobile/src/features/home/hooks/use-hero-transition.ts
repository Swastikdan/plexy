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
  itemsRef.current = items;
  const requestedId = useRef<string | null>(visible.id);
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
    (index: number, animate = true) => {
      const list = itemsRef.current;
      const target = list[Math.max(0, Math.min(list.length - 1, index))];
      if (!target || (animate && requestedId.current === target.publicId))
        return;
      const version = ++revision.current;
      requestedId.current = target.publicId;
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
      const index = itemsRef.current.findIndex(
        (item) => item.publicId === requestedId.current,
      );
      select(Math.max(0, index) + direction);
    },
    [select],
  );

  useEffect(() => {
    if (!items.length) {
      revision.current++;
      entering.current = null;
      requestedId.current = null;
      cancelAnimation(opacity);
      opacity.set(1);
      setChanging(false);
      return;
    }
    const pending = items.findIndex(
      (item) => item.publicId === requestedId.current,
    );
    if (pending < 0 || !items.some((item) => item.publicId === visible.id))
      select(Math.max(0, pending), false);
  }, [items, visible.id, opacity, select]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
      cancelAnimation(opacity);
    };
  }, [opacity]);

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
          (changing ? requestedId.current : activeItem?.publicId),
      ),
    ),
    changing,
    contentStyle,
    select,
    step,
  };
}
