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

export class ConfirmationManager {
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map();
  private confirmationTimeout: number = 300000; // 5 minutes

  constructor(confirmationTimeout?: number) {
    if (confirmationTimeout) {
      this.confirmationTimeout = confirmationTimeout;
    }

    // Clean up expired confirmations every minute
    setInterval(() => {
      this.cleanupExpiredConfirmations();
    }, 60000);
  }

  createConfirmation(command: string, validation: ValidationResult): string {
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
    };

    this.pendingConfirmations.set(confirmationId, confirmation);
    return confirmationId;
  }

  confirmCommand(confirmationId: string): boolean {
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
