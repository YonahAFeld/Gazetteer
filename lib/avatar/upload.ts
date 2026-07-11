import type { createClient } from "@/lib/supabase/client";

const AVATAR_SIZE = 256;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/**
 * Center-crop + downscale a chosen image to a square JPEG, upload it to the
 * user's slot in the "avatars" bucket (one file per user, overwritten in
 * place), and point profiles.avatar_url at it via update_avatar(). Resizing
 * client-side keeps uploads small and avatars uniform without a server
 * image-processing step.
 */
export async function uploadAvatar(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  file: File
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Image is too large (max 8MB).");
  }

  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't process that image."))),
      "image/jpeg",
      0.85
    );
  });

  const path = `${userId}/avatar.jpg`;
  const { error: uploadErr } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  // Fixed path + upsert means a stale browser cache would otherwise keep
  // showing the old picture; a cache-busting query param sidesteps that.
  const url = `${data.publicUrl}?v=${Date.now()}`;

  const { error: rpcErr } = await supabase.rpc("update_avatar", { p_avatar_url: url });
  if (rpcErr) throw rpcErr;

  return url;
}
