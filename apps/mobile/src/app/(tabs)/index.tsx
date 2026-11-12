import { Redirect,useIsFocused } from "expo-router";
import { useState } from "react";
import { localRuntime } from "../../core/library/local-runtime";
import { HomeScreen } from "../../features/home/home-screen";
import { useMediaNavigation } from "../../shared/navigation/use-media-navigation";
export default function HomeRoute() {
  const navigation = useMediaNavigation();
  const [, focused] = useState<number | null>(null);
  const active = useIsFocused();
  if (localRuntime.needsSetup())
    return (
      <Redirect href={{ pathname: "/settings", params: { page: "folders" } }} />
    );
  return <HomeScreen {...navigation} focused={focused} active={active} />;
}
