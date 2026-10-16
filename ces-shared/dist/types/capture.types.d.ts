export interface StampCaptureSubCommand {
    subId: string;
    engine: string;
    status: 'pass' | 'fail' | 'skip';
    commandExecuted?: string;
    getCommandExecuted?: string;
    preState?: unknown;
    postState?: unknown;
    evidenceOutputs?: string[];
    captures?: Record<string, string>;
}
export interface StampCaptureTask {
    taskId: string;
    label: string;
    controlIds: string[];
    status: 'pass' | 'fail' | 'skip';
    engine: string;
    subCommands: StampCaptureSubCommand[];
}
export interface StampCaptureEvent {
    eventId: string;
    planId: string;
    tenantId: string;
    executedAt: string;
    executedBy: string;
    dryRun: boolean;
    resolvedVariables: Record<string, string>;
    tasks: StampCaptureTask[];
}
export interface StampCaptureResult {
    accepted: boolean;
    runId: string;
    artifactsWritten: number;
    errors: string[];
}
//# sourceMappingURL=capture.types.d.ts.map