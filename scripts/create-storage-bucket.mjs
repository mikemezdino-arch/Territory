// One-off admin script: creates a public Storage bucket for image or audio uploads.
// Usage: node scripts/create-storage-bucket.mjs <bucket-name> [maxSizeMB] [image|audio]
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const MIME_GROUPS = {
  image: ["image/jpeg", "image/png", "image/webp"],
  audio: ["audio/mpeg"],
};

const bucketName = process.argv[2];
const maxSizeMB = Number(process.argv[3] ?? "5");
const mimeGroup = process.argv[4] ?? "image";

if (!bucketName || !MIME_GROUPS[mimeGroup]) {
  console.error("Usage: node scripts/create-storage-bucket.mjs <bucket-name> [maxSizeMB] [image|audio]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf-8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }),
);

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) {
  console.error("list error", listError);
  process.exit(1);
}

if (buckets.some((b) => b.name === bucketName)) {
  console.log(`bucket '${bucketName}' already exists`);
  process.exit(0);
}

const { error: createError } = await supabase.storage.createBucket(bucketName, {
  public: true,
  fileSizeLimit: `${maxSizeMB}MB`,
  allowedMimeTypes: MIME_GROUPS[mimeGroup],
});

if (createError) {
  console.error("create error", createError);
  process.exit(1);
}

console.log(`bucket '${bucketName}' created`);
