import { Redirect, useIsFocused } from "expo-router";
import { useState } from "react";
import { localRuntime } from "../../lib/local";
import { useMediaNavigation } from "../../navigation/useMediaNavigation";
import { HomeScreen } from "../../screens/Catalog";
export default function HomeRoute() {
  const navigation = useMediaNavigation();
  const [, focused] = useState<number | null>(null);
  const active = useIsFocused();
  if (localRuntime.needsSetup()) return <Redirect href="/settings" />;
  return <HomeScreen {...navigation} focused={focused} active={active} />;
}
