// Parses the reviewed legal texts (docs/legal/*.md). Only the subset those files use: headings,
// paragraphs, lists (with indented continuation lines), tables and inline **bold**, `code`,
// [links](/internal or https://…) and email addresses. Plain module so the unit tests can run it.

export type LegalBlock =
  | { kind: "h1" | "h2" | "h3" | "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export type InlinePart =
  | { kind: "text" | "strong" | "code" | "email"; text: string }
  | { kind: "link"; text: string; href: string };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const heading = /^(#{1,6})\s+(.*)$/;
const blockStart = /^(#{1,6}\s|- |\s*\|)/;

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const title = heading.exec(line);
    if (!line.trim()) {
      index += 1;
    } else if (title) {
      const level = title[1].length;
      blocks.push({ kind: level === 1 ? "h1" : level === 2 ? "h2" : "h3", text: title[2].trim() });
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
      // The first line is always consumed, so any other line («#x») cannot stop the parser.
      const text = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !blockStart.test(lines[index])) {
        text.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ kind: "p", text: text.join(" ") });
    }
  }
  return blocks;
}

const email = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
// Same-site paths («/privacidad») or https addresses; never «//host» nor other schemes.
const link = /^\[([^\]]+)\]\((\/(?!\/)[^)\s]*|https:\/\/[^)\s]+)\)$/;

export function parseInline(text: string): InlinePart[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:\/(?!\/)|https:\/\/)[^)\s]*\)|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g)
    .filter(Boolean)
    .map((part): InlinePart => {
      const match = link.exec(part);
      if (match) return { kind: "link", text: match[1], href: match[2] };
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return { kind: "strong", text: part.slice(2, -2) };
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return { kind: "code", text: part.slice(1, -1) };
      if (email.test(part)) return { kind: "email", text: part };
      return { kind: "text", text: part };
    });
}
