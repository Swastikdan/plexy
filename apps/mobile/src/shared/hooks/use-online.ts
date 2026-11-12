import NetInfo from "@react-native-community/netinfo";
import { useEffect,useState } from "react";
export function useOnline() {
  const [online, setOnline] = useState(false);
  useEffect(
    () =>
      NetInfo.addEventListener((s) =>
        setOnline(s.isConnected === true && s.isInternetReachable !== false),
      ),
    [],
  );
  return online;
}
