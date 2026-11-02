// Link text and destinations allow one level of nested brackets or parentheses.
const LINK = /!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g;
const LINE_MARKER = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm;
const PREVIEW_SOURCE_LIMIT = 2_000;
const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

function stripEmphasis(text: string): string {
  return text
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2");
}

/** The text a renderer would show for `markdown`, on one line, without its syntax. */
export function markdownPreviewText(markdown: string): string {
  // Previews are short; bounding the input keeps unmatched backticks from scanning a whole reply.
  const text = markdown.slice(0, PREVIEW_SOURCE_LIMIT).replace(LINE_MARKER, "").replace(LINK, "$1");
  // Code spans show their contents literally, so emphasis is stripped only between them.
  let plain = "";
  let index = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    plain += stripEmphasis(text.slice(index, match.index)) + match[2];
    index = match.index + match[0].length;
  }
  plain += stripEmphasis(text.slice(index));
  return plain.replace(/\s+/g, " ").trim();
}
