'use strict';

const express = require('express');
const axios = require('axios');
const path = require('path');
const splitFile = require('split-file');
const CryptoJS = require("crypto-js");
var FormData = require('form-data');
var fs = require('fs');

var multer = require('multer');

const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const addresses = require('./buildHosts').addresses;

var nodeChunksMap = new Map();
var fileList = [];

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

// Server configuration
let baseIndexServer = process.env.NODE_INDEX || 0;
let nodeId = getId(addresses[ baseIndexServer ].port);
let leaderId = getId(Math.max(...calculateLeader()));
let learnerId = getId(Math.min(...calculateLeader()));
let status = 'ok';
let isCoordinator = true;
let isUP = true;
let check = 'on';

// Servers instance
const servers = new Map();
Object.keys(addresses).forEach(key => {
    if (Number(key) !== baseIndexServer) {
        servers.set(getId(addresses[ key ].port), `http://${addresses[ key ].host}:${addresses[ key ].port}`);
    }
});

// App
app.use(express.json());
app.use(express.urlencoded());
app.engine('pug', require('pug').__express);
app.set('views', path.join(__dirname, '../public/views'));
app.set('view engine', 'pug');
app.use(express.static(path.join(__dirname, '../public')));

// Routes
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
    handleRequest(req);
    sendMessage(`${new Date().toLocaleString()} - server ${req.body.nodeId} it's pinging me`);
    res.status(200).send({ serverStatus: status });
});

app.post('/ping/learner', (req, res) => {
    handleRequest(req);
    sendMessage(`${new Date().toLocaleString()} - server ${req.body.nodeId} it's checking learner node`);
    if (nodeId == learnerId) {
        updateChuckMapFromNodeDoc();
    }
    res.status(200).send({ serverStatus: status, isLearner: nodeId == learnerId, fileList });
});

app.post('/isCoordinator', (req, res) => {
    handleRequest(req);
    res.status(200).send({ isCoor: isCoordinator });
});

app.post('/election', (req, res) => {
    handleRequest(req);
    if (!isUP) {
        sendMessage(`${new Date().toLocaleString()} - server ${req.body.nodeId} fallen leader`);
        res.status(200).send({ accept: 'no' });
    } else {
        sendMessage(`${new Date().toLocaleString()} - server ${req.body.nodeId} asked me if I am down, and I am not , I win, that is bullying`);
        res.status(200).send({ accept: 'ok' });
    }
});

app.post('/putCoordinator', (req, res) => {
    handleRequest(req);
    startElection();
    sendMessage(`${new Date().toLocaleString()} - server ${req.body.nodeId} put me as coordinator`);
    res.status(200).send('ok');
});

app.post('/newLeader', async (req, res) => {
    handleRequest(req);
    leaderId = req.body.idLeader;
    res.status(200).send('ok');
    io.emit('newLeader', leaderId);
    await checkLeader();
});

app.post('/newLearner', async (req, res) => {
    handleRequest(req);
    learnerId = req.body.idLearner;
    if (learnerId == nodeId) {
        // update file list with learnerDoc
        updateChuckMapFromNodeDoc();
    }
    res.status(200).send('ok');
    io.emit('newLearner', learnerId);
});

app.post('/chunk/metadata', (req, res) => {
    handleRequest(req);
    sendMessage(`${new Date().toLocaleString()} - server ${req.body.nodeId} send chunk metadata`);
    updateNodeChuckMap(req.body.chunkMap);
    console.log(`learner chunk table >>> `, nodeChunksMap);
    res.status(200).send({ fileList });
});

app.post('/upload', fileUpload.single('uploadFile'), function (req, res, next) {
    handleUploadedFile(req.file.path);
    // res.send("File upload successfully");
    res.redirect('files');
});

app.post('/upload/chunk', chunkUpload.single('chunk'), function (req, res, next) {
    // console.log(`/upload/chunk >>>`, req);
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

    console.log(`nodeChunksMap >>>`, nodeChunksMap);
    updateDoc(getNodeDocName(), nodeChunksMap);
    res.status(200).send();
});

