import { useRouter } from "expo-router";
export function useMediaNavigation() {
  const { push, canGoBack, back, replace } = useRouter();
  return {
    open: (id: string | number) =>
      push({ pathname: "/item/[id]", params: { id: String(id) } }),
    play: (fileId: number) =>
      push({
        pathname: "/player/[file-id]",
        params: { "file-id": String(fileId) },
      }),
    back: () => (canGoBack() ? back() : replace("/")),
  };
}
