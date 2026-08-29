"use strict";
/**
 * Confirmation manager for dangerous operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmationManager = exports.DEFAULT_MAX_PENDING_CONFIRMATIONS = void 0;
exports.DEFAULT_MAX_PENDING_CONFIRMATIONS = 100;
class ConfirmationManager {
    pendingConfirmations = new Map();
    confirmationTimeout = 300000; // 5 minutes
    maxPendingConfirmations;
    cleanupInterval;
    constructor(confirmationTimeout, maxPendingConfirmations = exports.DEFAULT_MAX_PENDING_CONFIRMATIONS) {
        if (confirmationTimeout) {
            this.confirmationTimeout = confirmationTimeout;
        }
        if (!Number.isInteger(maxPendingConfirmations) || maxPendingConfirmations <= 0) {
            throw new Error('Maximum pending confirmations must be a positive integer');
        }
        this.maxPendingConfirmations = maxPendingConfirmations;
        // Clean up expired confirmations every minute
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredConfirmations();
        }, 60000);
        this.cleanupInterval.unref?.();
    }
    /** Clears the cleanup timer and drops every pending confirmation. */
    cleanup() {
        clearInterval(this.cleanupInterval);
        this.pendingConfirmations.clear();
    }
    createConfirmation(command, validation, run, source) {
        this.cleanupExpiredConfirmations();
        if (this.pendingConfirmations.size >= this.maxPendingConfirmations) {
            throw new Error(`Maximum pending confirmations (${this.maxPendingConfirmations}) reached`);
        }
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
            source,
            run,
        };
        this.pendingConfirmations.set(confirmationId, confirmation);
        return confirmationId;
    }
    /**
     * Consumes a pending confirmation. Returns the entry (so the caller can run
     * it) or undefined when it is unknown, already used, or expired.
     */
    confirmCommand(confirmationId) {
        const confirmation = this.pendingConfirmations.get(confirmationId);
        if (!confirmation) {
            return undefined;
        }
        this.pendingConfirmations.delete(confirmationId);
        if (new Date() > confirmation.expiresAt) {
            return undefined;
        }
        return confirmation;
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
    getMaxPendingConfirmations() {
        return this.maxPendingConfirmations;
    }
    setConfirmationTimeout(timeout) {
        this.confirmationTimeout = timeout;
    }
}
exports.ConfirmationManager = ConfirmationManager;
//# sourceMappingURL=confirmation.js.map