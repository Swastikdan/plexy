import { useRouter } from "expo-router";
export function useMediaNavigation() {
  const router = useRouter();
  return {
    open: (id: string | number) =>
      router.push({ pathname: "/item/[id]", params: { id: String(id) } }),
    play: (fileId: number) =>
      router.push({
        pathname: "/player/[file-id]",
        params: { "file-id": String(fileId) },
      }),
    back: () => (router.canGoBack() ? router.back() : router.replace("/")),
  };
}
