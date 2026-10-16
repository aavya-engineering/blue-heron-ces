export * from './StackProvider.js';
import { StackRegistry, type StackProvider, type StackId } from './StackProvider.js';
export { microsoftGccHighProvider } from './providers/microsoftGccHigh.js';
export { exampleStubProvider, EXAMPLE_STUB_STACK_ID } from './providers/exampleStub.js';
export { googleWorkspaceCloudProvider, GOOGLE_WORKSPACE_CLOUD_STACK_ID } from './providers/googleWorkspaceCloud.js';
/** The default registry: Microsoft (reference) + the example proof stub + Google Workspace. */
export declare const defaultStackRegistry: StackRegistry;
/** Resolve a provider by stack id from the default registry. */
export declare function getStackProvider(id: StackId): StackProvider;
/** Resolve the active provider from config (stack id via resolveStackId; default = Microsoft). */
export declare function getActiveStackProvider(config: {
    stack?: string;
} | undefined): StackProvider;
//# sourceMappingURL=index.d.ts.map