const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Only jpg, png, or webp images are allowed.";
  }
  if (file.size > MAX_BYTES) {
    return "Image must be 5MB or smaller.";
  }
  return null;
}
