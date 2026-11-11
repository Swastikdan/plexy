import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_700Bold,
  Archivo_900Black,
  useFonts,
} from "@expo-google-fonts/archivo";
import React, { useEffect, useState } from "react";
import { AppState, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Loading, Notice } from "../components/ui";
import {
  ClientProvider,
  useClient,
  type MobileRuntimeBindings,
} from "../lib/client/context";
import { localRuntime } from "../lib/local";
import { colors } from "../ui/theme";
const platform: MobileRuntimeBindings = {
  local: localRuntime,
};
function Ready({ children }: React.PropsWithChildren) {
  const { ready, storageError } = useClient();
  if (storageError) return <Notice message={storageError} />;
  return ready ? children : <Loading />;
}
export function MobileProvider({ children }: React.PropsWithChildren) {
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
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        {error ? (
          <Notice message={error} />
        ) : !booted || (!fonts && !fontError) ? (
          <Loading />
        ) : (
          <ClientProvider platform={platform}>
            <Ready>{children}</Ready>
          </ClientProvider>
        )}
      </View>
    </SafeAreaProvider>
  );
}
