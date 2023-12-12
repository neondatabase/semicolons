
/**
 * Identifies semi-colons that separate SQL statements, plus SQL comments.
 * @param sql One or more SQL statements, separated by semi-colons.
 * @param standardConformingStrings If `false`, quotes may be backslash-escaped in ordinary strings.
 * @returns Positions of semicolons and comments, plus an indicator of an unterminated range type.
 */
export function parseSplits(sql: string, standardConformingStrings: boolean): { positions: (number | [number, number])[]; unterminated?: string };

/**
 * Uses the output of `parseSplits` to split a string into separate SQL statements.
 * @param sql One or more SQL statements, separated by semi-colons.
 * @param positions The `positions` key of the `parseSplits` output.
 * @param cutComments If `true`, remove comments from statements.
 * @returns An array of SQL statements. Some may be empty, or contain only comments.
 */
export function splitStatements(sql: string, positions: (number | [number, number])[], cutComments: boolean): string[];

/**
 * Uses the output of `parseSplits` to split a string into separate SQL statements, including comments. 
 * Returned statements are guaranteed non-empty (even if comments were to be removed).
 * @param sql One or more SQL statements, separated by semi-colons.
 * @param positions The `positions` key of the `parseSplits` output.
 * @returns An array of non-empty SQL statements.
 */
export function nonEmptyStatements(sql: string, positions: (number | [number, number])[]): string[];
