/**
 * Monitoring and alerting system for audit events
 */

import { LogEntry } from '../types/index';
import notifier from 'node-notifier';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: (log: LogEntry) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  cooldownMinutes: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  logEntry: LogEntry;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
}

export interface MonitoringConfig {
  enabled: boolean;
  alertRetention: number; // days
  maxAlertsPerHour: number;
  webhookUrl?: string;
  emailNotifications?: {
    enabled: boolean;
    recipients: string[];
    smtpConfig?: any;
  };
  desktopNotifications?: {
    enabled: boolean;
  };
}

export class MonitoringSystem {
  private config: MonitoringConfig;
  private alertRules: Map<string, AlertRule> = new Map();
  private alerts: Alert[] = [];
  private lastAlertTime: Map<string, Date> = new Map();

  constructor(config: MonitoringConfig) {
    this.config = config;
    this.initializeDefaultRules();
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
  }

  removeAlertRule(ruleId: string): boolean {
    return this.alertRules.delete(ruleId);
  }

  updateAlertRule(ruleId: string, updates: Partial<AlertRule>): boolean {
    const rule = this.alertRules.get(ruleId);
    if (!rule) return false;

    this.alertRules.set(ruleId, { ...rule, ...updates });
    return true;
  }

  async processLogEntry(logEntry: LogEntry): Promise<Alert[]> {
    if (!this.config.enabled) return [];

    const triggeredAlerts: Alert[] = [];

    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;

      // Check cooldown
      const lastAlert = this.lastAlertTime.get(rule.id);
      if (lastAlert) {
        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        if (Date.now() - lastAlert.getTime() < cooldownMs) {
          continue;
        }
      }

      // Check condition
      if (rule.condition(logEntry)) {
        const alert = await this.createAlert(rule, logEntry);
        triggeredAlerts.push(alert);
        this.lastAlertTime.set(rule.id, new Date());
      }
    }

    return triggeredAlerts;
  }

  private async createAlert(rule: AlertRule, logEntry: LogEntry): Promise<Alert> {
    const alert: Alert = {
      id: this.generateAlertId(),
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      message: this.generateAlertMessage(rule, logEntry),
      timestamp: new Date(),
      logEntry,
      acknowledged: false,
    };

    this.alerts.push(alert);
    await this.sendNotification(alert);
    
    return alert;
  }

  private generateAlertMessage(rule: AlertRule, logEntry: LogEntry): string {
    const baseMessage = `${rule.name}: ${rule.description}`;
    const details = [
      `Command: ${logEntry.command}`,
      `User: ${logEntry.userId || 'unknown'}`,
      `Session: ${logEntry.sessionId}`,
      `Risk Level: ${logEntry.securityCheck.riskLevel}`,
      `Exit Code: ${logEntry.result.exitCode}`,
    ];

    return `${baseMessage}\n\nDetails:\n${details.join('\n')}`;
  }

  private async sendNotification(alert: Alert): Promise<void> {
    try {
      // Webhook notification
      if (this.config.webhookUrl) {
        await this.sendWebhookNotification(alert);
      }

      // Desktop notification
      if (this.config.desktopNotifications?.enabled) {
        await this.sendDesktopNotification(alert.ruleName, alert.message);  
      }
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  private async sendWebhookNotification(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) return;

    const payload = {
      alert: {
        id: alert.id,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp.toISOString(),
        rule: alert.ruleName,
      },
      command: alert.logEntry.command,
      user: alert.logEntry.userId,
      session: alert.logEntry.sessionId,
    };

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.error(`Failed to send webhook notification: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending webhook notification:', error);
    }
  }

  async sendDesktopNotification(title: string, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      notifier.notify({
        title,
        message,
        wait: false,
      }, (err, response, metadata) => {
        if (err) {
          console.error('Error sending desktop notification:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert || alert.acknowledged) return false;

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();

    return true;
  }

  getAlerts(filters?: {
    severity?: string;
    acknowledged?: boolean;
    since?: Date;
    limit?: number;
  }): Alert[] {
    let filteredAlerts = [...this.alerts];

    if (filters?.severity) {
      filteredAlerts = filteredAlerts.filter(a => a.severity === filters.severity);
    }

    if (filters?.acknowledged !== undefined) {
      filteredAlerts = filteredAlerts.filter(a => a.acknowledged === filters.acknowledged);
    }

    if (filters?.since) {
      filteredAlerts = filteredAlerts.filter(a => a.timestamp >= filters.since!);
    }

    // Sort by timestamp (newest first)
    filteredAlerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters?.limit) {
      filteredAlerts = filteredAlerts.slice(0, filters.limit);
    }

    return filteredAlerts;
  }

  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  private initializeDefaultRules(): void {
    // High-risk command execution
    this.addAlertRule({
      id: 'high-risk-command',
      name: 'High Risk Command Executed',
      description: 'A high-risk command was executed',
      condition: (log) => log.securityCheck.riskLevel === 'high',
      severity: 'high',
      enabled: true,
      cooldownMinutes: 5,
    });

    // Failed security check
    this.addAlertRule({
      id: 'security-violation',
      name: 'Security Policy Violation',
      description: 'Command blocked by security policy',
      condition: (log) => !log.securityCheck.allowed,
      severity: 'critical',
      enabled: true,
      cooldownMinutes: 1,
    });

    // Privileged command execution
    this.addAlertRule({
      id: 'privileged-command',
      name: 'Privileged Command Executed',
      description: 'Command executed with elevated privileges',
      condition: (log) => log.command.toLowerCase().includes('sudo') || log.command.toLowerCase().includes('su '),
      severity: 'medium',
      enabled: true,
      cooldownMinutes: 10,
    });

    // Command execution failure
    this.addAlertRule({
      id: 'command-failure',
      name: 'Command Execution Failed',
      description: 'Command failed with non-zero exit code',
      condition: (log) => log.result.exitCode !== 0,
      severity: 'low',
      enabled: true,
      cooldownMinutes: 15,
    });

    // Suspicious file operations
    this.addAlertRule({
      id: 'suspicious-file-ops',
      name: 'Suspicious File Operations',
      description: 'Potentially dangerous file operations detected',
      condition: (log) => {
        const cmd = log.command.toLowerCase();
        return cmd.includes('rm -rf') || cmd.includes('del /f /s') || cmd.includes('format');
      },
      severity: 'critical',
      enabled: true,
      cooldownMinutes: 1,
    });
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  cleanup(): void {
    // Remove old alerts based on retention policy
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.alertRetention);

    this.alerts = this.alerts.filter(alert => alert.timestamp >= cutoffDate);
  }
}
