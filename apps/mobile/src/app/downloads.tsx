import { SafeAreaView } from "react-native-safe-area-context";
import React from "react";
import { DownloadsScreen } from "../screens/DownloadsScreen";
import { useMediaNavigation } from "../navigation/useMediaNavigation";
export default function DownloadsRoute() {
  const { play, back } = useMediaNavigation();
  return <SafeAreaView style={{ flex: 1 }}><DownloadsScreen back={back} play={entry => play(entry.fileId, entry)} /></SafeAreaView>;
}
