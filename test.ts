import { parseSplits, nonEmptyStatements } from '.';
import { parse } from 'pgsql-parser';

// compare our split of a string against the real pg parser
function compareSplits(sql: string) {
  let
    parsed: any[] = [],
    error: any = undefined;

  try {
    parsed = parse(sql);
  } catch (err) {
    error = err;
  }

  const { positions, unterminated } = parseSplits(sql, true);
  const statements = nonEmptyStatements(sql, positions);
  console.log({ sql, positions, unterminated, error: error?.message, statements });

  if (error) {
    if (unterminated === undefined) throw new Error('Error not detected');
  } else {
    if (unterminated !== undefined) throw new Error(`Non-existent error detected`);
    if (parsed.length !== statements.length) throw new Error(`Wrong number of queries detected`);
  }
}

function test() {
  [
    // empties
    `;; ;;`,
    ` ;;; `,

    // unterminated things
    `"`,
    `'`,
    `/*`,
    ` "`,
    ` '`,
    ` /*`,
    `" `,
    `' `,
    `/* `,
    `select "`,
    `update ' `,
    `delete E' `,
    `delete U&'hello" `,
    `insert /*`,
    `select "x`,
    `update 'x`,
    `insert /*x`,
    `insert /*/* x */ y`,
    `$$`,
    `$$abc`,
    `$tag$`,
    `$tag$abc`,
    `$$abc$`,
    `$tag$abc$tag`,
    `$tag$abc$TAG$`,

    // simple, single-statement (no semi-colon)
    `select "a"`,
    `select"a"`,
    `select 'a'`,
    `select e'a'`,
    `select E'a'`,

    // nothing special
    `select "a";`,
    `select"a";`,
    `select 'a';`,
    `select e'a';`,
    `select E'a';`,
    `select "a"; select 1`,
    `select"a"; select 1`,
    `select 'a'; select "a"`,
    `select e'a'; select ''`,
    `select E'a'; select e''`,
    `select'a';select"a"`,
    `select E'a';select e''`,
    `\nselect'a';select"a"\n`,

    // doubled quotes
    `select ";we ""love; quotes;"; select 1`,
    `select 'we ''love; quotes'; select 1`,
    `select e'we ''love; quotes'; select 1`,
    `select E'we ''love; ''q''uotes'; select 1`,

    // backslashed quotes
    `select "we \\"love; quotes"; select 1;`,
    `select 'we \\'love; quotes'; select 1`,
    `select 'we \\'love; quotes'; select 1;`,
    `select e'we \\'love; quotes'; select 1`,
    `select E'we \\'love; quotes'; select 1;`,

    // run-on escaped strings
    `select  'x' ';we \\'love; quotes';  select 1;`,  // should error (actually illegal, but also no reason to allow backslash escape,
    `select e'x' 'we \\'love quotes';select 1`,  // should error (actually illegal, but we treat as non-run-on, thus ordinary string,
    `select E'x' 'we \\'love quotes' ;select 1`,  // should error, as above
    `select 'x'\n 'we \\'love quotes'; select 1`,  // should error (run-on ordinary string,
    `select e'x'\n 'we \\'love quotes'; select 1`,  // OK: run-on escape string
    `select E';x;'\n ';we \\'love; quotes;' ; select 1`,  // OK: ditto

    // $$ strings
    `select $$abc;def$$;`,
    `select $$ab"c;d'ef$$;`,
    `select $end$ab"c;d'ef$end$;`,
    `select $X_Y$\nab"c;d'ef\n$X_Y$; select 1;`,
    `select $$/* \n--\n */$$; select $$$$;`,
    `select $11$abc$11$; select 1;`,
    `select $11+$abc$11+$abc$; select 1;`,
    `select $1; select $a$; select $a$;`,
    `select"$1";select'$1';select $1;`,
    `select a$aaa$a;`,
    `select 😀$aaa$😀; select 1;`,
    `select $😀$end$id$end$;`,
    `select 😀$end$x;`,
    `select $😀$;end;$😀$;`,
    `select 1$end$x;`,
    `select a$$aaa$$a;`,
    `select a$$$aaa$$$a;`,
    `select a$$a; select a$$a;`,
    `select $aa$;`,
    `select $$$$; select $$$$;`,
    `select $$; $;$ ;$$;`,
    `select $a$ $;$ $a$;`,
    `select $xx$$xx$;`,
    `select $xx$x;;;x$xx$;`,
    `create function x() returns int as $$ select 1; select 2; $$ language sql;`,
    `create function x() returns int as $end$ select 1; select 2; $end$ language sql;`,

    // single-line comments
    `-- abc; def`,
    `select "xyz"; -- OK \n select "abc";`,
    `select "xyz"; -- OK`,
    `select "xyz"--OK`,
    `--OK\n\nselect "xyz"`,
    `select--OK;\n1--;OK\n+2; select x;`,

    // multiline comments
    `select/*/* ;;; */*/"xyz"; /* blah; */ select/***/"abc";/**//*;select 1*/`,
    `/* select "xyz"; */`,
    `/**/`,
    `/**/select'"--;/**/;--"'/**/--`,

    // mixed
    ` -- \n select/**/1\n, ';abc''def;g',\ne';abc\\'def;g;', ";x""y;z;", e';abc;'\n';abc\\'d;ef;', /*;/*;\n*/;*/ $ab$$;c\n;d;$$ab$, $$\n;a;b;$$, a$$a$$ --\n;select 1; --`,

  ].forEach(compareSplits);
}

test();
