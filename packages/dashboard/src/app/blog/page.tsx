import { Metadata } from 'next';
import { BlogPage } from '../../landing/BlogPage';

export const metadata: Metadata = {
  title: 'Blog | Agent Relay',
  description: 'News, tutorials, and insights from the Agent Relay team.',
  openGraph: {
    title: 'Agent Relay Blog',
    description: 'News, tutorials, and insights from the Agent Relay team.',
  },
};

export default function BlogRoute() {
  return <BlogPage />;
}
