/// Profile photo editor. Images are centre-cropped and compressed in the
/// browser before upload, so the server only ever stores a small avatar.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Camera, Trash2 } from "lucide-react";
import { Button } from "@heroui/react";
import { accountRequest, type AccountUser } from "../auth";
import { UserAvatar } from "./user-avatar";

const AVATAR_SIZE = 256;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

async function prepareAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose an image smaller than 12 MB.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be read. Try a JPEG or PNG.");
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the image.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // JPEG has no alpha; fill white so transparent PNGs do not crop to black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    context.drawImage(
      bitmap,
      Math.floor((bitmap.width - side) / 2),
      Math.floor((bitmap.height - side) / 2),
      side,
      side,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close();
  }
}

export function ProfilePhotoEditor({ user }: { user?: AccountUser }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (avatar: string | null) => {
    setBusy(true);
    setError("");
    try {
      const result = await accountRequest<{ user: AccountUser }>("/avatar", { avatar }, "PUT");
      queryClient.setQueryData(["account"], (current: { user?: AccountUser } | undefined) =>
        current?.user ? { ...current, user: result.user } : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["account"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the photo.");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file || busy) return;
    setError("");
    try {
      const avatar = await prepareAvatar(file);
      await save(avatar);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that image.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar user={user} size={64} className="rounded-2xl" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Profile photo</h2>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
              Shown in the header, settings, and user lists. Images are cropped
              to a square and compressed on this device before upload.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => inputRef.current?.click()}
            className="h-9 px-3 text-xs font-semibold"
          >
            <Camera size={14} />
            {busy ? "Saving…" : user?.avatar ? "Change photo" : "Upload photo"}
          </Button>
          {user?.avatar && (
            <Button
              variant="ghost"
              isDisabled={busy}
              onPress={() => void save(null)}
              className="h-9 px-3 text-xs font-semibold text-muted"
            >
              <Trash2 size={14} />
              Remove
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-danger-soft-foreground">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
}
