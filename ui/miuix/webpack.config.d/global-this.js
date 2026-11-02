// The extension only targets current Chrome, where globalThis is available.
// Marking it as a supported environment prevents Webpack from injecting the
// __webpack_require__.g polyfill that contains new Function('return this').
config.output.environment = config.output.environment || {};
config.output.environment.globalThis = true;
