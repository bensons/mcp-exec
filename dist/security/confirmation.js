"use strict";
/**
 * Confirmation manager for dangerous operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmationManager = void 0;
class ConfirmationManager {
    pendingConfirmations = new Map();
    confirmationTimeout = 300000; // 5 minutes
    constructor(confirmationTimeout) {
        if (confirmationTimeout) {
            this.confirmationTimeout = confirmationTimeout;
        }
        // Clean up expired confirmations every minute
        setInterval(() => {
            this.cleanupExpiredConfirmations();
        }, 60000);
    }
    createConfirmation(command, validation) {
        const confirmationId = this.generateConfirmationId();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.confirmationTimeout);
        const confirmation = {
            id: confirmationId,
            command,
            riskLevel: validation.riskLevel,
            reason: validation.reason || 'Command requires confirmation',
            timestamp: now,
            expiresAt,
        };
        this.pendingConfirmations.set(confirmationId, confirmation);
        return confirmationId;
    }
    confirmCommand(confirmationId) {
        const confirmation = this.pendingConfirmations.get(confirmationId);
        if (!confirmation) {
            return false;
        }
        if (new Date() > confirmation.expiresAt) {
            this.pendingConfirmations.delete(confirmationId);
            return false;
        }
        this.pendingConfirmations.delete(confirmationId);
        return true;
    }
    getPendingConfirmation(confirmationId) {
        const confirmation = this.pendingConfirmations.get(confirmationId);
        if (confirmation && new Date() > confirmation.expiresAt) {
            this.pendingConfirmations.delete(confirmationId);
            return undefined;
        }
        return confirmation;
    }
    getAllPendingConfirmations() {
        this.cleanupExpiredConfirmations();
        return Array.from(this.pendingConfirmations.values());
    }
    cancelConfirmation(confirmationId) {
        return this.pendingConfirmations.delete(confirmationId);
    }
    generateConfirmationId() {
        return `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    cleanupExpiredConfirmations() {
        const now = new Date();
        for (const [id, confirmation] of this.pendingConfirmations.entries()) {
            if (now > confirmation.expiresAt) {
                this.pendingConfirmations.delete(id);
            }
        }
    }
    getConfirmationTimeout() {
        return this.confirmationTimeout;
    }
    setConfirmationTimeout(timeout) {
        this.confirmationTimeout = timeout;
    }
}
exports.ConfirmationManager = ConfirmationManager;
//# sourceMappingURL=confirmation.js.map