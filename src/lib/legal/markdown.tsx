// Renders the reviewed legal texts (docs/legal/*.md) as page content, so the published page and
// the reviewed file never drift apart. Only the subset those files use: headings, paragraphs,
// lists (with indented continuation lines), tables, **bold**, `code`, [links](/internal) and emails.
import { readFileSync } from "node:fs";
import path from "node:path";

import Link from "next/link";
import type { ReactNode } from "react";

import { pageShellClass } from "@/lib/ui";

export type LegalBlock =
  | { kind: "h1" | "h2" | "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
    } else if (line.startsWith("# ") || line.startsWith("## ")) {
      blocks.push({ kind: line.startsWith("# ") ? "h1" : "h2", text: line.replace(/^#+\s+/, "").trim() });
      index += 1;
    } else if (line.trimStart().startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trimStart().startsWith("|")) {
        // The |---|---| separator only marks the header.
        if (!/^\s*\|[\s|:-]+\|\s*$/.test(lines[index])) rows.push(cells(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", head: rows[0] ?? [], rows: rows.slice(1) });
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && (lines[index].startsWith("- ") || /^\s+\S/.test(lines[index]))) {
        if (lines[index].startsWith("- ")) items.push(lines[index].slice(2).trim());
        else items[items.length - 1] += ` ${lines[index].trim()}`;
        index += 1;
      }
      blocks.push({ kind: "ul", items });
    } else {
      const text: string[] = [];
      while (index < lines.length && lines[index].trim() && !/^(#|- |\s*\|)/.test(lines[index])) {
        text.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ kind: "p", text: text.join(" ") });
    }
  }
  return blocks;
}

const linkClass =
  "font-semibold text-[color:var(--color-foreground)] underline underline-offset-4 hover:text-[color:var(--color-accent-hover)]";

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(\/[^)\s]*\)|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\((\/[^)\s]*)\)$/.exec(part);
    if (link) {
      return <Link key={index} href={link[2]} className={linkClass}>{link[1]}</Link>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index} className="font-semibold">{renderInline(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={index} className="font-mono text-[0.875em]">{part.slice(1, -1)}</code>;
    }
    if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(part)) {
      return <a key={index} href={`mailto:${part}`} className={`break-all ${linkClass}`}>{part}</a>;
    }
    return part;
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
              <div key={index} className="overflow-x-auto rounded-[var(--radius-control)] border border-[color:var(--color-border)]">
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

// A public legal page: the reviewed file, read once at build time, and a link to the other text.
export function LegalPage({ file, related }: { file: string; related: { href: string; label: string } }) {
  const source = readFileSync(path.join(process.cwd(), "docs/legal", file), "utf8");
  return (
    <main className={pageShellClass}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <LegalDocument source={source} />
        <p className="t-meta">
          Ver también: <Link href={related.href} className={linkClass}>{related.label}</Link>.
        </p>
      </div>
    </main>
  );
}
