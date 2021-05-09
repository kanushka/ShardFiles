'use strict';

const express = require('express');
const axios = require('axios');
const path = require('path');
const splitFile = require('split-file');
var multer = require('multer');
var FormData = require('form-data');
var fs = require('fs');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const addresses = require('./configs').addresses;
const utils = require('./utils');
const docs = require('./docs');

// server configuration
let baseIndexServer = process.env.NODE_INDEX || 0;
let nodeId = utils.getId(addresses[ baseIndexServer ].port);
let leaderId = utils.getId(Math.max(...calculateLeader()));
let learnerId = utils.getId(Math.min(...calculateLeader()));
let status = 'ok';
let isCoordinator = true;
let isUP = true;
let check = 'on';
let nodeChunksMap = new Map();
let fileList = [];

// storage configurations
var fileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
var chunkStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/chunks');
    },
    filename: function (req, file, cb) {
        cb(null, `${nodeId}-` + file.originalname);
    }
});

var fileUpload = multer({ storage: fileStorage });
var chunkUpload = multer({ storage: chunkStorage });

// servers instance
const servers = new Map();
Object.keys(addresses).forEach(key => {
    if (Number(key) !== baseIndexServer) {
        servers.set(utils.getId(addresses[ key ].port), `http://${addresses[ key ].host}:${addresses[ key ].port}`);
    }
});

// app
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.engine('pug', require('pug').__express);
app.set('views', path.join(__dirname, '../public/views'));
app.set('view engine', 'pug');
app.use(express.static(path.join(__dirname, '../public')));

// routes
app.get('/', function (req, res) {
    res.render('index', { nodeId, idLeader: leaderId, idLearner: learnerId });
});

app.get('/files', function (req, res) {
    if (nodeId == leaderId) {
        res.render('files/index', { nodeId, idLeader: leaderId, idLearner: learnerId, fileList });
    } else {
        res.status(404).type('txt').send('Not found');
    }
});

app.get('/learner/files', function (req, res) {
    if (nodeId == learnerId) {
        res.status(200).send({ nodeId, fileList });
    } else {
        res.status(403).send({ error: 'im not a learner' });
    }
});

app.post('/ping', (req, res) => {
    utils.handleRequest(req);
    utils.sendMessage(io, `${new Date().toLocaleString()} - server ${req.body.nodeId} it's pinging me`);
    res.status(200).send({ serverStatus: status });
});

app.post('/ping/learner', (req, res) => {
    utils.handleRequest(req);
    utils.sendMessage(io, `${new Date().toLocaleString()} - server ${req.body.nodeId} it's checking learner node`);
    if (nodeId == learnerId) {
        updateChuckMapFromNodeDoc();
    }
    res.status(200).send({ serverStatus: status, isLearner: nodeId == learnerId, fileList });
});

app.post('/isCoordinator', (req, res) => {
    utils.handleRequest(req);
    res.status(200).send({ isCoor: isCoordinator });
});

app.post('/election', (req, res) => {
    utils.handleRequest(req);
    if (!isUP) {
        utils.sendMessage(io, `${new Date().toLocaleString()} - server ${req.body.nodeId} fallen leader`);
        res.status(200).send({ accept: 'no' });
    } else {
        utils.sendMessage(io, `${new Date().toLocaleString()} - server ${req.body.nodeId} asked me if I am down, and I am not , I win, that is bullying`);
        res.status(200).send({ accept: 'ok' });
    }
});

app.post('/putCoordinator', (req, res) => {
    utils.handleRequest(req);
    startElection();
    utils.sendMessage(io, `${new Date().toLocaleString()} - server ${req.body.nodeId} put me as coordinator`);
    res.status(200).send('ok');
});

app.post('/newLeader', async (req, res) => {
    utils.handleRequest(req);
    leaderId = req.body.idLeader;
    res.status(200).send('ok');
    io.emit('newLeader', leaderId);
    await checkLeader();
});

app.post('/newLearner', async (req, res) => {
    utils.handleRequest(req);
    learnerId = req.body.idLearner;
    if (learnerId == nodeId) {
        // update file list with learnerDoc
        updateChuckMapFromNodeDoc();
    }
    res.status(200).send('ok');
    io.emit('newLearner', learnerId);
});

app.post('/chunk/metadata', (req, res) => {
    utils.handleRequest(req);
    utils.sendMessage(io, `${new Date().toLocaleString()} - server ${req.body.nodeId} send chunk metadata`);
    updateNodeChuckMap(req.body.chunkMap);
    console.log(`learner chunk table >>> `, nodeChunksMap);
    res.status(200).send({ fileList });
});

