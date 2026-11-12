import { useEffect,useRef } from "react";
import {
ActivityIndicator,
Animated,
Easing,
StyleSheet,
View,
} from "react-native";
import { useReducedMotion } from "../hooks/use-reduced-motion";
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
      <View style={styles.loadingWrap}>
        <ActivityIndicator
          size="small"
          color="#ffffff"
          accessibilityLabel="Loading"
        />
      </View>
    );
  }
  return (
    <View style={styles.loadingWrap}>
      <PlexyLogo size={34} showText={true} />
      <View style={styles.loadingTrack} accessibilityLabel="Loading">
        <Animated.View
          style={[
            styles.loadingBar,
            {
              transform: [
                {
                  translateX: slide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 92],
                  }),
                },
              ],
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
loadingWrap: {
    flex: 1,
    padding: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 26,
  },
loadingTrack: {
    width: 140,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
loadingBar: {
    width: 48,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#ffffff",
  }
});
