import { handleApi } from "../lib/server/api";
import type { AppEnv } from "../lib/server/types";
/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env extends AppEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    if ((url.pathname === "/bitrix" || url.pathname === "/install") && request.method === "POST") {
      // Preserve only SDK routing context, never OAuth values supplied in the POST body.
      const target = new URL(url.pathname === "/install" ? "/install" : "/", url.origin);
      const form = new URLSearchParams(await request.text());
      for (const key of ["DOMAIN", "PROTOCOL", "LANG", "APP_SID"]) {
        const value = url.searchParams.get(key) || form.get(key); if (value) target.searchParams.set(key, value);
      }
      return Response.redirect(target.toString(), 303);
    }
    if (url.pathname === "/bitrix") return Response.redirect(new URL("/" + url.search, url.origin).toString(), 302);
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const result = await handler.fetch(request, env, ctx);
    const headers = new Headers(result.headers);
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "no-store");
    const domain = env.BITRIX_DOMAIN;
    if (domain && /^[a-z0-9.-]+$/.test(domain)) {
      headers.delete("X-Frame-Options");
      headers.set("Content-Security-Policy", `frame-ancestors 'self' https://${domain}`);
    }
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  },
};

export default worker;
