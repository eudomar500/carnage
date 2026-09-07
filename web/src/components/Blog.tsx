import type { MouseEvent } from "react";
import { formatPostDate, POSTS } from "../content/posts";
import { hrefFor } from "../lib/route";

export type BlogProps = {
  onOpenPost: (slug: string) => void;
};

/**
 * The article list.
 *
 * Each entry carries a real href, so a title can be copied or opened in a new
 * tab; the click handler only takes over the in-page case, the same as every
 * other navigation control on the site.
 */
export default function Blog({ onOpenPost }: BlogProps) {
  const open = (slug: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpenPost(slug);
  };

  return (
    <section className="doc" id="blog">
      <div className="doc-head">
        <h2 className="doc-title">BLOG</h2>
        <p className="doc-lede">
          Notes from building and testing an on-chain jury.
        </p>
      </div>

      <ol className="posts">
        {POSTS.map((p) => (
          <li key={p.slug} className="post-card">
            <a
              className="post-card-link"
              href={hrefFor({ view: "post", slug: p.slug })}
              onClick={open(p.slug)}
            >
              <time className="post-card-date" dateTime={p.date}>
                {formatPostDate(p.date)}
              </time>
              <h3 className="post-card-title">{p.title}</h3>
              <p className="post-card-summary">{p.summary}</p>
              <span className="post-card-cta">READ THE ARTICLE &gt;&gt;</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
