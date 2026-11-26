import { withUniwind } from "uniwind";
import { SafeAreaView as SafeAreaViewBase } from "react-native-safe-area-context";

/**
 * SafeAreaView with Tailwind className support. The library's view is a
 * Fabric host component, so a raw className prop would be dropped; the
 * withUniwind wrapper resolves it into a style first.
 */
export const SafeAreaView = withUniwind(SafeAreaViewBase);
