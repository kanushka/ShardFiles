'use strict';

const chalk = require('chalk');

exports.getId = function (server) {
    return server - 10000;
};

exports.sendMessage = function (io, message) {
    printLog('message', `Message: ${message}`);
    io.emit('status', message);
};

exports.handleRequest = function (req) {
    printLog('log', `Handle request in ${req.method}: ${req.url} by ${req.hostname}`);
};

exports.getNodeDocName = function (nodeId, learnerId) {
    return (nodeId == learnerId) ? `learner-doc.txt` : `node-${nodeId}-doc.txt`;
};

exports.mapToObj = function (map) {
    const obj = {};
    map.forEach((value, key) => {
        obj[ key ] = value;
    });
    return obj;
};

function printLog (type = 'info', message) {
    const log = console.log;
    switch (type) {
        case 'info':
            log(`${chalk.cyan(new Date().toLocaleString())} - ${message}`);
            break;
        case 'success':
            log(`${chalk.cyan(new Date().toLocaleString())} - ${chalk.greenBright(message)}`);
            break;
        case 'error':
            log(`${chalk.cyan(new Date().toLocaleString())} - ${chalk.red(message)}`);
            break;
        case 'header':
            log(`${chalk.yellow.bgBlack.bold(message)}`);
            break;
        case 'log':
            log(`${chalk.magenta(new Date().toLocaleString())} - ${message}`);
        default:
            log(message);
            break;
    }
};

exports.printLog = printLog;