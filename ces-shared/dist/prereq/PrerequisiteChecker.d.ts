export interface ModulePrerequisite {
    name: string;
    session: string;
    testCommand: string;
    installCommand: string;
    required: boolean;
}
export interface ModuleCheckResult {
    name: string;
    session: string;
    installed: boolean;
    version: string | null;
    required: boolean;
}
export declare const MODULE_PREREQUISITES: ModulePrerequisite[];
export interface CertCheckResult {
    found: boolean;
    subject: string | null;
    expiry: string | null;
    expired: boolean;
}
export declare class PrerequisiteChecker {
    /** Check all modules and return their installed status. */
    checkAll(): Promise<ModuleCheckResult[]>;
    /** Check a single module. */
    private checkModule;
    /** Install a module, streaming progress lines via callback. Returns exit code. */
    installModule(name: string, onProgress: (line: string) => void): {
        promise: Promise<number>;
        kill: () => void;
    };
    /** Check if a certificate with the given thumbprint exists in Cert:\CurrentUser\My. */
    checkCertificate(thumbprint: string): Promise<CertCheckResult>;
    /** Import a PFX certificate, streaming progress. Returns exit code. */
    importCertificate(pfxPath: string, password: string, onProgress: (line: string) => void): {
        promise: Promise<number>;
        kill: () => void;
    };
    /** Get PowerShell version string. */
    getPSVersion(): Promise<string | null>;
    private execPS;
}
//# sourceMappingURL=PrerequisiteChecker.d.ts.map