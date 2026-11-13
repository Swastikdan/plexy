import NetInfo from "@react-native-community/netinfo";
import { createConnectivityState } from "./connectivity-state";

export const connectivity = createConnectivityState(NetInfo);
