const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const NO_SPACE_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WHITESPACE_CHARACTER = /\s/u;
const OPENING_PUNCTUATION = /[(\u005b{<\u2018\u201c（［｛〈《「『【〔]/u;
const CLOSING_PUNCTUATION =
  /[.,!?;:%)\]}\u003e\u2019\u201d\u2026。、，．！？：；）］｝〉》」』】〕]/u;

export function appendTranscriptPart(current: string, part: string): string {
  return `${current}${normalizeTranscriptInsertion(current, "", part)}`;
}

export function normalizeTranscriptInsertion(
  left: string,
  right: string,
  text: string,
): string {
  const core = text.replace(/^\s+/u, "").replace(/\s+$/u, "");
  if (core.length === 0) {
    return "";
  }

  const prefix = needsBoundarySpace(left.at(-1), core.at(0), "left") ? " " : "";
  const suffix = needsBoundarySpace(core.at(-1), right.at(0), "right")
    ? " "
    : "";
  return `${prefix}${core}${suffix}`;
}

function needsBoundarySpace(
  left: string | undefined,
  right: string | undefined,
  side: "left" | "right",
): boolean {
  if (
    left === undefined ||
    right === undefined ||
    WHITESPACE_CHARACTER.test(left) ||
    WHITESPACE_CHARACTER.test(right) ||
    OPENING_PUNCTUATION.test(left) ||
    CLOSING_PUNCTUATION.test(right) ||
    (NO_SPACE_CHARACTER.test(left) && NO_SPACE_CHARACTER.test(right))
  ) {
    return false;
  }

  return (
    WORD_CHARACTER.test(left) ||
    WORD_CHARACTER.test(right) ||
    (side === "right" && CLOSING_PUNCTUATION.test(left))
  );
}
