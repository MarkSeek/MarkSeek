// Type declarations for journal-layout.mjs.
//
// The implementation is plain ESM so the Node backend and the TypeScript
// frontend can both import it without a build step; this file is what gives
// the frontend its types (`.d.mts` is the declaration form of `.mjs`).

export declare const JOURNALS_DIR: string
export declare const DAY_FILE_RE: RegExp
export declare const YEAR_RE: RegExp
export declare const MONTH_RE: RegExp
export declare const JOURNAL_PATH_RE: RegExp
export declare function monthDirPath(yyyyMm: string): string
export declare function journalFilePath(ymd: string): string | null
