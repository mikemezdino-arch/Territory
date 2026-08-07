import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only shim that runs files under /api as Vercel serverless handlers,
// so `npm run dev` works without the Vercel CLI. Production deploys use the
// real Vercel runtime, which calls these same handlers directly.
function vercelApiDevPlugin(): Plugin {
  return {
    name: "vercel-api-dev",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          next();
          return;
        }
        const routeName = req.url.split("?")[0].replace("/api/", "");
        try {
          const mod = await server.ssrLoadModule(`/api/${routeName}.ts`);
          const apiHandler = mod.default;
          if (typeof apiHandler !== "function") {
            next();
            return;
          }

          (req as unknown as { query: Record<string, string> }).query = Object.fromEntries(
            new URL(req.url, "http://localhost").searchParams,
          );

          // Mirrors Vercel's real `export const config = { api: { bodyParser:
          // false } }` opt-out (needed for Stripe webhook signature
          // verification, which requires the exact raw bytes Stripe signed —
          // a JSON.parse/re-stringify round-trip isn't guaranteed byte-
          // identical). When set, the stream is left untouched here so the
          // handler can read it itself, same as it would on real Vercel.
          const bodyParserDisabled = mod.config?.api?.bodyParser === false;
          if (!bodyParserDisabled) {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const rawBody = Buffer.concat(chunks).toString("utf-8");
            let body: unknown;
            if (rawBody) {
              try {
                body = JSON.parse(rawBody);
              } catch {
                body = undefined;
              }
            }
            (req as unknown as { body: unknown }).body = body;
          }

          const vercelRes = res as unknown as {
            status: (code: number) => typeof vercelRes;
            json: (data: unknown) => void;
          };
          vercelRes.status = (code: number) => {
            res.statusCode = code;
            return vercelRes;
          };
          vercelRes.json = (data: unknown) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(data));
          };

          await apiHandler(req, vercelRes);
        } catch (err) {
          next(err as Error);
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);
  return {
    plugins: [react(), vercelApiDevPlugin()],
  };
});
