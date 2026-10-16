export type CuiAccess = 'full' | 'none' | 'pending' | 'revoked' | 'constrained';
export interface Persona {
    id: string;
    title: string;
    description: string;
    cuiAccess: CuiAccess;
    /** Controls this persona is OPERATIONALLY responsible for / whose deficiencies are theirs. */
    controls: string[];
    /** Whether this persona is gated on awareness training before/for access (AT.L2-3.2.2). */
    trainingGated?: boolean;
    /** Whether this persona is a personnel-lifecycle subject (screening / offboarding). */
    personnelSubject?: boolean;
}
export interface PersonaReference {
    personas: Persona[];
}
//# sourceMappingURL=persona.types.d.ts.map