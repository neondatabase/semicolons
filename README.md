## semicolons

This package exists to take a string containing multiple Postgres SQL statements, separated by semicolons, and split it into its constituent statements.

This isn't trivial, because semicolons may occur in double-quoted identifiers, ordinary strings, 'escape' strings, continuation strings, dollar-quoted strings, single-line comments, and (nestable) multi-line comments, and in all these cases they do not separate statements.

Sticky RegExps are used liberally.

Used as part of Neon's SQL Editor, as discussed at https://neon.tech/blog/bringing-psqls-d-to-your-web-browser

Kick the tyres there, or at https://semicolons.pages.dev/

### Installation

```sh
npm install postgres-semicolons
```

### Usage

The exported functions have comprehensive [TSDoc](https://tsdoc.org/) comments in [`index.ts`](index.ts).

An example:

```javascript
import * as semicolons from 'postgres-semicolons';

const sql = `BEGIN; /*/* SELECT 1; */ SELECT 2; */; SELECT ';'';'; SELECT $x$;$x$; -- COMMIT;`;
const standardConformingStrings = true; 
const splits = semicolons.parseSplits(sql, standardConformingStrings);
const queries = semicolons.nonEmptyStatements(sql, splits.positions);

console.log(queries);  // -> [ 'BEGIN', "SELECT ';'';'", 'SELECT $x$;$x$' ]
```

### License

The code is [MIT licensed](LICENSE).
