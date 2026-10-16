export interface SignalDefinition {
    type: 'graph' | 'powershell' | 'manual';
    endpoint?: string;
    filter?: string;
    required?: boolean;
    variables?: string[];
}
export interface ControlSignalEntry {
    signals: SignalDefinition[];
    evaluator: string;
}
export type ControlSignalRegistry = Record<string, ControlSignalEntry>;
//# sourceMappingURL=signal-registry.types.d.ts.map