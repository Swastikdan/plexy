import { useRouter } from "expo-router";
import { OnboardingScreen } from "@/features/onboarding/onboarding-screen";

/**
 * Watching-mode settings page. The first-run onboarding is rendered by the
 * tab layout; the same steps are pushed here from Settings so the page can
 * close back to Settings instead of replacing the app root.
 */
export default function WatchingModeScreen() {
  const router = useRouter();
  return (
    <OnboardingScreen
      onClose={() => router.back()}
      onDone={() => router.back()}
    />
  );
}
