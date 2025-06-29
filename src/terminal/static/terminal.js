/**
 * Terminal Viewer Frontend JavaScript
 */

let terminal;
let websocket;
let fitAddon;
let webLinksAddon;
let sessionId;
let host;
let port;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectDelay = 1000;

function initTerminal(sid, h, p) {
    console.log('[DEBUG] initTerminal called with:', { sessionId: sid, host: h, port: p });
    sessionId = sid;
    host = h;
    port = p;

    console.log('[DEBUG] Calling setupTerminal...');
    setupTerminal();
    console.log('[DEBUG] Calling connectWebSocket...');
    connectWebSocket();
    console.log('[DEBUG] Calling setupEventListeners...');
    setupEventListeners();
    console.log('[DEBUG] initTerminal completed');
}

function setupTerminal() {
    console.log('[DEBUG] setupTerminal started');

    // Check if Terminal is available
    if (typeof Terminal === 'undefined') {
        console.error('[ERROR] Terminal (XTerm.js) is not loaded!');
        return;
    }

    console.log('[DEBUG] Creating Terminal instance...');
    // Create terminal instance
    terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 14,
        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
        theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#ffffff',
            selection: 'rgba(255, 255, 255, 0.3)',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5'
        },
        allowTransparency: true,
        disableStdin: true, // Read-only terminal
        convertEol: true,
        scrollback: 10000
    });

    console.log('[DEBUG] Terminal instance created, adding addons...');

    // Check if addons are available
    if (typeof FitAddon === 'undefined') {
        console.error('[ERROR] FitAddon is not loaded!');
        return;
    }
    if (typeof WebLinksAddon === 'undefined') {
        console.error('[ERROR] WebLinksAddon is not loaded!');
        return;
    }

    // Add addons
    fitAddon = new FitAddon.FitAddon();
    webLinksAddon = new WebLinksAddon.WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    console.log('[DEBUG] Addons loaded');

    // Open terminal in the container
    const terminalElement = document.getElementById('terminal');
    if (!terminalElement) {
        console.error('[ERROR] Terminal element not found!');
        return;
    }

    console.log('[DEBUG] Opening terminal in container...');
    terminal.open(terminalElement);

    // Fit terminal to container
    console.log('[DEBUG] Fitting terminal to container...');
    fitAddon.fit();
    console.log('[DEBUG] setupTerminal completed');
}

function connectWebSocket() {
    console.log('[DEBUG] connectWebSocket started');
    console.log('[DEBUG] Connection params:', { sessionId, host, port });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${host}:${port}/terminal/${sessionId}`;
    console.log('[DEBUG] WebSocket URL:', wsUrl);

    showConnectionStatus('connecting');

    try {
        console.log('[DEBUG] Creating WebSocket...');
        websocket = new WebSocket(wsUrl);
        console.log('[DEBUG] WebSocket created, setting up handlers...');
        
        websocket.onopen = function(event) {
            console.log('[DEBUG] WebSocket onopen fired');
            console.log('WebSocket connected');
            showConnectionStatus('connected');
            reconnectAttempts = 0;

            // Hide loading state and show terminal
            console.log('[DEBUG] Calling hideLoading...');
            hideLoading();

            // Send initial resize
            console.log('[DEBUG] Sending initial resize...');
            sendResize();
            console.log('[DEBUG] WebSocket onopen completed');
        };
        
        websocket.onmessage = function(event) {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        websocket.onclose = function(event) {
            console.log('WebSocket disconnected:', event.code, event.reason);
            showConnectionStatus('disconnected');
            
            // Attempt to reconnect
            if (reconnectAttempts < maxReconnectAttempts) {
                setTimeout(() => {
                    reconnectAttempts++;
                    console.log(`Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
                    connectWebSocket();
                }, reconnectDelay * Math.pow(2, reconnectAttempts)); // Exponential backoff
            } else {
                showError('Connection lost', 'Unable to reconnect to the terminal session. Please refresh the page to try again.');
            }
        };
        
        websocket.onerror = function(error) {
            console.error('WebSocket error:', error);
            showConnectionStatus('disconnected');
            // Hide loading state even on error to show the terminal
            hideLoading();
        };
        
    } catch (error) {
        console.error('Error creating WebSocket:', error);
        showError('Connection failed', 'Unable to connect to the terminal session. Please check your connection and try again.');
    }

    // Fallback: Hide loading after 5 seconds even if WebSocket doesn't connect
    setTimeout(() => {
        const loadingDiv = document.querySelector('.loading');
        if (loadingDiv) {
            console.warn('WebSocket connection timeout, hiding loading state');
            hideLoading();
        }
    }, 5000);
}

