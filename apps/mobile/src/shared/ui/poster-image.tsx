import { useEffect,useRef,useState } from "react";
import { Image,type ImageStyle,type StyleProp } from "react-native";
import { getCachedImageSync,resolveCachedImage } from "../lib/image-cache";

export function PosterImage({
  source,
  style,
  resizeMode = "cover",
}: {
  source:
    | {
        uri: string;
        headers?: Record<string, string>;
      }
    | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
}) {
  const [resolvedUri, setResolvedUri] = useState<string | null>(() => {
    if (!source?.uri) return null;
    if (source.uri.startsWith("file://")) return source.uri;
    return getCachedImageSync(source.uri);
  });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastUri = useRef("");
  const uri = source?.uri || "";
  if (lastUri.current !== uri) {
    lastUri.current = uri;
    if (failed || attempt) {
      setFailed(false);
      setAttempt(0);
    }
  }
  useEffect(() => {
    if (!source?.uri) return;
    if (source.uri.startsWith("file://")) {
      setResolvedUri(source.uri);
      return;
    }
    const mem = getCachedImageSync(source.uri);
    if (mem) {
      setResolvedUri(mem);
      return;
    }
    let active = true;
    void resolveCachedImage(source.uri, source.headers).then((local) => {
      if (active && local && local !== source.uri) {
        setResolvedUri(local);
      }
    });
    return () => {
      active = false;
    };
  }, [source?.uri]);
  if (!source || failed) return null;
  const imageSource = resolvedUri ? { uri: resolvedUri } : source;
  return (
    <Image
      key={resolvedUri || String(attempt)}
      source={imageSource}
      style={[{ width: "100%", height: "100%" }, style]}
      resizeMode={resizeMode}
      onError={() => {
        if (attempt < 1) setAttempt((a) => a + 1);
        else setFailed(true);
      }}
    />
  );
}
