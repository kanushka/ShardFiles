'use strict';

var fs = require('fs');
const path = require('path');
const utils = require('./utils');
const md5File = require('md5-file');

const generateHashForChunk = function (filePath) {
    const hash = md5File.sync(filePath);
    return hash;
};
exports.generateHash = generateHashForChunk;

exports.getChunkDocData = function (chunkFilePath) {
    const fileName = chunkFilePath.split('/').pop().split('.sf')[ 0 ];
    const absolutePath = path.resolve("uploads", chunkFilePath);
    return {
        fileName: fileName,
        name: chunkFilePath.split('/').pop(),
        part: chunkFilePath.split('-').pop(),
        path: absolutePath,
        hash: generateHashForChunk(absolutePath)
    };
};

exports.readDoc = function (docName) {
    utils.printLog('info', `reading...  ${docName} doc`);
    try {
        const dataObjString = fs.readFileSync(path.resolve("docs", docName));
        const dataObj = JSON.parse(dataObjString);
        const dataMap = new Map();
        for (const [ key, value ] of Object.entries(dataObj)) {
            dataMap.set(key, value);
        }
        return dataMap;
    } catch (error) {
        return new Map();
    }
};

exports.updateDoc = function (docName, dataMap) {
    fs.writeFileSync(path.resolve("docs", docName), JSON.stringify(utils.mapToObj(dataMap)));
    utils.printLog('success', `${docName} doc updated`);
};
