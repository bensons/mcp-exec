'use strict';

setTimeout(() => {
  Promise.reject(new Error('Injected unrelated rejection'));
}, 500);
