import React, { useState } from "react";
import { Redirect, useIsFocused } from "expo-router";
import { HomeScreen } from "../../screens/Catalog";
import { localRuntime } from "../../lib/local";
import { useMediaNavigation } from "../../navigation/useMediaNavigation";
export default function HomeRoute() {
  const navigation = useMediaNavigation();
  const [focusId, focused] = useState<number | null>(null);
  const active = useIsFocused();
  if (localRuntime.needsSetup()) return <Redirect href="/settings" />;
  return <HomeScreen {...navigation} focusId={focusId} focused={focused} active={active} />;
}
