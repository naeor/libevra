import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { themePrepaintPlugin } from "./theme-prepaint-plugin.js";

/**
 * Whether the dev server is reachable from other devices on the network.
 *
 * Off by default. Listening on every interface makes Windows Defender Firewall
 * ask for permission the first time, and exposes an unauthenticated dev server
 * (with Vite's own debug endpoints) to whatever network the laptop is on —
 * which is worth avoiding in a café.
 *
 * For phone testing on the same Wi-Fi, run `start-dev-lan.cmd` (HTTP, daily
 * LAN entry) or `start-dev-lan-https.cmd` (HTTPS, needed for recording/offline
 * on the phone). The API stays on loopback even then: the phone talks to this
 * server only, and the proxy below forwards /api to the API on loopback.
 */
const LAN = process.env["LIBELLUM_LAN"] === "1";

/**
 * Whether the LAN dev server also serves HTTPS.
 *
 * ⚠️ **Off by default — the daily entry is HTTP `http://localhost:5173`.**
 *
 * Phone secure-context features (speech recording, service workers) are only
 * defined over HTTPS or on `localhost`, so testing those on a phone still needs
 * HTTPS. That is a separate, explicit mode (`start-dev-lan-https.cmd`), because
 * making the *daily* entry HTTPS was confusing: the owner's browser remembered
 * `https://localhost:5173` and reported `ERR_SSL_PROTOCOL_ERROR` whenever a
 * plain-HTTP server occupied the port. One address, one scheme, by default.
 */
const HTTPS = process.env["LIBELLUM_HTTPS"] === "1";

/**
 * Which local API this dev server proxies `/api` to.
 *
 * ⚠️ **Default unchanged** (`127.0.0.1:3000`, the normal local stack). The override exists so a
 * separate E2E stack — isolated API port and isolated database schema — can run beside the normal
 * dev server **without touching the owner's localhost database**. Same-origin proxy stays, so the
 * API still needs no CORS and the browser sees one origin.
 */
const API_TARGET = process.env["LIBELLUM_API_TARGET"] ?? "http://127.0.0.1:3000";

/**
 * Which port the dev server listens on.
 *
 * ⚠️ **Default unchanged (`5173`).** The override exists for the same reason as `LIBELLUM_API_TARGET`:
 * an isolated verification stack can run beside the normal dev server instead of stopping it. The
 * owner usually has a dev server open, and killing it to take screenshots would be a poor trade.
 */
const WEB_PORT = Number(process.env["LIBELLUM_WEB_PORT"] ?? "5173");

/**
 * ⚠️ **HTTPS mode (`LIBELLUM_HTTPS=1`) exists only for phone secure-context APIs.**
 *
 * `getUserMedia`, `MediaRecorder`, `crypto.randomUUID` and service workers are
 * all *secure-context* APIs: a browser only defines them over HTTPS or on
 * `localhost`. Reached at `http://192.168.0.184:5173` — how a phone on the same
 * Wi-Fi reaches this machine — `navigator.mediaDevices` is simply `undefined`.
 *
 * That failure is not subtle, and it already cost real time twice. `crypto
 * .randomUUID` threw "not a function" on the same address, and speech recording
 * then showed "this browser does not support recording" on a phone that supports
 * it perfectly — **with no permission prompt, because there was no API to prompt
 * for.** Both sent the reader looking at the browser rather than at the URL.
 *
 * The daily desktop entry stays HTTP on purpose: one address, one scheme. The
 * certificate is self-signed and made by `pnpm dev:cert`; the HTTPS script
 * explains the one-time trust step. It is written to a gitignored directory,
 * because a private key does not belong in a public repository even when it is
 * worthless.
 */
function httpsConfig(): { key: Buffer; cert: Buffer } | undefined {
  if (!HTTPS) return undefined;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const keyPath = path.join(here, ".certs", "dev-key.pem");
  const certPath = path.join(here, ".certs", "dev-cert.pem");

  try {
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  } catch {
    /**
     * Missing certificate: **stay on HTTP rather than refusing to start.**
     *
     * A dev server that will not boot because of a certificate is worse than one
     * that boots without the secure-context features. Everything except recording
     * and offline still works, and the warning says exactly what to run.
     */
    console.warn(
      "\n⚠️  没有找到开发证书，局域网将以 http 启动。\n" +
        "    在手机上，录音与离线会不可用。运行 pnpm dev:cert 生成证书。\n",
    );
    return undefined;
  }
}

