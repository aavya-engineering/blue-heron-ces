/** Write a JSON artifact to an absolute path (creates parent dirs). The one place JSON hits disk. */
export declare function writeJsonArtifact(absPath: string, data: unknown, opts?: {
    pretty?: boolean;
    trailingNewline?: boolean;
}): void;
/** Append one JSON line to a .jsonl artifact (creates parent dirs). */
export declare function appendJsonlArtifact(absPath: string, entry: unknown): void;
/** Write a text/markdown/other artifact to an absolute path (creates parent dirs). */
export declare function writeTextArtifact(absPath: string, text: string): void;
/** Append text (e.g. a diagnostic log line) to an artifact (creates parent dirs). */
export declare function appendTextArtifact(absPath: string, text: string): void;
/** Read + parse a JSON artifact, or null if it does not exist. */
export declare function readJsonArtifact<T = unknown>(absPath: string): T | null;
//# sourceMappingURL=fileArtifacts.d.ts.map