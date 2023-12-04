#!/usr/bin/env ts-node --files

import { parse } from 'pgsql-parser';

const
  ordinaryChars = /[^-/'"$;]*/y,
  notDoubleQuote = /[^"]*/y,
  notSingleQuote = /[^']*/y,
  notSingleQuoteOrBackslash = /[^'\\]*/y,
  whitespaceThenSingleQuote = /\s*\n\s*'/y,
  notNewline = /[^\n]*/y,
  commentOpenOrClose = /.*?([/][*]|[*][/])/y,
  nonIdentifierCharacter = /[\x00-\x23\x25-\x2f\x3a-\x40\x5b-\x5e\x60\x7b-\x7f]/y;

function indexAfter(str: string, re: RegExp, from: number) {
  re.lastIndex = from;
  const matched = re.test(str);
  return matched ? re.lastIndex : -1;
}

function meaningfulSemicolons(sql: string, standardConformingStrings: boolean) {
  const
    positions: number[] = [],
    length = sql.length;

  let
    at = 0,
    ch: number;

  outerloop: for (; ;) {
    // end of string? return
    if (at >= length) return positions;

    // jump to next character of interest
    at = indexAfter(sql, ordinaryChars, at);
    if (at === -1) return positions;  // no more? return

    ch = sql.charCodeAt(at);
    switch (ch) {
      case 59 /* ; */:
        positions.push(at);
        at += 1;
        break;

      case 34 /* " */:
      case 39 /* ' */:
        const singleQuote = ch === 39;
        let backslashing = false;
        if (singleQuote === true) {  // double quotes never allow backslash quote-escaping
          if (standardConformingStrings === false) backslashing = true;
          else {
            const chPrev = sql.charCodeAt(at - 1);
            if (chPrev === 69 /* E */ || chPrev === 101 /* e */) backslashing = true;
          }
        }
        for (; ;) {
          const re = singleQuote ? (backslashing ? notSingleQuoteOrBackslash : notSingleQuote) : notDoubleQuote;
          at = indexAfter(sql, re, at + 1);
          // we're now at a relevant quote or backslash (or EOF)
          const chNext = sql.charCodeAt(at += 1);
          if (chNext !== ch) {  // this is not a doubled-escaped quote
            if (isNaN(chNext)) {  // unterminated string or identifier
              positions.push(-1);
              return positions;
            }
            if (singleQuote === false) continue outerloop;  // end of identifier
            // strings might continue after \s*\n\s* ...
            const continuingQuote = indexAfter(sql, whitespaceThenSingleQuote, at);
            if (continuingQuote === -1) continue outerloop;
            at = continuingQuote;
          }
        }

      case 45 /* - */:
        ch = sql.charCodeAt(at += 1);
        if (ch === 45 /* - */) at = indexAfter(sql, notNewline, at) + 1;
        break;

      case 47 /* / */:
        ch = sql.charCodeAt(at += 1);
        if (ch === 42 /* * */) {  // start multi-line comment?
          at += 1;
          let commentDepth = 1;
          for (; ;) {
            at = indexAfter(sql, commentOpenOrClose, at);
            if (at === -1) {
              positions.push(-1);
              return positions;  // unterminated multiline comment
            }
            const isOpening = sql.charCodeAt(at - 1) === 42 /* * */;
            commentDepth += isOpening ? 1 : -1;
            if (commentDepth === 0) break;
          }
        }
        break;

      case 36 /* $ */:

    }
  }
}

//console.log(meaningfulSemicolons(`x/* 1; /* 2; */*/ -- ; \n; a 'b;''";c';;select "x""y;'z";select e'abc\\'c;d'  \n'e''f\\'g;h'`, true));
console.log(meaningfulSemicolons(`'`, true));


function expect(sql: string, x: number) {
  let 
    parsed: any[] = [],
    error: any;

  try { 
    parsed = parse(sql); 
  } catch (err) {
    error = err;
  }
  
  const semis = meaningfulSemicolons(sql, true);
  console.log(semis, parsed);
}

function test() {
  expect(`"`, 1);
  expect(`'`, 1);

  // pass-through
  expect(`select "a"`, 1);
  expect(`select"a"`, 1);
  expect(`select 'a'`, 1);
  expect(`select e'a'`, 1);
  expect(`select E'a'`, 1);

  // nothing special
  expect(`select "a";`, 1);
  expect(`select"a";`, 1);
  expect(`select 'a';`, 1);
  expect(`select e'a';`, 1);
  expect(`select E'a';`, 1);
  expect(`select "a"; x`, 2);
  expect(`select"a"; y`, 2);
  expect(`select 'a'; ""`, 2);
  expect(`select e'a'; ''`, 2);
  expect(`select E'a'; e''`, 2);

  // doubled quotes
  expect(`select "we ""love quotes";qq`, 2);
  expect(`select 'we ''love quotes'; qq`, 2);
  expect(`select e'we ''love quotes';"y"`, 2);
  expect(`select E'we ''love quotes'; 'x'`, 2);

  // backslashed quotes
  expect(`select "we \\"love quotes"; 1;`, 1);
  expect(`select 'we \\'love quotes'; 1`, 1);
  expect(`select 'we \\'love quotes'; 1;`, 2);
  expect(`select e'we \\'love quotes'; 1`, 2);
  expect(`select E'we \\'love quotes'; 1;`, 2);

  // run-on escaped strings
  expect(`select 'x' 'we \\'love quotes'; q;`, 1);
  expect(`select e'x' 'we \\'love quotes'; q`, 2);
  expect(`select E'x' 'we \\'love quotes' ; q ;`, 2);
  expect(`select e'x'\n 'we \\'love quotes' q;`, 2);
  expect(`select E'x'\n 'we \\'love quotes' ; q`, 2);
}

