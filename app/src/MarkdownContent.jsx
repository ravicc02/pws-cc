import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components = {
  table: ({ node, ...props }) => <div className="markdown-table-scroll" role="region" aria-label="表格" tabIndex={0}><table {...props} /></div>,
};

export default function MarkdownContent({ children }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>;
}
