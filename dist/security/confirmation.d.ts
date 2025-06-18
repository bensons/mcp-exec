/**
 * Confirmation manager for dangerous operations
 */
import { ValidationResult } from '../types/index';
export interface PendingConfirmation {
    id: string;
    command: string;
    riskLevel: 'low' | 'medium' | 'high';
    reason: string;
    timestamp: Date;
    expiresAt: Date;
}
export declare class ConfirmationManager {
    private pendingConfirmations;
    private confirmationTimeout;
    constructor(confirmationTimeout?: number);
    createConfirmation(command: string, validation: ValidationResult): string;
    confirmCommand(confirmationId: string): boolean;
    getPendingConfirmation(confirmationId: string): PendingConfirmation | undefined;
    getAllPendingConfirmations(): PendingConfirmation[];
    cancelConfirmation(confirmationId: string): boolean;
    private generateConfirmationId;
    private cleanupExpiredConfirmations;
    getConfirmationTimeout(): number;
    setConfirmationTimeout(timeout: number): void;
}
//# sourceMappingURL=confirmation.d.ts.map