const checkLeader = async _ => {
    if (!isUP) {
        check = 'off';
    }
    if (nodeId !== leaderId && check !== 'off') {
        try {
            let response = await axios.post(servers.get(leaderId) + '/ping', { nodeId });

            if (response.data.serverStatus === 'ok') {
                sendMessage(`${new Date().toLocaleString()} - Ping to leader server ${leaderId}: ${response.data.serverStatus}`);
                setTimeout(checkLeader, 12000);
            } else {
                sendMessage(`${new Date().toLocaleString()} - Server leader  ${leaderId} down: ${response.data.serverStatus} New leader needed`);
                checkCoordinator();
            }
        }
        catch (error) {
            sendMessage(`${new Date().toLocaleString()} - Server leader  ${leaderId} down: New leader needed`);
            checkCoordinator();
            console.log(error);
        }
    }
};

const checkCoordinator = _ => {
    servers.forEach(async (value, key) => {
        try {
            let response = await axios.post(value + '/isCoordinator', { nodeId });

            if (response.data.isCoor === 'true') {
                sendMessage(`${new Date().toLocaleString()} - server ${key} is doing the election`);
                return true;
            } else {
                sendMessage(`${new Date().toLocaleString()} - server ${key} is not doing the election`);
            }
        }
        catch (error) {
            console.log(error);
        }
    });

    if (isUP) {
        startElection();
    }
};

const startElection = _ => {
    let someoneAnswer = false;
    isCoordinator = true;
    sendMessage(`${new Date().toLocaleString()} - Coordinating the election`);

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
                console.log(error);
            }
        }
    });

    setTimeout(() => {
        if (!someoneAnswer) {
            leaderId = nodeId;
            sendMessage(`${new Date().toLocaleString()} - I am leader`);
            io.emit('newLeader', leaderId);
            servers.forEach(async (value) => await axios.post(value + '/newLeader', { idLeader: leaderId }));
            setNewLearner();
        }
    }, 5000);
};

function getId(server) {
    return server - 10000;
}

function calculateLeader() {
    let ports = [];
    addresses.forEach(server => {
        ports.push(server.port);
    });
    return ports;
}

function sendMessage(message) {
    console.log(`Message: ${message}`);
    io.emit('status', message);
}

function handleRequest(req) {
    console.log(`${new Date().toLocaleString()} - Handle request in ${req.method}: ${req.url} by ${req.hostname}`);
}

async function setNewLearner(id = 0) {
    console.log(`checking NewLearner >>>`, id);
    try {
        let response = await axios.post(servers.get(id) + '/ping/learner', { nodeId });
        if (response.data.serverStatus === 'ok') {
            if (response.data.isLearner) {
                // learner node already exist
                learnerId = id;
                console.log(`leaner setup in leader node >>>`, id);
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
                console.log(`set NewLearner >>>`, id);
                io.emit('newLearner', id);
                return;
            }
        }
    } catch (error) {
        console.log(`skip learner selection node >>>`, learnerId);
        if ((id + 1) < leaderId) setNewLearner(id + 1);
    }
}

