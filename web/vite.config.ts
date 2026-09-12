import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * One entry point: index.html.
 *
 * check.html is deliberately not built. It is a local connection diagnostic
 * that signs a real create_match from a raw writeContract call, outside the
 * action layer every button in the app goes through, and it is meant to be
 * fired repeatedly. That is right for debugging and wrong for anything a
 * visitor can reach, so it stays out of the deployed bundle.
 *
 * The source is kept for local use. Run it with `npm run dev` and open
 * /check.html, which the dev server serves straight from the project root
 * without any build config.
 *
 * Vite defaults to index.html when no rollup input is given, so there is
 * nothing to declare here.
 *
 * `base` is the path the site is served from, and it now differs by host, so
 * it comes from the environment rather than being pinned here.
 *
 *   carnageapp.xyz on Cloudflare Pages serves from the domain root, which is
 *   the default, "/".
 *
 *   The GitHub Pages fallback serves from eudomar500.github.io/carnage/, so
 *   its workflow sets BASE_PATH=/carnage/ on the build step and every emitted
 *   asset URL carries that prefix.
 *
 * Only asset URLs depend on it. Routing does not: routes are query parameters
 * and hrefFor builds them off location.href, so they inherit whatever path the
 * page was served from and a refresh hits the same index.html either way. The
 * one place a path is written by hand is lib/asset.ts, which reads
 * import.meta.env.BASE_URL and so follows this automatically.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
});
