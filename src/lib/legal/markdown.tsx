// Renders the reviewed legal texts (docs/legal/*.md) as page content, so the published page and
// the reviewed file never drift apart. Parsing lives in ./parse.
import { readFileSync } from "node:fs";
import path from "node:path";

import Link from "next/link";
import type { ReactNode } from "react";

import { parseInline, parseLegalMarkdown } from "@/lib/legal/parse";
import { pageShellClass } from "@/lib/ui";

const linkClass =
  "font-semibold text-[color:var(--color-foreground)] underline underline-offset-4 hover:text-[color:var(--color-accent-hover)]";

function renderInline(text: string): ReactNode[] {
  return parseInline(text).map((part, index) => {
    switch (part.kind) {
      case "link":
        return part.href.startsWith("/") ? (
          <Link key={index} href={part.href} className={linkClass}>{part.text}</Link>
        ) : (
          <a key={index} href={part.href} rel="noopener noreferrer" className={linkClass}>{part.text}</a>
        );
      case "strong":
        return <strong key={index} className="font-semibold">{renderInline(part.text)}</strong>;
      case "code":
        return <code key={index} className="font-mono text-[0.875em]">{part.text}</code>;
      case "email":
        return <a key={index} href={`mailto:${part.text}`} className={`break-all ${linkClass}`}>{part.text}</a>;
      default:
        return part.text;
    }
  });
}

export function LegalDocument({ source }: { source: string }) {
  return (
    <article className="flex flex-col gap-4 text-[color:var(--color-foreground)]">
      {parseLegalMarkdown(source).map((block, index) => {
        switch (block.kind) {
          case "h1":
            return <h1 key={index} className="t-h1">{renderInline(block.text)}</h1>;
          case "h2":
            return <h2 key={index} className="t-h2 mt-4">{renderInline(block.text)}</h2>;
          case "h3":
            return <h3 key={index} className="t-body-strong mt-2">{renderInline(block.text)}</h3>;
          case "p":
            return <p key={index} className="t-body">{renderInline(block.text)}</p>;
          case "ul":
            return (
              <ul key={index} className="t-body list-disc space-y-1.5 pl-5">
                {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
              </ul>
            );
          case "table":
            return (
              // Focusable: a narrow screen may need to scroll a wide table with the keyboard.
              <div
                key={index}
                role="region"
                aria-label={`Tabla: ${block.head.join(", ")}`}
                tabIndex={0}
                className="overflow-x-auto rounded-[var(--radius-control)] border border-[color:var(--color-border)] focus-visible:outline-none focus-visible:shadow-focus"
              >
                <table className="w-full border-collapse text-left text-sm leading-5">
                  <thead className="bg-[color:var(--color-surface-muted)]">
                    <tr>
                      {block.head.map((cell, cellIndex) => (
                        <th key={cellIndex} scope="col" className="px-3 py-2 align-top font-semibold">{renderInline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-[color:var(--color-border)]">
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="px-3 py-2 align-top">{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </article>
  );
}

// A public page from a reviewed file (legal texts, «Qué es beCook»), read once at build time, with
// links to the others.
export function LegalPage({ file, related }: { file: string; related: { href: string; label: string }[] }) {
  const source = readFileSync(path.join(process.cwd(), "docs/legal", file), "utf8");
  return (
    <main className={pageShellClass}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <LegalDocument source={source} />
        <p className="t-meta">
          Ver también:{" "}
          {related.map((link, index) => (
            <span key={link.href}>
              {index ? (index === related.length - 1 ? " y " : ", ") : null}
              <Link href={link.href} className={linkClass}>{link.label}</Link>
            </span>
          ))}
          .
        </p>
      </div>
    </main>
  );
}
