### semicolons

This package exists to take a string containing multiple Postgres SQL statements, separated by semicolons, and split it into its constituent statements.

This is not trivial, because semicolons may occur in double-quoted identifiers, ordinary strings, 'escape' strings, continuation strings, dollar-quoted strings, single-line comments, and (nestable) multi-line comments. In all these cases they do not separate statements.

