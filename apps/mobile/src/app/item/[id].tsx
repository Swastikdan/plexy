import { SafeAreaView } from "react-native-safe-area-context";
import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import type { ItemCard } from "../../../../../packages/native-client/src/api";
import { DetailScreen } from "../../screens/Catalog";
import { DownloadPicker } from "../../screens/DownloadsScreen";
import { useMediaNavigation } from "../../navigation/useMediaNavigation";
import { Notice } from "../../components/ui";
export default function DetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useMediaNavigation();
  const [picker, setPicker] = useState<{ item: ItemCard; fileId: number } | null>(null);
  if (!id || Array.isArray(id)) return <Notice message="Invalid title." />;
  return <SafeAreaView style={{ flex: 1 }}><DetailScreen id={id} {...navigation} download={(item, fileId) => setPicker({ item, fileId })} />
    {picker && <DownloadPicker {...picker} close={() => setPicker(null)} />}</SafeAreaView>;
}
