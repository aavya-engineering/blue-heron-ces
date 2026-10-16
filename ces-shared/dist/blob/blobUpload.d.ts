import type { EvidenceStorageConfig } from '../config/TenantConfig.js';
export type { EvidenceStorageConfig } from '../config/TenantConfig.js';
export interface BlobUploadResult {
    success: boolean;
    url: string;
    error?: string;
}
export interface BlobListEntry {
    name: string;
    properties: {
        contentLength?: string;
        lastModified?: string;
    };
}
export interface BlobListResult {
    success: boolean;
    blobs: string[];
    error?: string;
}
export interface BlobDownloadResult {
    success: boolean;
    content: string;
    error?: string;
}
/**
 * Upload a text blob to Azure Blob Storage using SharedKey authentication.
 */
export declare function uploadEvidenceBlob(config: EvidenceStorageConfig, blobPath: string, content: string): Promise<BlobUploadResult>;
/**
 * Download a blob by path. Returns content string or null if not found.
 */
export declare function downloadBlob(config: EvidenceStorageConfig, blobPath: string): Promise<string | null>;
/**
 * List blobs under a prefix. Returns array of blob entries with name and properties.
 */
export declare function listBlobs(config: EvidenceStorageConfig, prefix: string): Promise<BlobListEntry[]>;
/**
 * List blobs in the tenant's evidence container under base_path prefix.
 * Returns relative blob names (full path within the container).
 */
export declare function listEvidenceBlobs(config: EvidenceStorageConfig): Promise<BlobListResult>;
/**
 * Download a single blob's content from the tenant's evidence storage.
 */
export declare function downloadEvidenceBlob(config: EvidenceStorageConfig, blobPath: string): Promise<BlobDownloadResult>;
//# sourceMappingURL=blobUpload.d.ts.map