function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'data':
            if (message.data) {
                terminal.write(message.data);
            }
            break;
            
        case 'status':
            updateSessionStatus(message.status);
            break;
            
        case 'error':
            console.error('Terminal error:', message.error);
            showError('Terminal Error', message.error);
            break;
            
        default:
            console.warn('Unknown message type:', message.type);
    }
}

function sendResize() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const message = {
            type: 'resize',
            sessionId: sessionId,
            size: {
                cols: terminal.cols,
                rows: terminal.rows
            },
            timestamp: new Date()
        };
        websocket.send(JSON.stringify(message));
    }
}

function setupEventListeners() {
    // Window resize
    window.addEventListener('resize', () => {
        if (fitAddon) {
            fitAddon.fit();
            sendResize();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
        // Ctrl+C / Cmd+C for copy (if text is selected)
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
            if (terminal.hasSelection()) {
                navigator.clipboard.writeText(terminal.getSelection());
                event.preventDefault();
            }
        }
        
        // F11 for fullscreen
        if (event.key === 'F11') {
            toggleFullscreen();
            event.preventDefault();
        }
    });
    
    // Visibility change (tab switching)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && fitAddon) {
            // Refit when tab becomes visible
            setTimeout(() => {
                fitAddon.fit();
                sendResize();
            }, 100);
        }
    });
}

function showConnectionStatus(status) {
    let statusElement = document.querySelector('.connection-status');
    if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.className = 'connection-status';
        document.body.appendChild(statusElement);
    }
    
    statusElement.className = `connection-status ${status}`;
    
    switch (status) {
        case 'connected':
            statusElement.textContent = 'Connected';
            setTimeout(() => {
                statusElement.style.opacity = '0';
                setTimeout(() => {
                    if (statusElement.parentNode) {
                        statusElement.parentNode.removeChild(statusElement);
                    }
                }, 300);
            }, 2000);
            break;
        case 'connecting':
            statusElement.textContent = 'Connecting...';
            statusElement.style.opacity = '1';
            break;
        case 'disconnected':
            statusElement.textContent = 'Disconnected';
            statusElement.style.opacity = '1';
            break;
    }
}

function updateSessionStatus(status) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = status;
        statusElement.className = status;
    }
}

function showError(title, message) {
    const terminalElement = document.getElementById('terminal');
    terminalElement.innerHTML = `
        <div class="error-container">
            <div class="error-icon">⚠️</div>
            <div class="error-title">${title}</div>
            <div class="error-message">${message}</div>
            <button class="retry-button" onclick="location.reload()">Retry</button>
        </div>
    `;
}

function showLoading(message = 'Loading terminal...') {
    const terminalElement = document.getElementById('terminal');
    terminalElement.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <div class="loading-text">${message}</div>
        </div>
    `;
}

function hideLoading() {
    console.log('[DEBUG] hideLoading called');
    const terminalElement = document.getElementById('terminal');
    if (!terminalElement) {
        console.error('[ERROR] Terminal element not found in hideLoading');
        return;
    }

    // Clear any loading content and let the terminal take over
    const loadingDiv = terminalElement.querySelector('.loading');
    if (loadingDiv) {
        console.log('[DEBUG] Removing loading div');
        loadingDiv.remove();
    } else {
        console.log('[DEBUG] No loading div found to remove');
    }

    // Ensure terminal is visible and properly fitted
    if (terminal && fitAddon) {
        console.log('[DEBUG] Fitting terminal after hiding loading');
        setTimeout(() => {
            fitAddon.fit();
            console.log('[DEBUG] Terminal fitted');
        }, 100);
    } else {
        console.log('[DEBUG] Terminal or fitAddon not available for fitting');
    }
    console.log('[DEBUG] hideLoading completed');
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
            setTimeout(() => {
                if (fitAddon) {
                    fitAddon.fit();
                    sendResize();
                }
            }, 100);
        });
    } else {
        document.exitFullscreen().then(() => {
            setTimeout(() => {
                if (fitAddon) {
                    fitAddon.fit();
                    sendResize();
                }
            }, 100);
        });
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (websocket) {
        websocket.close();
    }
});

// Initialize loading state
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOMContentLoaded fired, showing loading state');
    showLoading();
    console.log('[DEBUG] Loading state shown');
});
