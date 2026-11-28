import { useUniwind } from "uniwind";
// Import weights directly: the package barrel re-exports all 18 Archivo
// variants, and Metro treats every require() in it as a bundled asset.
import { Archivo_400Regular } from "@expo-google-fonts/archivo/400Regular";
import { Archivo_500Medium } from "@expo-google-fonts/archivo/500Medium";
import { Archivo_700Bold } from "@expo-google-fonts/archivo/700Bold";
import { Archivo_900Black } from "@expo-google-fonts/archivo/900Black";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import React,{ useEffect,useState } from "react";
import { AppState,StatusBar,View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Loading } from "@/shared/ui/loading";
import { Notice } from "@/shared/ui/notice";
import {
ClientProvider,
useClient,
} from "./client/client-provider";
import { ServerProvider } from "./server/server-provider";
import { ServerDownloadProvider } from "./server/server-download-provider";
import { localRuntime } from "./library/local-runtime";
void SplashScreen.preventAutoHideAsync().catch(() => {});
function Ready({ children }: React.PropsWithChildren) {
  const { ready, storageError } = useClient();
  if (!ready && !storageError) return <Loading />;
  return (
    <View
      className="flex-1"
      onLayout={() => {
        if (ready || storageError)
          void SplashScreen.hideAsync().catch(() => {});
      }}
    >
      {storageError ? (
        <Notice message={storageError} />
      ) : ready ? (
        children
      ) : (
        <Loading />
      )}
    </View>
  );
}
export function MobileProvider({ children }: React.PropsWithChildren) {
  const { theme } = useUniwind();
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState("");
  const [fonts, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_700Bold,
    Archivo_900Black,
  });
  useEffect(() => {
    let live = true;
    void localRuntime
      .restore()
      .then(() => {
        if (live) setBooted(true);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!booted) return;
    const refresh = () => {
      if (AppState.currentState === "active")
        void localRuntime.refresh().catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 5 * 60000);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [booted]);
  useEffect(() => {
    if (error) void SplashScreen.hideAsync().catch(() => {});
  }, [error]);
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={theme === "dark" ? "light-content" : "dark-content"}
        translucent
        backgroundColor="transparent"
      />
      <View className="flex-1 bg-background">
        {error ? (
          <Notice message={error} />
        ) : !booted || (!fonts && !fontError) ? (
          <Loading />
        ) : (
          <ServerProvider>
            <ServerDownloadProvider>
              <ClientProvider runtime={localRuntime}>
                <Ready>{children}</Ready>
              </ClientProvider>
            </ServerDownloadProvider>
          </ServerProvider>
        )}
      </View>
    </SafeAreaProvider>
  );
}
