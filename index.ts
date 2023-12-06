const
  // note: [\s\S] is an alternative to . with the 's' flag (which is not supported in older browsers)
  specialPattern = /[\s\S]*?([;'"$]|--|\/\*)/y,
  doubleQuote = /[\s\S]*?"/y,
  singleQuote = /[\s\S]*?'/y,
  singleQuoteOrBackslash = /[\s\S]*?('|\\)/y,
  whitespaceThenSingleQuote = /\s*\n\s*'/y,
  newline = /[\s\S]*?\n/y,
  commentOpenOrClose = /[\s\S]*?([/][*]|[*][/])/y,
  trailingIdentifier = /(^|[^\p{L}\p{N}_])[\p{L}_][\p{L}\p{N}_$]*$/u,
  dollarTag = /([\p{L}_][\p{L}\p{N}_]*)?[$]/uy;

function indexAfter(str: string, re: RegExp, from: number) {
  re.lastIndex = from;
  const matched = re.test(str);
  return matched ? re.lastIndex : -1;
}

/**
 * Identifies semi-colons that separate SQL statments, and also SQL comments.
 * @param sql One or more SQL statements, separated by semi-colons
 * @param standardConformingStrings Postgres server setting: if `false`, quotes may be backslash-escaped in ordinary strings
 * @returns Positions of semicolons and comments, plus an indicator of an unterminated range type
 */
export function parseSplits(sql: string, standardConformingStrings: boolean) {
  const
    positions: (number | [number, number])[] = [],  // number means a semicolon position; [number, number] means a comment range
    length = sql.length;

  let
    at = 0,
    ch: number;

  outerloop: for (; ;) {
    // end of string? return
    if (at >= length) return { positions };

    // jump to next character of interest
    at = indexAfter(sql, specialPattern, at);
    if (at === -1) return { positions };  // nothing else special, including semicolons, so we're done

    const atSpecial = at - 1;  // backtrack to the special character (or last thereof)
    ch = sql.charCodeAt(atSpecial);

    switch (ch) {
      case 59 /* ; */:  // a semicolon that separates statements e.g. select 1; select 2
        positions.push(atSpecial);
        break;

      case 34 /* " */:  // an identifier e.g. "abc;""def"
      case 39 /* ' */:  // a string e.g. 'ab;''cd', E'ab;\'cd', E'ab' 'c\'d', 'ab;\'cd' (scs=no)
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
            if (isSingleQuote === false) continue outerloop;  // end of identifier
            // strings might continue after \s*\n\s* ...
            const continuingQuote = indexAfter(sql, whitespaceThenSingleQuote, at);
            if (continuingQuote === -1) continue outerloop;
            at = continuingQuote;
          }
        }
        // `break;` not needed: can't reach here

      case 45 /* - */:  // a single-line comment e.g. -- ab;cd
        const singleCommentStart = atSpecial - 1;
        at = indexAfter(sql, newline, at);
        if (at === -1) at = sql.length;  // single-line comment extends to EOF
        else at -= 1;  // retain newline to avoid syntax errors
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

      case 36 /* $ */:  // a dollar-quoted string e.g. $$ab$$, $ab$cd$ab$, but NOT ab$ab$cd$ab$ (just an identifier)
        const
          priorSql = sql.slice(0, atSpecial),
          priorIdentifier = trailingIdentifier.test(priorSql);

        if (priorIdentifier === true) break;  // $...$ strings can't immediately follow a keyword/identifier because $ is legal in those

        const tagEnd = indexAfter(sql, dollarTag, at);
        if (tagEnd === -1) break;  // not a valid open dollar-quote

        const tagStr = sql.slice(atSpecial, tagEnd);
        at = sql.indexOf(tagStr, tagEnd);
        if (at === -1) return { positions, unterminated: 'dollar-quoted string' };
        at += tagStr.length;
        break;

      default:
        throw new Error('Assumptions violated');  // all possible matches should be accounted for above
    }
  }
}

export function splitStatements(sql: string, positions: (number | [number, number])[], cutComments: boolean) {
  let 
    start = 0,
    statement = '';
    
  const statements: string[] = [];
  for (const position of positions.concat(sql.length)) {  // implicit semicolon at end
    const isSemicolon = typeof position === 'number';
    statement += sql.slice(start, isSemicolon ? position : position[0]);

    if (isSemicolon) {
      statements.push(statement.trim());
      statement = '';
      start = position + 1;

    } else {
      start = position[cutComments ? 1 : 0];
    }
  }

  return statements;
}

export function nonEmptyStatements(sql: string, positions: (number | [number, number])[]) {
  const 
    withComments = splitStatements(sql, positions, false),
    sansComments = splitStatements(sql, positions, true);

  return withComments.filter((_, i) => sansComments[i] !== '');
}
