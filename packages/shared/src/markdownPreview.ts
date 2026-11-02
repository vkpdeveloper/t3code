/** The text a renderer would show for `markdown`, on one line, without its syntax. */
export function markdownPreviewText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|`+)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}
