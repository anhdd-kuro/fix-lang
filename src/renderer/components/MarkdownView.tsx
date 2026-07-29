/**
 * @file MarkdownView.tsx
 * @description Renders a GFM markdown string (tables, fenced code, strikethrough,
 * task lists, …) with `react-markdown` + `remark-gfm`. Self-contained on
 * purpose — the Ask AI result window is the first consumer, and this file
 * does not share a `Components` map with `SettingUpdates.tsx`'s release-notes
 * renderer, which lives outside this feature's scope.
 *
 * Every element override uses existing theme tokens only (`bg-card`,
 * `border-border`, `text-muted-foreground`, …) so all generated themes stay
 * correct — never a hardcoded hex/rgb colour.
 *
 * react-markdown v10 hardcodes `passNode: true`, so every override receives
 * a `node` prop (the hast element) alongside the real DOM attributes. Every
 * override below destructures `node` out (as the unused `_node`) before
 * spreading the rest onto the DOM element — otherwise `node="[object
 * Object]"` leaks onto the real tag.
 */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ node: _node, children, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary-hover"
    >
      {children}
    </a>
  ),
  blockquote: ({ node: _node, children, ...props }) => (
    <blockquote
      {...props}
      className="border-l-2 border-border pl-3 text-muted-foreground"
    >
      {children}
    </blockquote>
  ),
  code: ({ node: _node, className, children, ...props }) => {
    const isFenced =
      typeof className === "string" && className.startsWith("language-");
    return isFenced ? (
      <code {...props} className={className}>
        {children}
      </code>
    ) : (
      <code
        {...props}
        className="rounded bg-secondary px-1 py-0.5 text-[0.9em] text-secondary-foreground"
      >
        {children}
      </code>
    );
  },
  h1: ({ node: _node, children, ...props }) => (
    <h1 {...props} className="text-lg font-semibold text-foreground">
      {children}
    </h1>
  ),
  h2: ({ node: _node, children, ...props }) => (
    <h2 {...props} className="text-base font-semibold text-foreground">
      {children}
    </h2>
  ),
  h3: ({ node: _node, children, ...props }) => (
    <h3 {...props} className="text-sm font-semibold text-foreground">
      {children}
    </h3>
  ),
  hr: ({ node: _node, ...props }) => (
    <hr {...props} className="border-border" />
  ),
  li: ({ node: _node, children, ...props }) => (
    <li {...props} className="text-foreground">
      {children}
    </li>
  ),
  ol: ({ node: _node, children, ...props }) => (
    <ol {...props} className="list-decimal space-y-1 pl-5">
      {children}
    </ol>
  ),
  p: ({ node: _node, children, ...props }) => (
    <p {...props} className="leading-relaxed text-foreground">
      {children}
    </p>
  ),
  pre: ({ node: _node, children, ...props }) => (
    <pre
      {...props}
      className="overflow-x-auto rounded-md border border-border bg-secondary p-3 text-sm text-secondary-foreground"
    >
      {children}
    </pre>
  ),
  strong: ({ node: _node, children, ...props }) => (
    <strong {...props} className="font-semibold text-foreground">
      {children}
    </strong>
  ),
  table: ({ node: _node, children, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} className="w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  ),
  td: ({ node: _node, children, ...props }) => (
    <td {...props} className="border border-border px-2 py-1 text-foreground">
      {children}
    </td>
  ),
  th: ({ node: _node, children, ...props }) => (
    <th
      {...props}
      className="border border-border bg-secondary px-2 py-1 text-left font-semibold text-secondary-foreground"
    >
      {children}
    </th>
  ),
  ul: ({ node: _node, children, ...props }) => (
    <ul {...props} className="list-disc space-y-1 pl-5">
      {children}
    </ul>
  ),
};

export const MarkdownView = ({ markdown }: { markdown: string }) => (
  <div className="flex flex-col gap-3 text-sm">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  </div>
);

export default MarkdownView;
