const { MonitoringSystem } = require('../dist/audit/monitoring.js');

const monitoring = new MonitoringSystem({
  enabled: true,
  alertRetention: 1,
  maxAlertsPerHour: 10,
  desktopNotifications: { enabled: true }
});

// Minimal fake log entry to trigger a high-risk alert
const logEntry = {
  id: 'test1',
  timestamp: new Date(),
  sessionId: 'sess1',
  userId: 'tester',
  command: 'rm -rf /',
  context: {
    sessionId: 'sess1',
    currentDirectory: '/',
    workingDirectory: '/',
    environment: {},
    environmentVariables: {},
    commandHistory: [],
    outputCache: {},
    fileSystemChanges: [],
    previousCommands: []
  },
  result: {
    stdout: '',
    stderr: '',
    exitCode: 0,
    metadata: {
      executionTime: 0,
      commandType: 'file-operation',
      affectedResources: [],
      warnings: [],
      suggestions: []
    },
    summary: {
      success: true,
      mainResult: '',
      sideEffects: []
    }
  },
  securityCheck: {
    allowed: true,
    riskLevel: 'high'
  }
};

monitoring.processLogEntry(logEntry).then(() => {
  console.log('If desktop notifications are enabled, you should see one now.');
  process.exit(0);
}); 