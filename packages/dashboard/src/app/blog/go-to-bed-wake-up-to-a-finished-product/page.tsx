import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StaticPage } from '../../../landing/StaticPage';
import { getBlogPost } from '../../../landing/blogData';
import { renderBlogContent } from '../../../landing/BlogContent';
import '../../../landing/styles.css';

const POST_ID = 'go-to-bed-wake-up-to-a-finished-product';

const OG_IMAGE = 'https://agent-relay.com/blog/go-to-bed-wake-up-to-a-finished-product.svg';

export const metadata: Metadata = {
  title: 'Go to Bed, Wake Up to a Finished Product | Agent Relay Blog',
  description: 'Agent-to-agent communication is weird, fascinating, and potentially revolutionary. Here\'s how I built a system where agents work autonomously while I sleep.',
  openGraph: {
    title: 'Go to Bed, Wake Up to a Finished Product',
    description: 'How agent-to-agent communication is changing autonomous development',
    type: 'article',
    siteName: 'Agent Relay',
    url: 'https://agent-relay.com/blog/go-to-bed-wake-up-to-a-finished-product',
    authors: ['Khaliq Gant'],
    publishedTime: '2026-02-01',
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Go to Bed, Wake Up to a Finished Product - Agent Relay',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Go to Bed, Wake Up to a Finished Product',
    description: 'How agent-to-agent communication is changing autonomous development',
    images: [OG_IMAGE],
  },
};

export default function BlogPostPage() {
  const post = getBlogPost(POST_ID);

  if (!post) {
    notFound();
  }

  return (
    <StaticPage
      title="Blog"
      titleLink="/blog"
      subtitle="News, tutorials, and insights from the Agent Relay team."
    >
      <article className="blog-post">
        <img
          src="/blog/go-to-bed-wake-up-to-a-finished-product.svg"
          alt={post.title}
          style={{
            width: '100%',
            height: 'auto',
            borderRadius: '12px',
            marginBottom: '32px',
          }}
        />

        <div className="blog-post-header">
          <div className="blog-meta">
            <span className="blog-category">{post.category}</span>
            <span>{post.date}</span>
            <span className="blog-author">by <a href="https://x.com/khaliqgant" target="_blank" rel="noopener noreferrer">{post.author}</a></span>
          </div>
          <h2 className="blog-post-title">{post.title}</h2>
          <p className="blog-post-subtitle">{post.subtitle}</p>
        </div>

        <div className="blog-post-content">
          {renderBlogContent(post.content)}
        </div>
      </article>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '48px 0' }} />

      <h2>Stay Updated</h2>
      <p>
        Follow us on <a href="https://twitter.com/agent_relay" target="_blank" rel="noopener noreferrer">Twitter</a> for the latest updates and more content.
      </p>
    </StaticPage>
  );
}
