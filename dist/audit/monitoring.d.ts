/**
 * Monitoring and alerting system for audit events
 */
import { LogEntry } from '../types/index';
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
    alertRetention: number;
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
export declare class MonitoringSystem {
    private config;
    private alertRules;
    private alerts;
    private lastAlertTime;
    constructor(config: MonitoringConfig);
    addAlertRule(rule: AlertRule): void;
    removeAlertRule(ruleId: string): boolean;
    updateAlertRule(ruleId: string, updates: Partial<AlertRule>): boolean;
    processLogEntry(logEntry: LogEntry): Promise<Alert[]>;
    private createAlert;
    private generateAlertMessage;
    private sendNotification;
    private sendWebhookNotification;
    sendDesktopNotification(title: string, message: string): Promise<void>;
    acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean;
    getAlerts(filters?: {
        severity?: string;
        acknowledged?: boolean;
        since?: Date;
        limit?: number;
    }): Alert[];
    getAlertRules(): AlertRule[];
    private initializeDefaultRules;
    private generateAlertId;
    cleanup(): void;
}
//# sourceMappingURL=monitoring.d.ts.map