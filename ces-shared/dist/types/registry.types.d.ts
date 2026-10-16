/**
 * Local mirror of Stamper's CommandEntry shape.
 * No build-time dependency on Stamper — reads registry JSON at runtime.
 */
export interface CommandEntry {
    entry_id: string;
    control_ids: string[];
    label: string;
    engine: string;
    set_command: string;
    get_command: string;
    idempotency: string;
    variables_required: string[];
    variables_runtime: string[];
    captures: Array<{
        var_name: string;
        from: 'stdout' | 'json_field' | 'regex';
        json_path?: string;
        regex_pattern?: string;
    }>;
    layer_hint: number;
    sequence_hint: number;
    manual_only: boolean;
    evidence_commands: string[];
    on_failure: 'abort_step' | 'abort_plan' | 'warn_continue';
    notes?: string;
}
export interface CommandRegistryFile {
    version: string;
    generated_on: string;
    description?: string;
    entries: CommandEntry[];
}
//# sourceMappingURL=registry.types.d.ts.map