/**
 * The server options, with `https` present only when there is a certificate.
 *
 * Built as a value rather than inline because of a subtlety that cost a compile
 * error twice: under `exactOptionalPropertyTypes`, an optional property may be
 * *absent* or hold a value, but `{ https: undefined }` is neither — and a
 * conditional spread inside an object literal still leaves the key in the
 * inferred type as `… | undefined`. Choosing between two whole objects avoids the
 * question entirely, and reads as what it is: two configurations.
 */
function serverOptions(): Record<string, unknown> {
  const base = {
    // Bind IPv4 explicitly: the default ("localhost") resolves to ::1 only on
    // some Windows setups, which makes http://127.0.0.1:5173 unreachable.
    host: LAN ? "0.0.0.0" : "127.0.0.1",
    port: WEB_PORT,
    /**
     * ⚠️ **Always strict.** Silently drifting to 5174 when 5173 is taken is how
     * the browser ends up showing an old server while the new one is "running".
     * Failing loudly with "Port 5173 is already in use" is the honest outcome —
     * `start-dev*.cmd` turns that into an actionable message.
     */
    strictPort: true,
    // Proxy API calls to the local API server so the browser sees one origin.
    // This is why the API needs no CORS configuration at all, and why exposing
    // this port is enough to use the whole application from a phone.
    //
    // `changeOrigin` is deliberately left **off**. Turning it on rewrites the
    // Host header to the target, which makes the API see `127.0.0.1:3000` while
    // the browser's Origin says `192.168.0.184:5173` — and the API's same-origin
    // check then rejects every write as cross-site. The API should see the host
    // the client actually used.
    proxy: {
      "/api": {
        target: API_TARGET,
      },
    },
  };

  const certificates = httpsConfig();

  return certificates === undefined ? base : { ...base, https: certificates };
}

/**
 * When this build was made, stamped into the bundle.
 *
 * ⚠️ **Added because three rounds were spent diagnosing code that had not arrived.** The owner
 * pasted a diagnostic whose timestamp was identical to the previous one and neither of us
 * noticed at first — **a report that does not say which build produced it cannot be trusted to
 * be about the current one.** With this in the report, "you are still running the old bundle"
 * is visible in one line instead of inferred from a repeated timestamp.
 */
const BUILD_STAMP = new Date().toISOString();

export default defineConfig({
  define: {
    __BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
  },
  plugins: [themePrepaintPlugin(), react(), tailwindcss()],
  server: serverOptions(),
  /**
   * Chunk strategy: keep the entry lean and let rarely-changing code be cached separately.
   *
   * ⚠️ **Both language packs still ship eagerly** — see `src/i18n/resources/index.ts`. The
   * offline-first PWA must have the English copy available on the first offline English visit,
   * so the i18n data is *preloaded with the app* (the service worker caches every same-origin
   * asset on first use), not fetched on demand. The split below decides only which file holds
   * the bytes; it never turns a pack into a lazy request.
   *
   * Vendor groups exist for cache stability: React, the router, the query client and i18next
   * change on their own schedule, so a typo fix in a page should not invalidate a ~500 KB
   * vendor download for returning visitors.
   */
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          const normalized = id.replaceAll("\\", "/");
          if (normalized.includes("/src/i18n/resources/")) return "i18n-resources";
          if (!normalized.includes("node_modules")) return undefined;
          if (normalized.includes("react-router")) return "vendor-router";
          if (normalized.includes("@tanstack/")) return "vendor-query";
          if (normalized.includes("i18next") || normalized.includes("@babel/runtime")) {
            return "vendor-i18n";
          }
          if (
            normalized.includes("/react/") ||
            normalized.includes("/react-dom/") ||
            normalized.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          return "vendor";
        },
      },
    },
  },
});
