'use strict';
// ======================================================================================
// graceful-shutdown.js
// ======================================================================================
// gracefully shuts downs http server
// can be used with http, express, koa, ...
// ======================================================================================

var debug = require('debug')('http-graceful-shutdown');
var objectAssign = require('object-assign');

var isShuttingDown = false;
var connections = {};
var connectionCounter = 0;

/**
 * Gracefully shuts down `server` when the process receives
 * the passed signals
 *
 * @param {http.Server} server
 * @param {object} opts
 *                        signals: string (each signal separated by SPACE)
 *                        timeout: timeout value for forceful shutdown in ms
 *                        development: boolean value (if true, no graceful shutdown to speed up development
 *                        onShutdown: optional function
 *                        finally: optional function
 */

function GracefulShutdown(server, opts) {

  var opts = opts || {};

  // merge opts with default options
  var options = objectAssign({
    signals: 'SIGINT SIGTERM',
    timeout: 30000,
    development: false
  }, opts);

  options.signals.split(' ').forEach(function (signal) {
    if (signal && signal !== '') {
      process.on(signal, function () {
        shutdown(signal);
      });
    }
  });

  function destroy(socket) {
    if (socket._isIdle && isShuttingDown) {
      socket.destroy();
      delete connections[socket._connectionId];
    }
  }

  function isFunction(functionToCheck) {
    var getType = {};
    return functionToCheck && getType.toString.call(functionToCheck) === '[object Function]';
  }

  server.on('request', function (req, res) {
    req.socket._isIdle = false;

    res.on('finish', function () {
      req.socket._isIdle = true;
      destroy(req.socket);
    });
  });

  server.on('connection', function (socket) {
    var id = connectionCounter++;
    socket._isIdle = true;
    socket._connectionId = id;
    connections[id] = socket;

    socket.on('close', function () {
      delete connections[id];
    });
  });

  process.on('exit', function () {
    if (options.finally && isFunction(options.finally)) {
      options.finally();
    }
    debug('closed');
  });

  function shutdown(sig) {

    var counter = 0;

    function cleanupHttp() {

      Object.keys(connections).forEach(function (key) {
        counter++;
        destroy(connections[key]);
      });

      debug('Connections destroyed : ' + counter);
      debug('Connection Counter    : ' + connectionCounter);

      // normal shutdown
      server.close(function () {
        process.exit(0)
      });
    }

    debug('shutdown signal - ' + sig);

    // Don't bother with graceful shutdown on development to speed up round trip
    if (options.development) {
      debug('DEV-Mode - imediate forceful shutdown');
      return process.exit(0);
    }

    if (!isShuttingDown) {
      isShuttingDown = true;
      debug('shutting down');

      // forcefull shutdown after timeout
      if (options.timeout) {
        setTimeout(function () {
          debug('Could not close connections in time (' + options.timeout + 'ms), forcefully shutting down');
          process.exit(1)
        }, options.timeout).unref();
      }

      // your personal cleanup things can be placed in this callback function
      if (options.onShutdown && isFunction(options.onShutdown)) {
        options.onShutdown().then(function() {
          cleanupHttp()
        });
      } else {
        cleanupHttp()
      }
    }
  }
}

module.exports = GracefulShutdown;
