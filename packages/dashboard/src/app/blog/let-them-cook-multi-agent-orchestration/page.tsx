import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StaticPage } from '../../../landing/StaticPage';
import { getBlogPost } from '../../../landing/blogData';
import { renderBlogContent } from '../../../landing/BlogContent';
import '../../../landing/styles.css';

const POST_ID = 'let-them-cook-multi-agent-orchestration';

const OG_IMAGE = 'https://agent-relay.com/blog/let-them-cook-multi-agent-orchestration.svg';

export const metadata: Metadata = {
  title: 'Let Them Cook: Lessons from 6 Weeks of Multi-Agent Orchestration | Agent Relay Blog',
  description: 'Multi-agent orchestration is a step change in how tasks get done. After 6 weeks of building with agent swarms, here\'s what works, what breaks, and why the planning phase becomes everything.',
  openGraph: {
    title: 'Let Them Cook: Lessons from 6 Weeks of Multi-Agent Orchestration',
    description: 'What I learned watching AI agents coordinate, communicate, and occasionally fall apart',
    type: 'article',
    siteName: 'Agent Relay',
    url: 'https://agent-relay.com/blog/let-them-cook-multi-agent-orchestration',
    authors: ['Khaliq Gant'],
    publishedTime: '2026-02-04',
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Let Them Cook: Multi-Agent Orchestration - Agent Relay',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Let Them Cook: Lessons from 6 Weeks of Multi-Agent Orchestration',
    description: 'What I learned watching AI agents coordinate, communicate, and occasionally fall apart',
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
          src="/blog/let-them-cook-multi-agent-orchestration.svg"
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
