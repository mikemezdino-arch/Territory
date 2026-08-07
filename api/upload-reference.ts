import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Server is missing Supabase configuration." });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }

  const {
    territory_id: territoryId,
    filename,
    content_type: contentType,
    data_base64: dataBase64,
  } = (req.body ?? {}) as {
    territory_id?: unknown;
    filename?: unknown;
    content_type?: unknown;
    data_base64?: unknown;
  };

  if (typeof territoryId !== "string" || !territoryId) {
    res.status(400).json({ error: "Missing territory_id." });
    return;
  }
  if (typeof contentType !== "string" || !ALLOWED_TYPES.includes(contentType)) {
    res.status(400).json({ error: "Only jpg, png, or webp images are allowed." });
    return;
  }
  if (typeof filename !== "string" || !filename) {
    res.status(400).json({ error: "Missing filename." });
    return;
  }
  if (typeof dataBase64 !== "string" || !dataBase64) {
    res.status(400).json({ error: "Missing file data." });
    return;
  }

  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.length > MAX_BYTES) {
    res.status(400).json({ error: "Image must be 5MB or smaller." });
    return;
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    res.status(401).json({ error: "Invalid or expired session. Please sign in again." });
    return;
  }

  const { data: territory, error: territoryError } = await supabase
    .from("territories")
    .select("id, project_id, projects!inner(user_id)")
    .eq("id", territoryId)
    .maybeSingle();
  if (territoryError || !territory) {
    res.status(404).json({ error: "Territory not found." });
    return;
  }
  const project = Array.isArray(territory.projects) ? territory.projects[0] : territory.projects;
  if (!project || project.user_id !== user.id) {
    res.status(403).json({ error: "You do not have access to this territory." });
    return;
  }

  const path = `${user.id}/${territoryId}/${Date.now()}-${filename}`;
  const { error: uploadError } = await supabase.storage.from("references").upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (uploadError) {
    console.error("reference upload failed", uploadError);
    res.status(502).json({ error: "Upload failed. Please retry." });
    return;
  }

  const { data: publicUrlData } = supabase.storage.from("references").getPublicUrl(path);
  res.status(200).json({ url: publicUrlData.publicUrl });
}
