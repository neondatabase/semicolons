"use strict";
const specialPattern = /[\s\S]*?([;'"$]|--|\/\*)/y, doubleQuote = /[\s\S]*?"/y, singleQuote = /[\s\S]*?'/y, singleQuoteOrBackslash = /[\s\S]*?('|\\)/y, whitespaceThenSingleQuote = /\s*\n\s*'/y, newline = /.*?\n/y, commentOpenOrClose = /[\s\S]*?([/][*]|[*][/])/y, trailingIdentifier = /(^|[^A-Za-z\u0080-\uFFFF_0-9$])[A-Za-z\u0080-\uFFFF_][A-Za-z\u0080-\uFFFF_0-9$]*$/, dollarTag = /([A-Za-z\u0080-\uFFFF_][A-Za-z\u0080-\uFFFF_0-9]*)?[$]/y, whitespace = /\s/y;
function indexAfter(str, re, from) {
  re.lastIndex = from;
  const matched = re.test(str);
  return matched ? re.lastIndex : -1;
}
export function parseSplits(sql, standardConformingStrings) {
  const positions = [], length = sql.length;
  let at = 0, ch;
  for (; ; ) {
    if (at >= length)
      return { positions };
    at = indexAfter(sql, specialPattern, at);
    if (at === -1)
      return { positions };
    const atSpecial = at - 1;
    ch = sql.charCodeAt(atSpecial);
    switch (ch) {
      case 59:
        positions.push(atSpecial);
        break;
      case 34:
      case 39:
        const isSingleQuote = ch === 39;
        let backslashing = false;
        if (isSingleQuote === true) {
          if (standardConformingStrings === false)
            backslashing = true;
          else {
            const chPrev = sql.charCodeAt(atSpecial - 1);
            if (chPrev === 69 || chPrev === 101)
              backslashing = true;
          }
        }
        const re = isSingleQuote === true ? backslashing ? singleQuoteOrBackslash : singleQuote : doubleQuote;
        for (; ; ) {
          at = indexAfter(sql, re, at);
          if (at === -1)
            return { positions, unterminated: isSingleQuote === true ? "quoted string" : "quoted identifier" };
          const chNext = sql.charCodeAt(at);
          if (chNext === ch)
            at += 1;
          else {
            if (isSingleQuote === false)
              break;
            const continuingQuote = indexAfter(sql, whitespaceThenSingleQuote, at);
            if (continuingQuote === -1)
              break;
            at = continuingQuote;
          }
        }
        break;
      case 36:
        const priorSql = sql.slice(0, atSpecial), priorIdentifier = trailingIdentifier.test(priorSql);
        if (priorIdentifier === true)
          break;
        const tagEnd = indexAfter(sql, dollarTag, at);
        if (tagEnd === -1)
          break;
        const tagStr = sql.slice(atSpecial, tagEnd);
        at = sql.indexOf(tagStr, tagEnd);
        if (at === -1)
          return { positions, unterminated: "dollar-quoted string" };
        at += tagStr.length;
        break;
      case 45:
        const singleCommentStart = atSpecial - 1;
        at = indexAfter(sql, newline, at);
        if (at === -1)
          at = sql.length;
        positions.push([singleCommentStart, at]);
        break;
      case 42:
        const multiCommentStart = atSpecial - 1;
        let commentDepth = 1;
        for (; ; ) {
          at = indexAfter(sql, commentOpenOrClose, at);
          if (at === -1)
            return { positions, unterminated: "/* comment" };
          const isOpening = sql.charCodeAt(at - 1) === 42;
          commentDepth += isOpening ? 1 : -1;
          if (commentDepth === 0) {
            positions.push([multiCommentStart, at]);
            break;
          }
        }
        break;
      default:
        throw new Error("Assumptions violated");
    }
  }
}
export function splitStatements(sql, positions, cutComments) {
  const statements = [];
  let start = 0, statement = "";
  for (const position of positions.concat(sql.length)) {
    const isSemicolon = typeof position === "number";
    statement += sql.slice(start, isSemicolon ? position : position[0]);
    if (isSemicolon) {
      statements.push(statement.trim());
      statement = "";
      start = position + 1;
    } else if (cutComments) {
      start = position[1];
      const noSpaceBefore = indexAfter(statement, whitespace, statement.length - 1) === -1, noSpaceAfter = indexAfter(sql, whitespace, start) === -1;
      if (noSpaceBefore && noSpaceAfter)
        statement += " ";
    } else {
      start = position[0];
    }
  }
  return statements;
}
export function nonEmptyStatements(sql, positions) {
  const withComments = splitStatements(sql, positions, false), sansComments = splitStatements(sql, positions, true);
  return withComments.filter((_, i) => sansComments[i] !== "");
}
