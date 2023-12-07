const
  // note: [\s\S] is an alternative to . with the 's' flag (which is not supported in older browsers)
  specialPattern = /[\s\S]*?([;'"$]|--|\/\*)/y,
  doubleQuote = /[\s\S]*?"/y,
  singleQuote = /[\s\S]*?'/y,
  singleQuoteOrBackslash = /[\s\S]*?('|\\)/y,
  whitespaceThenSingleQuote = /\s*\n\s*'/y,
  newline = /.*?\n/y,
  commentOpenOrClose = /[\s\S]*?([/][*]|[*][/])/y,
  // *any* character above \x80 is legal in a Postgres identifier
  trailingIdentifier = /(^|[^A-Za-z\u0080-\uFFFF_0-9$])[A-Za-z\u0080-\uFFFF_][A-Za-z\u0080-\uFFFF_0-9$]*$/,
  // a dollar-quoting tag is like an identifier, except no $ is allowed
  dollarTag = /([A-Za-z\u0080-\uFFFF_][A-Za-z\u0080-\uFFFF_0-9]*)?[$]/y,
  whitespace = /\s/y;

function indexAfter(str: string, re: RegExp, from: number) {
  re.lastIndex = from;
  const matched = re.test(str);
  return matched ? re.lastIndex : -1;
}

/**
 * Identifies semi-colons that separate SQL statements, plus SQL comments.
 * @param sql One or more SQL statements, separated by semi-colons.
 * @param standardConformingStrings If `false`, quotes may be backslash-escaped in ordinary strings.
 * @returns Positions of semicolons and comments, plus an indicator of an unterminated range type.
 */
export function parseSplits(sql: string, standardConformingStrings: boolean) {
  const
    positions: (number | [number, number])[] = [],  // number means a semicolon position; [number, number] means a comment range
    length = sql.length;

  let
    at = 0,
    ch: number;

  for (; ;) {
    // end of string? return
    if (at >= length) return { positions };

    // jump to just after next character of interest
    at = indexAfter(sql, specialPattern, at);
    if (at === -1) return { positions };  // nothing else special, including semicolons, so we're done

    const atSpecial = at - 1;  // backtrack to the special character (or last, if multiple)
    ch = sql.charCodeAt(atSpecial);

    switch (ch) {
      case 59 /* ; */:  // a semicolon that separates statements e.g. select 1; select 2
        positions.push(atSpecial);
        break;

      case 34 /* " */:  // an identifier e.g. "abc;""def"
      case 39 /* ' */:  // a string e.g. 'ab;''cd', E'ab;\'cd', E'ab'\n'c\'d', and if scs=no: 'ab;\'cd'
        const isSingleQuote = ch === 39;
        let backslashing = false;
        if (isSingleQuote === true) {  // double quotes never allow backslash quote-escaping
          if (standardConformingStrings === false) backslashing = true;
          else {
            const chPrev = sql.charCodeAt(atSpecial - 1);
            if (chPrev === 69 /* E */ || chPrev === 101 /* e */) backslashing = true;
          }
        }
        const re = isSingleQuote === true ? (backslashing ? singleQuoteOrBackslash : singleQuote) : doubleQuote;
        for (; ;) {
          at = indexAfter(sql, re, at);
          if (at === -1) return { positions, unterminated: isSingleQuote === true ? 'quoted string' : 'quoted identifier' };
          // we've just consumed the relevant quote or backslash
          const chNext = sql.charCodeAt(at);
          if (chNext === ch) at += 1;  // this is a doubled-escaped quote: "" or ''
          else {
            if (isSingleQuote === false) break;  // end of identifier
            // strings might continue after \s*\n\s* ...
            const continuingQuote = indexAfter(sql, whitespaceThenSingleQuote, at);
            if (continuingQuote === -1) break;
            at = continuingQuote;
          }
        }
        break;

      case 36 /* $ */:  // a dollar-quoted string e.g. $$ab$$, $ab$cd$ab$, but NOT ab$ab$cd$ab$ (which is just an identifier)
        const
          priorSql = sql.slice(0, atSpecial),
          priorIdentifier = trailingIdentifier.test(priorSql);

        if (priorIdentifier === true) break;  // $...$ strings can't immediately follow a keyword/identifier because $ is legal in those

        const tagEnd = indexAfter(sql, dollarTag, at);
        if (tagEnd === -1) break;  // not a valid dollar-quote opening

        const tagStr = sql.slice(atSpecial, tagEnd);
        at = sql.indexOf(tagStr, tagEnd);
        if (at === -1) return { positions, unterminated: 'dollar-quoted string' };

        at += tagStr.length;
        break;

      case 45 /* - */:  // a single-line comment e.g. -- ab;cd
        const singleCommentStart = atSpecial - 1;
        at = indexAfter(sql, newline, at);
        if (at === -1) at = sql.length;  // single-line comment extends to EOF
        positions.push([singleCommentStart, at]);
        break;

      case 42 /* * */:  // a multi-line comment, possibly nested e.g. /*ab;/*cd;*/ef;*/
        const multiCommentStart = atSpecial - 1;
        let commentDepth = 1;
        for (; ;) {
          at = indexAfter(sql, commentOpenOrClose, at);
          if (at === -1) return { positions, unterminated: '/* comment' };
          const isOpening = sql.charCodeAt(at - 1) === 42 /* * */;
          commentDepth += isOpening ? 1 : -1;
          if (commentDepth === 0) {
            positions.push([multiCommentStart, at]);
            break;
          }
        }
        break;

      default:
        throw new Error('Assumptions violated');  // all possible matches should be accounted for above
    }
  }
}

/**
 * Uses the output of `parseSplits` to split a string into separate SQL statements.
 * @param sql One or more SQL statements, separated by semi-colons.
 * @param positions The `positions` key of the `parseSplits` output.
 * @param cutComments If `true`, remove comments from statements.
 * @returns An array of SQL statements. Some may be empty, or contain only comments.
 */
export function splitStatements(sql: string, positions: (number | [number, number])[], cutComments: boolean) {
  const statements: string[] = [];
  let
    start = 0,
    statement = '';

  for (const position of positions.concat(sql.length)) {  // add implicit semicolon at end
    const isSemicolon = typeof position === 'number';
    statement += sql.slice(start, isSemicolon ? position : position[0]);

    if (isSemicolon) {
      statements.push(statement.trim());
      statement = '';

      start = position + 1;

    } else if (cutComments) {
      start = position[1];

      const
        noSpaceBefore = indexAfter(statement, whitespace, statement.length - 1) === -1,
        noSpaceAfter = indexAfter(sql, whitespace, start) === -1;

      if (noSpaceBefore && noSpaceAfter) statement += ' ';  // comments can separate tokens, so add space if there's none on either side

    } else {
      start = position[0];
    }
  }
  return statements;
}

/**
 * Uses the output of `parseSplits` to split a string into separate SQL statements, including comments. 
 * Returned statements are guaranteed non-empty (even if comments were to be removed).
 * @param sql One or more SQL statements, separated by semi-colons.
 * @param positions The `positions` key of the `parseSplits` output.
 * @returns An array of non-empty SQL statements.
 */
export function nonEmptyStatements(sql: string, positions: (number | [number, number])[]) {
  const
    withComments = splitStatements(sql, positions, false),
    sansComments = splitStatements(sql, positions, true);

  return withComments.filter((_, i) => sansComments[i] !== '');
}
