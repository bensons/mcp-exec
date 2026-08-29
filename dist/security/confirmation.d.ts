/**
 * Confirmation manager for dangerous operations
 */
import { ValidationResult } from '../types/index';
/** Runs the confirmed command and returns the text to hand back to the caller. */
export type PendingCommandRunner = () => Promise<string>;
export declare const DEFAULT_MAX_PENDING_CONFIRMATIONS = 100;
export interface PendingConfirmation {
    id: string;
    command: string;
    riskLevel: 'low' | 'medium' | 'high';
    reason: string;
    timestamp: Date;
    expiresAt: Date;
    source?: string;
    run?: PendingCommandRunner;
}
export declare class ConfirmationManager {
    private pendingConfirmations;
    private confirmationTimeout;
    private readonly maxPendingConfirmations;
    private cleanupInterval;
    constructor(confirmationTimeout?: number, maxPendingConfirmations?: number);
    /** Clears the cleanup timer and drops every pending confirmation. */
    cleanup(): void;
    createConfirmation(command: string, validation: ValidationResult, run?: PendingCommandRunner, source?: string): string;
    /**
     * Consumes a pending confirmation. Returns the entry (so the caller can run
     * it) or undefined when it is unknown, already used, or expired.
     */
    confirmCommand(confirmationId: string): PendingConfirmation | undefined;
    getPendingConfirmation(confirmationId: string): PendingConfirmation | undefined;
    getAllPendingConfirmations(): PendingConfirmation[];
    cancelConfirmation(confirmationId: string): boolean;
    private generateConfirmationId;
    private cleanupExpiredConfirmations;
    getConfirmationTimeout(): number;
    getMaxPendingConfirmations(): number;
    setConfirmationTimeout(timeout: number): void;
}
//# sourceMappingURL=confirmation.d.ts.map