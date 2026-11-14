import { Redirect,useIsFocused } from "expo-router";
import { useClient } from "@/core/client/client-provider";
import { HomeScreen } from "@/features/home/home-screen";
import { useMediaNavigation } from "@/shared/navigation/use-media-navigation";
export default function HomeRoute() {
  const { runtime } = useClient();
  const navigation = useMediaNavigation();
  const active = useIsFocused();
  if (active && runtime.needsSetup())
    return (
      <Redirect href="/settings/folders" />
    );
  return <HomeScreen {...navigation} active={active} />;
}
