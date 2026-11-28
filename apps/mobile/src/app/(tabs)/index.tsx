import { Redirect, useIsFocused } from "expo-router";
import { useClient } from "@/core/client/client-provider";
import { HomeScreen } from "@/features/home/home-screen";
import { RemoteHomeScreen } from "@/features/remote/remote-home-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";

export default function HomeRoute() {
  const { runtime, preferences } = useClient();
  const navigation = useMediaNavigation();
  const active = useIsFocused();
  const remote = preferences.source === "online";
  if (preferences.mode === "local" && active && runtime.needsSetup())
    return <Redirect href="/settings/folders" />;
  if (remote) return <RemoteHomeScreen />;
  return <HomeScreen {...navigation} active={active} />;
}
