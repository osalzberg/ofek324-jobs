import ReactMarkdown from "react-markdown";
export function Markdown({ children }: { children: string }) {
  return <div className="markdown" dir="auto"><ReactMarkdown skipHtml
    urlTransform={url => /^https:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//")) ? url : ""}
    components={{
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span className="muted">{alt ? `[${alt}]` : "[תמונה חיצונית אינה מוצגת]"}</span>,
    }}>{children}</ReactMarkdown></div>;
}
