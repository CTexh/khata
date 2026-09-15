// Assistant replies use WhatsApp's *bold* markup, so the same text reads well
// on WhatsApp and in the app. This splits a line into plain and bold pieces the
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
