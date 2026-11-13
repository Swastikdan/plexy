import { useUniwind } from "uniwind";
import {
Archivo_400Regular,
Archivo_500Medium,
Archivo_700Bold,
Archivo_900Black,
useFonts,
} from "@expo-google-fonts/archivo";
import * as SplashScreen from "expo-splash-screen";
import React,{ useEffect,useState } from "react";
import { AppState,StatusBar,View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColors } from "@/shared/theme";
import { Loading } from "@/shared/ui/loading";
import { Notice } from "@/shared/ui/notice";
import {
ClientProvider,
useClient,
} from "./client/client-provider";
import { localRuntime } from "./library/local-runtime";
void SplashScreen.preventAutoHideAsync().catch(() => {});
function Ready({ children }: React.PropsWithChildren) {
  const { ready, storageError } = useClient();
  if (!ready && !storageError) return <Loading />;
  return (
    <View
      style={{ flex: 1 }}
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
  const colors = useColors();
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
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        {error ? (
          <Notice message={error} />
        ) : !booted || (!fonts && !fontError) ? (
          <Loading />
        ) : (
          <ClientProvider runtime={localRuntime}>
            <Ready>{children}</Ready>
          </ClientProvider>
        )}
      </View>
    </SafeAreaProvider>
  );
}
