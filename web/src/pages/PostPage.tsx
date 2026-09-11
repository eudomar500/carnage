import type { MouseEvent } from "react";
import TopNav, { type NavShell } from "../components/TopNav";
import { formatPostDate, type Post } from "../content/posts";
import { hrefFor } from "../lib/route";

export type PostPageProps = {
  nav: NavShell;
  post: Post;
};

/**
 * One article, on its own route.
 *
 * A reading view rather than an accordion on the landing: an article at this
 * length needs its own measure and its own scroll, and it has to be
 * shareable. ?post=<slug> is deep-linkable exactly like ?match=N, which is the
 * pattern the rest of the app already uses.
 */
export default function PostPage({ nav, post }: PostPageProps) {
  const { Banner, Body } = post;

  const toBlog = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    nav.onHome("blog");
  };

  return (
    <div className="stage" id="top">
      <TopNav variant="post" {...nav} />

      <article className="post">
        {Banner ? <Banner /> : null}

        <header className="post-head">
          <time className="post-date" dateTime={post.date}>
            {formatPostDate(post.date)}
          </time>
          <p className="post-author">by {post.author}</p>
          <h1 className="post-title">{post.title}</h1>
          <p className="post-summary">{post.summary}</p>
        </header>

        <div className="post-body">
          <Body />
        </div>

        <footer className="post-foot">
          <a
            className="linkish"
            href={hrefFor({ view: "landing" }, "blog")}
            onClick={toBlog}
          >
            &lt;&lt; back to the blog
          </a>
        </footer>
      </article>
    </div>
  );
}
