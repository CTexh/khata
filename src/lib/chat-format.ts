// Assistant replies mark bold text as *bold*, which still reads naturally as
// plain text. This splits a line into plain and bold pieces the
// page renders as elements - never as HTML, so a name or note containing
// markup can't inject anything.
export type Segment = { text: string; bold: boolean };

export function splitBold(line: string): Segment[] {
  const out: Segment[] = [];
  const re = /\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false });
  return out;
}

// A reply's shape, worked out once here so the page can lay it out instead of
// printing a wall of lines: the heading, "Label: value" facts as a small
// table, and the undo hint as a footnote. Anything else stays a paragraph.
const HEADING = /^\*([^*]+)\*$/;
// "Amount: Rs 3,000" - a short, unbolded label and a value.
const FACT = /^([A-Z][A-Za-z ]{1,18}):\s+(.+)$/;
const FOOTNOTE = /^Reply \*(UNDO|undo)\*/;

type Block =
  | { kind: "head"; text: string }
  | { kind: "facts"; rows: [string, string][] }
  | { kind: "foot"; text: string }
  | { kind: "text"; text: string }
  | { kind: "gap" };

export function replyBlocks(reply: string): Block[] {
  const blocks: Block[] = [];
  const dropTrailingGap = () => {
    if (blocks[blocks.length - 1]?.kind === "gap") blocks.pop();
  };
  for (const line of reply.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (blocks.length && blocks[blocks.length - 1].kind !== "gap") blocks.push({ kind: "gap" });
      continue;
    }
    const heading = HEADING.exec(trimmed);
    // Only the opening line is a heading; a later bold line is a paragraph.
    const openingLine = !blocks.some((b) => b.kind !== "gap");
    if (heading && openingLine) {
      blocks.push({ kind: "head", text: heading[1] });
      continue;
    }
    if (FOOTNOTE.test(trimmed)) {
      dropTrailingGap();
      blocks.push({ kind: "foot", text: trimmed.replace(/\*/g, "") });
      continue;
    }
    const fact = FACT.exec(trimmed);
    if (fact && !trimmed.includes("*")) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "facts") last.rows.push([fact[1], fact[2]]);
      else {
        // The table and the footnote carry their own spacing, so a blank line
        // before either would only double it.
        dropTrailingGap();
        const previous = blocks[blocks.length - 1];
        if (previous?.kind === "facts") previous.rows.push([fact[1], fact[2]]);
        else blocks.push({ kind: "facts", rows: [[fact[1], fact[2]]] });
      }
      continue;
    }
    blocks.push({ kind: "text", text: trimmed });
  }
  while (blocks.length && blocks[blocks.length - 1].kind === "gap") blocks.pop();
  return blocks;
}
