#!/usr/bin/env ts-node --files

import { parse } from 'pgsql-parser';

const
  // note: [\s\S] is an alternative to . with the s flag, which is not supported in older browsers
  specialPattern = /[\s\S]*?([;'"$]|--|\/\*)/y,
  doubleQuote = /[\s\S]*?"/y,
  singleQuote = /[\s\S]*?'/y,
  singleQuoteOrBackslash = /[\s\S]*?('|\\)/y,
  whitespaceThenSingleQuote = /\s*\n\s*'/y,
  newline = /[\s\S]*?\n/y,
  commentOpenOrClose = /[\s\S]*?([/][*]|[*][/])/y,
  identifierChars = /[\p{L}\p{N}_$]/u,
  dollarTag = /([\p{L}_][\p{L}\p{N}_]*)?[$]/uy;

function indexAfter(str: string, re: RegExp, from: number) {
  re.lastIndex = from;
  const matched = re.test(str);
  return matched ? re.lastIndex : -1;
}

function parseStatements(sql: string, standardConformingStrings: boolean) {
  const
    result: (number | [number, number])[] = [],  // number is a semicolon position, [number, number] is a comment range
    length = sql.length;

  let
    at = 0,
    ch: number;

  outerloop: for (; ;) {
    // end of string? return
    if (at >= length) return result;

    // jump to next character of interest
    at = indexAfter(sql, specialPattern, at);
    if (at === -1) return result;  // nothing else special, including semicolons, so we're done

    const atSpecial = at - 1;  // backtrack to the special character (or last thereof)
    ch = sql.charCodeAt(atSpecial);
    switch (ch) {
      case 59 /* ; */:
        result.push(atSpecial);
        break;

      case 34 /* " */:
      case 39 /* ' */:
        const isSingleQuote = ch === 39;
        let backslashing = false;
        if (isSingleQuote === true) {  // double quotes never allow backslash quote-escaping
          if (standardConformingStrings === false) backslashing = true;
          else {
            const chPrev = sql.charCodeAt(atSpecial - 1);
            if (chPrev === 69 /* E */ || chPrev === 101 /* e */) backslashing = true;
          }
        }
        for (; ;) {
          const re = isSingleQuote ? (backslashing ? singleQuoteOrBackslash : singleQuote) : doubleQuote;
          at = indexAfter(sql, re, at);
          if (at === -1) {  // unterminated string or identifier
            result.push(-1);
            return result;
          }
          // we've just consumed the relevant quote or backslash
          const chNext = sql.charCodeAt(at);
          if (chNext === ch) at += 1;  // this is a doubled-escaped quote
          else {
            if (isSingleQuote === false) continue outerloop;  // end of identifier
            // strings might continue after \s*\n\s* ...
            const continuingQuote = indexAfter(sql, whitespaceThenSingleQuote, at);
            if (continuingQuote === -1) continue outerloop;
            at = continuingQuote;
          }
        }

      case 45 /* - */:
        const singleCommentStart = atSpecial - 1;
        at = indexAfter(sql, newline, at);
        if (at === -1) at = sql.length;  // single-line comment extends to EOF
        result.push([singleCommentStart, at]);
        break;

      case 42 /* * */:
        const multiCommentStart = atSpecial - 1;
        let commentDepth = 1;
        for (; ;) {
          at = indexAfter(sql, commentOpenOrClose, at);
          if (at === -1) {  // unterminated multiline comment
            result.push(-1);
            return result;
          }
          const isOpening = sql.charCodeAt(at - 1) === 42 /* * */;
          commentDepth += isOpening ? 1 : -1;
          if (commentDepth === 0) {
            result.push([multiCommentStart, at]);
            break;
          }
        }

        break;

      case 36 /* $ */:
        const chPrevStr = sql.charAt(atSpecial - 1);
        if (identifierChars.test(chPrevStr)) break;  // $...$ strings can't immediately follow keyword/identifier characters because $ is legal in those

        const endTag = indexAfter(sql, dollarTag, at);
        if (endTag === -1) break;  // not a valid open dollar-quote

        const tagStr = sql.slice(atSpecial, endTag);
        at = sql.indexOf(tagStr, endTag);
        if (at === -1) {
          result.push(-1);
          return result;
        }
        at += tagStr.length;
        break;
    }
  }
}

function splitStatements(sql: string, cutComments: boolean, standardConformingStrings: boolean) {
  const
    positions = parseStatements(sql, standardConformingStrings),
    length = positions.length;
  
  if (positions[length - 1] === -1) return;  // if there were errors, return empty
  positions.push(sql.length);  // implicit semicolon at end

  const statements: string[] = [];
  let start = 0;
  let statement = '';

  for (const position of positions) {
    const isSemicolon = typeof position === 'number';
    statement += sql.slice(start, isSemicolon ? position : position[0]);

    if (isSemicolon) {
      statement = statement.trim();
      if (statement !== '') statements.push(statement);
      statement = '';
      start = position + 1;

    } else if (cutComments) {  // comment
      start = position[1];
    }
  }

  return statements;
}

test();

function check(sql: string, x?: number) {

  let
    parsed: any[] = [],
    error: any = undefined;

  try {
    parsed = parse(sql);
  } catch (err) {
    error = err;
  }

  const statements = splitStatements(sql, true, true);

  console.log(sql, statements, parsed.length, error?.message);

  if (error) {
    if (statements !== undefined) throw new Error(`Error not detected: ${error.message}`);
  } else {
    if (statements === undefined) throw new Error(`Non-existent error detected`);
    if (parsed.length !== statements.length) throw new Error(`Wrong number of queries detected`);
  }
}

function test() {
  // empties
  check(`;; ;;`);
  check(` ;;; `);

  // unterminated things
  check(`"`);
  check(`'`);
  check(`/*`);
  check(`select "`);
  check(`update ' `);
  check(`delete E' `);
  check(`delete U&'hello" `);
  check(`insert /*`);
  check(`select "x`);
  check(`update 'x`);
  check(`insert /*x`);
  check(`insert /*/* x */ y`);
  check(`$$`);
  check(`$$abc`);
  check(`$tag$`);
  check(`$tag$abc`);
  check(`$$abc$`);
  check(`$tag$abc$tag`);
  check(`$tag$abc$TAG$`);

  // simple, single-statement (no semi-colon)
  check(`select "a"`);
  check(`select"a"`);
  check(`select 'a'`);
  check(`select e'a'`);
  check(`select E'a'`);

  // nothing special
  check(`select "a";`);
  check(`select"a";`);
  check(`select 'a';`);
  check(`select e'a';`);
  check(`select E'a';`);
  check(`select "a"; select 1`);
  check(`select"a"; select 1`);
  check(`select 'a'; select "a"`);
  check(`select e'a'; select ''`);
  check(`select E'a'; select e''`);

  // doubled quotes
  check(`select "we ""love; quotes"; select 1`);
  check(`select 'we ''love; quotes'; select 1`);
  check(`select e'we ''love; quotes'; select 1`);
  check(`select E'we ''love; quotes'; select 1`);
  
  // backslashed quotes
  check(`select "we \\"love; quotes"; select 1;`);
  check(`select 'we \\'love; quotes'; select 1`);
  check(`select 'we \\'love; quotes'; select 1;`);
  check(`select e'we \\'love; quotes'; select 1`);
  check(`select E'we \\'love; quotes'; select 1;`);

  // run-on escaped strings
  check(`select  'x' 'we \\'love quotes';  select 1;`);  // should error (actually illegal, but also no reason to allow backslash escape)
  check(`select e'x' 'we \\'love quotes';select 1`);  // should error (actually illegal, but we treat as non-run-on, thus ordinary string)
  check(`select E'x' 'we \\'love quotes' ;select 1`);  // should error, as above
  check(`select 'x'\n 'we \\'love quotes'; select 1`);  // should error (run-on ordinary string)
  check(`select e'x'\n 'we \\'love quotes'; select 1`);  // OK: run-on escape string
  check(`select E'x'\n 'we \\'love quotes' ; select 1`);  // OK: ditto

  // $$ strings
  check(`select $$abc;def$$;`);
  check(`select $$ab"c;d'ef$$;`);
  check(`select $end$ab"c;d'ef$end$;`);
  check(`select $X_Y$\nab"c;d'ef\n$X_Y$; select $$/* \n--\n */$$; select $11$abc$11$;`);

  // single-line comments
  check(`-- abc; def`);
  check(`select "xyz"; -- OK \n select "abc";`);
  check(`select "xyz"; -- OK`);
  check(`select "xyz"--OK`);
  check(`--OK\n\nselect "xyz"`);

  // multiline comments
  check(`select/*/* ;;; */*/"xyz"; /* blah; */ select/***/"abc";/**/`);
  check(`/* select "xyz"; */`);
  check(`/**/`);
  check(`/**/select'"--;/**/;--"'/**/--`);

}

