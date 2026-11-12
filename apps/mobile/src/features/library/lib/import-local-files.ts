import { File } from "expo-file-system";
import type { LocalRoot } from "../../../../../../packages/local-library/src/library";
import { displayName,localLibrary } from "../../../core/library/local-runtime";

export async function addLocalFiles(kind: LocalRoot["kind"]) {
  const picked = await File.pickFileAsync({
    multipleFiles: true,
    mimeTypes: [
      "video/*",
      "application/octet-stream",
      "application/x-matroska",
    ],
  });
  if (picked.canceled) return;
  for (const file of picked.result) {
    if (!/\.(mkv|mp4|m4v|mov|webm|avi|ts)$/i.test(displayName(file.uri)))
      continue;
    await localLibrary.addRoot({
      uri: file.uri,
      name: displayName(file.uri),
      kind,
      singleFile: true,
    });
  }
}
