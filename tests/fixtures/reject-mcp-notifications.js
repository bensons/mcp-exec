'use strict';

const { Protocol } = require('@modelcontextprotocol/sdk/shared/protocol.js');

Protocol.prototype.notification = function rejectNotificationForTest() {
  return Promise.reject(new Error('Injected notification failure'));
};
