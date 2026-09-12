/**
 * A file from the public directory, resolved against the deployed base path.
 *
 * Vite rewrites the asset URLs it can see: those in index.html and those
 * inside CSS url(). A path written as a string literal in TypeScript is
 * invisible to it and ships verbatim, so a leading slash resolves against the
 * domain root and 404s anywhere the site is not served from one. The GitHub
 * Pages fallback serves this project from /carnage/, which is exactly that
 * case; carnageapp.xyz serves from the root, where it would happen to work.
 *
 * BASE_URL always carries a trailing slash, so `path` is relative to the
 * public directory and must not start with one.
 */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}
