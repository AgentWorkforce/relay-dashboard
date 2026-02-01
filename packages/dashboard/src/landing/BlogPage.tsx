/**
 * Agent Relay Cloud - Blog Listing Page
 */

import React from 'react';
import { StaticPage } from './StaticPage';
import { blogPosts } from './blogData';

export function BlogPage() {
  return (
    <StaticPage
      title="Blog"
      subtitle="News, tutorials, and insights from the Agent Relay team."
    >
      <div className="blog-list">
        {blogPosts.map((post) => (
          <a
            key={post.id}
            href={`/blog/${post.id}`}
            className="blog-card"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <article>
              <div className="blog-meta">
                <span className="blog-category">{post.category}</span>
                <span>{post.date}</span>
                <span className="blog-author">by {post.author}</span>
              </div>
              <h3>{post.title}</h3>
              <p>{post.excerpt}</p>
              <span className="blog-read-more">Read more →</span>
            </article>
          </a>
        ))}
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '48px 0' }} />

      <h2>Stay Updated</h2>
      <p>
        Follow us on <a href="https://twitter.com/agent_relay" target="_blank" rel="noopener noreferrer">Twitter</a> for the latest updates and more content.
      </p>
    </StaticPage>
  );
}

export default BlogPage;
