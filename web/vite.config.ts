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
 */
export default defineConfig({
  plugins: [react()],
});
