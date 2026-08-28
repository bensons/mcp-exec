/**
 * Confirmation manager for dangerous operations
 */

import { ValidationResult } from '../types/index';

/** Runs the confirmed command and returns the text to hand back to the caller. */
export type PendingCommandRunner = () => Promise<string>;

export interface PendingConfirmation {
  id: string;
  command: string;
  riskLevel: 'low' | 'medium' | 'high';
  reason: string;
  timestamp: Date;
  expiresAt: Date;
  source?: string;
  // Not serialized by JSON.stringify (functions are dropped), so pending
  // confirmations can still be listed verbatim over MCP.
  run?: PendingCommandRunner;
}

export class ConfirmationManager {
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map();
  private confirmationTimeout: number = 300000; // 5 minutes
  private cleanupInterval: NodeJS.Timeout;

  constructor(confirmationTimeout?: number) {
    if (confirmationTimeout) {
      this.confirmationTimeout = confirmationTimeout;
    }

    // Clean up expired confirmations every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredConfirmations();
    }, 60000);
    this.cleanupInterval.unref?.();
  }

  /** Clears the cleanup timer and drops every pending confirmation. */
  cleanup(): void {
    clearInterval(this.cleanupInterval);
    this.pendingConfirmations.clear();
  }

  createConfirmation(
    command: string,
    validation: ValidationResult,
    run?: PendingCommandRunner,
    source?: string
  ): string {
    const confirmationId = this.generateConfirmationId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.confirmationTimeout);

    const confirmation: PendingConfirmation = {
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
  confirmCommand(confirmationId: string): PendingConfirmation | undefined {
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

  getPendingConfirmation(confirmationId: string): PendingConfirmation | undefined {
    const confirmation = this.pendingConfirmations.get(confirmationId);
    
    if (confirmation && new Date() > confirmation.expiresAt) {
      this.pendingConfirmations.delete(confirmationId);
      return undefined;
    }

    return confirmation;
  }

  getAllPendingConfirmations(): PendingConfirmation[] {
    this.cleanupExpiredConfirmations();
    return Array.from(this.pendingConfirmations.values());
  }

  cancelConfirmation(confirmationId: string): boolean {
    return this.pendingConfirmations.delete(confirmationId);
  }

  private generateConfirmationId(): string {
    return `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private cleanupExpiredConfirmations(): void {
    const now = new Date();
    for (const [id, confirmation] of this.pendingConfirmations.entries()) {
      if (now > confirmation.expiresAt) {
        this.pendingConfirmations.delete(id);
      }
    }
  }

  getConfirmationTimeout(): number {
    return this.confirmationTimeout;
  }

  setConfirmationTimeout(timeout: number): void {
    this.confirmationTimeout = timeout;
  }
}