app.post('/upload', fileUpload.single('uploadFile'), function (req, res, next) {
    handleUploadedFile(req.file.path);
    res.redirect('files');
});

app.post('/upload/chunk', chunkUpload.single('chunk'), function (req, res, next) {
    const fileName = req.file.originalname;
    const key = fileName.split('-')[ 0 ];
    const chunkInfo = {
        name: fileName,
        part: fileName.split('-').pop(),
        path: req.file.path,
    };

    if (nodeChunksMap.has(key)) {
        let fileInfo = nodeChunksMap.get(key);
        nodeChunksMap.set(key, [ ...fileInfo, chunkInfo ]);
    } else {
        nodeChunksMap.set(key, [ chunkInfo ]);
    }

    utils.printLog('info', `${fileName} chunck uploaded to node ${nodeId}`);
    docs.updateDoc(utils.getNodeDocName(nodeId, learnerId), nodeChunksMap);
    res.status(200).send();
});

// server functions
const checkLeader = async _ => {
    if (!isUP) {
        check = 'off';
    }
    if (nodeId !== leaderId && check !== 'off') {
        try {
            let response = await axios.post(servers.get(leaderId) + '/ping', { nodeId });

            if (response.data.serverStatus === 'ok') {
                utils.sendMessage(io, `${new Date().toLocaleString()} - Ping to leader server ${leaderId}: ${response.data.serverStatus}`);
                setTimeout(checkLeader, 12000);
            } else {
                utils.sendMessage(io, `${new Date().toLocaleString()} - Server leader  ${leaderId} down: ${response.data.serverStatus} New leader needed`);
                checkCoordinator();
            }
        }
        catch (error) {
            utils.sendMessage(io, `${new Date().toLocaleString()} - Server leader  ${leaderId} down: New leader needed`);
            utils.printLog('error', `leader ${leaderId} down, new leader needed`);
            checkCoordinator();
        }
    }
};

const checkCoordinator = _ => {
    servers.forEach(async (value, key) => {
        try {
            let response = await axios.post(value + '/isCoordinator', { nodeId });

            if (response.data.isCoor === 'true') {
                utils.sendMessage(io, `${new Date().toLocaleString()} - server ${key} is doing the election`);
                return true;
            } else {
                utils.sendMessage(io, `${new Date().toLocaleString()} - server ${key} is not doing the election`);
            }
        }
        catch (error) {
            utils.printLog('error', `node ${key} is not responding`);
        }
    });

    if (isUP) {
        startElection();
    }
};

const startElection = _ => {
    let someoneAnswer = false;
    isCoordinator = true;
    utils.sendMessage(io, `${new Date().toLocaleString()} - Coordinating the election`);

    servers.forEach(async (value, key) => {
        if (key > nodeId) {
            try {
                let response = await axios.post(value + '/election', { nodeId });
                if (response.data.accept === 'ok' && !someoneAnswer) {
                    someoneAnswer = true;
                    isCoordinator = false;
                    await axios.post(value + '/putCoordinator', { nodeId });
                }
            }
            catch (error) {
                utils.printLog('error', `node ${key} is not starting election`);
            }
        }
    });

    setTimeout(() => {
        if (!someoneAnswer) {
            leaderId = nodeId;
            utils.sendMessage(io, `${new Date().toLocaleString()} - I am leader`);
            io.emit('newLeader', leaderId);
            servers.forEach(async (value) => await axios.post(value + '/newLeader', { idLeader: leaderId }));
            setNewLearner();
        }
    }, 5000);
};

function calculateLeader() {
    let ports = [];
    addresses.forEach(server => {
        ports.push(server.port);
    });
    return ports;
}

async function setNewLearner(id = 0) {
    try {
        utils.printLog('info', `checking... learner node ${key}`);
        let response = await axios.post(servers.get(id) + '/ping/learner', { nodeId });
        if (response.data.serverStatus === 'ok') {
            if (response.data.isLearner) {
                // learner node already exist
                learnerId = id;
                utils.printLog('info', `accept already exist learner node ${key}`);
                if (response.data.fileList && response.data.fileList.length > 0) {
                    // response.data.fileList.forEach(chunk => {
                    //     if (!fileList.includes(chunk.fileName)) {
                    //         fileList.push(chunk.fileName);
                    //     }
                    // });
                    fileList = response.data.fileList;
                }
                return;
            } else {
                servers.forEach(async (value) => await axios.post(value + '/newLearner', { idLearner: id }));
                io.emit('newLearner', id);
                utils.printLog('success', `set node ${key} as new learner`);
                return;
            }
        }
    } catch (error) {
        utils.printLog('info', `reject leaner request from node ${learnerId}`);
        if ((id + 1) < leaderId) setNewLearner(id + 1);
    }
}

