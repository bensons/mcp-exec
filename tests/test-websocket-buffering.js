const { TerminalSessionManager } = require('../dist/terminal/terminal-session-manager.js');
const { TerminalViewerService } = require('../dist/terminal/viewer-service.js');

async function testWebsocketBuffering() {
  console.log('Testing websocket buffering fix...');

  // Create terminal viewer service with buffering disabled
  const viewerService = new TerminalViewerService({
    enabled: true,
    port: 3001,
    host: 'localhost',
    maxSessions: 5,
    sessionTimeout: 300000,
    bufferSize: 1000,
    enableAuth: false,
    disableWebSocketBuffering: true // Enable immediate transmission
  });

  // Create terminal session manager
  const sessionManager = new TerminalSessionManager(
    {
      maxInteractiveSessions: 10,
      sessionTimeout: 1800000,
      outputBufferSize: 1000
    },
    {
      enabled: true,
      port: 3001,
      host: 'localhost',
      maxSessions: 5,
      sessionTimeout: 300000,
      bufferSize: 1000,
      enableAuth: false
    }
  );

  try {
    // Start the viewer service
    await viewerService.start();
    console.log('✅ Terminal viewer service started');

    // Create a terminal session
    const sessionId = await sessionManager.startSession({
      command: 'echo',
      args: ['Hello World'],
      enableTerminalViewer: true
    });
    console.log('✅ Terminal session created:', sessionId);

    // Add session to viewer service
    const session = sessionManager['sessions'].get(sessionId);
    if (session) {
      viewerService.addSession(session);
      console.log('✅ Session added to viewer service');
    }

    // Test rapid output
    console.log('Testing rapid output transmission...');
    const startTime = Date.now();
    
    // Send multiple commands rapidly
    for (let i = 0; i < 10; i++) {
      await sessionManager.sendInput({
        sessionId,
        input: `echo "Test message ${i}"`,
        addNewline: true
      });
      // Small delay to simulate rapid input
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const endTime = Date.now();
    console.log(`✅ Rapid output test completed in ${endTime - startTime}ms`);

    // Check if session is still running
    const sessionStatus = sessionManager['sessions'].get(sessionId);
    console.log('Session status:', sessionStatus?.status);

    // Cleanup
    await sessionManager.killSession(sessionId);
    await viewerService.stop();
    console.log('✅ Test completed successfully');

  } catch (error) {
    console.error('❌ Test failed:', error);
    
    // Cleanup on error
    try {
      await viewerService.stop();
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
  }
}

// Run the test
testWebsocketBuffering().catch(console.error); 