function handleUploadedFile(filePath) {
    let activeNodeList = [];
    if (nodeId !== leaderId && nodeId === learnerId) {
        console.error(`only leader node can upload files`);
        return;
    }
    console.log(`servers >>>`, servers);
    new Promise((resolve) => {
        let pingCount = 0;
        servers.forEach(async (value, key) => {
            try {
                if (key !== leaderId && key !== learnerId) {
                    console.log(`ping >>>`, value);
                    let response = await axios.post(value + '/ping', { nodeId });
                    console.log(`response >>>`, value);
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
        console.log(`active node list >>>`, activeNodeList);
        let chunkCount = 1;
        if (activeNodeList.length > 2) {
            chunkCount = activeNodeList.length;
        }

        splitFile.splitFile(path.resolve(filePath), chunkCount)
            .then((chunkNames) => {
                const fileName = chunkNames[ 0 ].split('/').pop().split('.sf')[ 0 ];
                // TODO: save this map in local file or db
                // send two chunk files for each node
                activeNodeList.forEach((node, index) => {
                    let firstChunkIndex = index;
                    let secondChunkIndex = index == 0 ? chunkNames.length - 1 : index - 1;

                    // save chunk info in memory
                    nodeChunksMap.set(node, [
                        {
                            fileName: fileName,
                            name: chunkNames[ firstChunkIndex ].split('/').pop(),
                            part: chunkNames[ firstChunkIndex ].split('-').pop(),
                            path: path.resolve("uploads", chunkNames[ firstChunkIndex ]),
                            hash: generateHashForChunk(path.resolve("uploads", chunkNames[ firstChunkIndex ]))
                        },
                        {
                            fileName: fileName,
                            name: chunkNames[ secondChunkIndex ].split('/').pop(),
                            part: chunkNames[ secondChunkIndex ].split('-').pop(),
                            path: path.resolve("uploads", chunkNames[ secondChunkIndex ]),
                            hash: generateHashForChunk(path.resolve("uploads", chunkNames[ secondChunkIndex ]))
                        }
                    ]);

                    sendFileToNode(node, path.resolve("uploads", chunkNames[ firstChunkIndex ]));
                    sendFileToNode(node, path.resolve("uploads", chunkNames[ secondChunkIndex ]));
                });

                console.log(`sending nodeChunksMap to learner ${learnerId} >>> `, nodeChunksMap);

                axios.post(servers.get(learnerId) + '/chunk/metadata', { chunkMap: mapToObj(nodeChunksMap), nodeId })
                    .then(response => {
                        if (response.data.fileList && response.data.fileList.length > 0) {
                            fileList = response.data.fileList;
                            io.emit('fileUpdated', JSON.stringify(fileList));
                            console.log(`file list updated >>> `, fileList);
                        }
                    });

            })
            .catch((err) => {
                console.log('Error: ', err);
            });
    });
}

function mapToObj(map) {
    const obj = {};
    map.forEach((value, key) => {
        obj[ key ] = value;
    });
    return obj;
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
    updateDoc(getNodeDocName(), nodeChunksMap);
}

function generateHashForChunk(filePath) {
    const fileData = fs.readFileSync(filePath);
    console.log(fileData);
    return CryptoJS.MD5(fileData).toString();
}

function getNodeDocName() {
    return (nodeId == learnerId) ? `learner-doc.txt` : `node-${nodeId}-doc.txt`;
}

function updateChuckMapFromNodeDoc() {
    if (nodeId != leaderId) {
        const docName = getNodeDocName();
        const dataMap = readDoc(docName);
        nodeChunksMap = dataMap;
        console.log(`update nodeChunksMap with ${docName} doc >>>`);

        if (nodeId == learnerId) {
            updateFileList();
        }
    }
}

function readDoc(docName) {
    console.log(`reading ${docName} doc >>>`);
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
}

function updateDoc(docName, dataMap) {
    fs.writeFileSync(path.resolve("docs", docName), JSON.stringify(mapToObj(dataMap)));
    console.log(`updated ${docName} doc >>>`, dataMap);
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

function sendFileToNode(nodeAddress, chunkPath) {
    console.log(`sendFileToNode >>> `, nodeAddress, chunkPath);
    const form = new FormData();
    form.append('chunk', fs.createReadStream(chunkPath));

    const request_config = {
        headers: {
            // 'Authorization': `Bearer ${access_token}`,
            ...form.getHeaders()
        }
    };

    // TODO: add await 
    try {
        console.log(`send file >>>`);
        return axios.post(nodeAddress + '/upload/chunk', form, request_config);
    } catch (error) {
        console.log(`send file error>>>`, error);
    }
}

io.on('connection', (socket) => {
    socket.on('download', (fileName) => {
        sendMessage(`${new Date().toLocaleString()} - requesting file ${fileName} from learner node ${learnerId}`);

    });
});

server.listen(addresses[ baseIndexServer ].port, addresses[ baseIndexServer ].host);
console.log(`App listening on http://${addresses[ baseIndexServer ].host}:${addresses[ baseIndexServer ].port}`);

setTimeout(checkLeader, 3000);

updateChuckMapFromNodeDoc();
