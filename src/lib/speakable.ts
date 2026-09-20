// Turning an assistant reply into something worth hearing.
//
// Replies are written for a screen: bold markers, lines of labels, "Reply UNDO
// to remove it." Read out by Siri that becomes "asterisk expense added
// asterisk", so the same answer is flattened into one or two spoken sentences
// first. Rs becomes rupees, because "R S 3,000" is not how anyone says it.
//
// Pure, so scripts/test-speakable.ts can run it straight from node.

export function speakable(reply: string): string {
  const lines = reply
    // Bold and italic markers mean nothing out loud.
    .replace(/[*_]+/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    // "Amount: Rs 3,000" reads better as "Amount, 3,000 rupees".
    .map((line) => line.replace(/:\s*/g, ", "));

  // A question keeps its mark; everything else gets one full stop, never two.
  const spoken = lines
    .map((line) => (line.endsWith(".") ? line.slice(0, -1) : line))
    .map((line) => (/[!?]$/.test(line) ? line : `${line}.`))
    .join(" ");

  return (
    spoken
      // Rs 3,000 -> 3,000 rupees. Both the spaced and unspaced forms appear.
      .replace(/\bRs\.?\s?([\d,]+(?:\.\d+)?)/g, "$1 rupees")
      // There is nothing to reply to by voice; there is something to say.
      .replace(/\bReply UNDO\b/gi, "Say undo")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}