function handleUploadedFile(filePath) {
    let activeNodeList = [];
    if (nodeId !== leaderId && nodeId === learnerId) {
        console.error(`only leader node can upload files`);
        return;
    }
    new Promise((resolve) => {
        let pingCount = 0;
        servers.forEach(async (value, key) => {
            try {
                if (key !== leaderId && key !== learnerId) {
                    let response = await axios.post(value + '/ping', { nodeId });
                    if (response.data.serverStatus === 'ok') {
                        activeNodeList.push(value);
                        ++pingCount;
                        if (pingCount + 2 >= servers.size) resolve();
                    }
                }
            } catch (error) {
                ++pingCount;
                if (pingCount + 2 >= servers.size) resolve();
            }
        });
    }).then(() => {
        let chunkCount = 1;
        if (activeNodeList.length > 2) {
            chunkCount = activeNodeList.length;
        }

        splitFile.splitFile(path.resolve(filePath), chunkCount)
            .then((chunkNames) => {
                const fileName = chunkNames[ 0 ].split('/').pop().split('.sf')[ 0 ];
                const chunksDocData = new Map();
                // send two chunk files for each node
                activeNodeList.forEach((node, index) => {
                    let firstChunkIndex = index;
                    let secondChunkIndex = index == 0 ? chunkNames.length - 1 : index - 1;

                    chunksDocData.set(node, [
                        docs.getChunkDocData(chunkNames[ firstChunkIndex ]),
                        docs.getChunkDocData(chunkNames[ secondChunkIndex ]),
                    ]);
                    sendFileToNode(node, path.resolve("uploads", chunkNames[ firstChunkIndex ]));
                    sendFileToNode(node, path.resolve("uploads", chunkNames[ secondChunkIndex ]));
                });

                utils.printLog('info', `sending... docData to learner ${learnerId}`);
                axios.post(servers.get(learnerId) + '/chunk/metadata', { chunkMap: utils.mapToObj(chunksDocData), nodeId })
                    .then(response => {
                        if (response.data.fileList && response.data.fileList.length > 0) {
                            fileList = response.data.fileList;
                            io.emit('fileUpdated', JSON.stringify(fileList));
                            utils.printLog('success', `leader file name list updated`);
                        }
                    });

            })
            .catch((err) => {
                utils.printLog('error', `file splitting went wrong`);
            });
    });
}

function sendFileToNode(nodeAddress, chunkPath) {
    const form = new FormData();
    form.append('chunk', fs.createReadStream(chunkPath));

    const request_config = {
        headers: {
            // 'Authorization': `Bearer ${access_token}`,
            ...form.getHeaders()
        }
    };

    try {
        utils.printLog('info', `sending chunk ${chunkPath.split('-').pop()} to node ${nodeAddress}`);
        return axios.post(nodeAddress + '/upload/chunk', form, request_config);
    } catch (error) {
        utils.printLog('error', `sending chunk to node ${nodeAddress} gives errors`);
    }
}

function updateNodeChuckMap(obj) {
    for (const [ key, value ] of Object.entries(obj)) {
        if (nodeChunksMap.has(key)) {
            const nodeFiles = nodeChunksMap.get(key);
            nodeChunksMap.set(key, [ ...nodeFiles, ...value ]);
        } else {
            nodeChunksMap.set(key, value);
        }
    }
    updateFileList();
    docs.updateDoc(utils.getNodeDocName(nodeId, learnerId), nodeChunksMap);
}

function updateChuckMapFromNodeDoc() {
    if (nodeId != leaderId) {
        const docName = utils.getNodeDocName(nodeId, learnerId);
        const dataMap = docs.readDoc(docName);
        nodeChunksMap = dataMap;

        if (nodeId == learnerId) {
            updateFileList();
        }
    }
}

function updateFileList() {
    if (nodeChunksMap) {
        nodeChunksMap.forEach(node => {
            node.forEach(chunk => {
                if (!fileList.includes(chunk.fileName)) {
                    fileList.push(chunk.fileName);
                }
            });
        });
    }
}

// socket connection
io.on('connection', (socket) => {
    socket.on('download', (fileName) => {
        utils.sendMessage(io, `${new Date().toLocaleString()} - requesting file ${fileName} from learner node ${learnerId}`);

    });
});

// start server
server.listen(addresses[ baseIndexServer ].port, addresses[ baseIndexServer ].host);
utils.printLog('header', `App listening on http://${addresses[ baseIndexServer ].host}:${addresses[ baseIndexServer ].port}`);

// onload actions
setTimeout(checkLeader, 3000);
updateChuckMapFromNodeDoc();
