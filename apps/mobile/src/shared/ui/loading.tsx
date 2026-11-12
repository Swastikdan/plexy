import { useEffect,useRef } from "react";
import {
ActivityIndicator,
Animated,
Easing,
View,
} from "react-native";
import { useReducedMotion } from "@/shared/hooks/use-reduced-motion";
import { PlexyLogo } from "./brand-logo";

export function Loading({
  showLogo,
}: {
  showLogo?: boolean;
} = {}) {
  const reduceMotion = useReducedMotion();
  const shouldShowLogo = showLogo !== undefined ? showLogo : true;
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shouldShowLogo) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(slide, {
          toValue: 1,
          duration: reduceMotion ? 0 : 1150,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: 0,
          duration: reduceMotion ? 0 : 800,
          easing: Easing.bezier(0.77, 0, 0.175, 1),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shouldShowLogo, slide, reduceMotion]);
  if (!shouldShowLogo) {
    return (
      <View className="flex-1 p-12 items-center justify-center">
        <ActivityIndicator
          size="small"
          color="#ffffff"
          accessibilityLabel="Loading"
        />
      </View>
    );
  }
  return (
    <View className="flex-1 p-12 items-center justify-center gap-[26px]">
      <PlexyLogo size={34} showText={true} />
      <View
        className="w-[140px] h-[3px] rounded-[2px] bg-white/[0.14] overflow-hidden"
        accessibilityLabel="Loading"
      >
        <Animated.View
          className="w-12 h-[3px] rounded-[2px] bg-white"
          style={{
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 92],
                }),
              },
            ],
          }}
        />
      </View>
    </View>
  );
}
