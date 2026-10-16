export type EvalOperator = 'exists' | 'equals' | 'notEquals' | 'contains' | 'notContains' | 'arrayNotEmpty' | 'greaterThan' | 'lessThan' | 'matchesRegex';
export interface EvalRule {
    /** JSONPath dot notation. "$" = root result. "$.State" = result.State */
    field: string;
    operator: EvalOperator;
    /** Expected value. Omit for 'exists' and 'arrayNotEmpty'. */
    value?: string | boolean | number | string[];
    /** Human-readable label for evidence/finding output. */
    description: string;
}
export interface CommandEvalSpec {
    commandId: string;
    /** All rules must pass for COMPLIANT (AND logic). Set anyOf=true for OR. */
    eval: EvalRule[];
    anyOf?: boolean;
}
export interface EvalResult {
    commandId: string;
    compliant: boolean;
    ruleResults: Array<{
        rule: EvalRule;
        passed: boolean;
        actualValue: unknown;
    }>;
}
export interface EvalRulesFile {
    version: string;
    rules: Record<string, {
        eval: EvalRule[];
        anyOf?: boolean;
    }>;
}
//# sourceMappingURL=eval.types.d.ts.map