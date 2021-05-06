'use strict';

const express = require('express');
const axios = require('axios');
const path = require('path');
const splitFile = require('split-file');
var FormData = require('form-data');
var fs = require('fs');

var multer = require('multer');

const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

const addresses = require('./buildHosts').addresses;

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

app.post('/ping', (req, res) => {
    handleRequest(req);
    sendMessage(`${new Date().toLocaleString()} - server ${req.body.nodeId} it's pinging me`);
    res.status(200).send({ serverStatus: status });
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
    res.status(200).send('ok');
    io.emit('newLearner', learnerId);
});

app.post('/upload', fileUpload.single('uploadFile'), function (req, res, next) {
    handleUploadedFile(req.file.path);
    res.send("File upload successfully");
});

app.post('/upload/chunk', chunkUpload.single('chunk'), function (req, res, next) {
    console.log(`/upload/chunk >>>`, req);
    // handleUploadedFile(req.file.path);
    // res.send("File upload successfully");
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

async function setNewLearner() {
    while (true) {
        console.log(`checking NewLearner >>>`, learnerId)
        let response = await axios.post(servers.get(leaderId) + '/ping', { learnerId });
        if (response.data.serverStatus === 'ok') {
            io.emit('newLearner', learnerId);
            servers.forEach(async (value) => await axios.post(value + '/newLearner', { idLearner: learnerId }));
            console.log(`set NewLearner >>>`, learnerId)
            return;
        } else if(++learnerId >= leaderId){
            return;
        }
    }
}

function handleUploadedFile(filePath) {
    let activeNodeList = [];

    console.log(`servers >>>`, servers);
    new Promise((resolve, reject) => {
        console.log(`servers inside >>>`, servers);
        let pingCount = 0;
        servers.forEach(async (value, key) => {
            try {
                if (key !== nodeId) {
                    console.log(`ping >>>`, value);
                    let response = await axios.post(value + '/ping', { nodeId });
                    console.log(`response >>>`, value);
                    if (response.data.serverStatus === 'ok') {
                        activeNodeList.push(value);
                    }
                }
                console.log(`count >>>`, ++pingCount, servers.size);
                if (pingCount === servers.size) resolve();
            } catch (error) {
                console.log(`error >>>`, error);
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
                console.log(chunkNames);

                // TODO: save chunk address - table


                const nodeChunksMap = new Map(); // TODO: save this map in local file or db
                // send two chunk files for each node
                activeNodeList.forEach((node, index) => {
                    let firstChunkIndex = index;
                    let secondChunkIndex = index == 0 ? chunkNames.length - 1 : index - 1;

                    nodeChunksMap.set(node, [ chunkNames[ firstChunkIndex ], chunkNames[ secondChunkIndex ] ]);
                    sendFileToNode(node, path.resolve("uploads", chunkNames[ firstChunkIndex ]));
                    sendFileToNode(node, path.resolve("uploads", chunkNames[ secondChunkIndex ]));
                });

                // TODO: send map/table to learner NODE
                console.log(`nodeChunksMap >>> `, nodeChunksMap);

            })
            .catch((err) => {
                console.log('Error: ', err);
            });
    });
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
    socket.on('kill', () => {
        sendMessage(`${new Date().toLocaleString()} - Not a leader anymore`);
        status = 'fail';
        isUP = false;
        isCoordinator = false;
    });
});

server.listen(addresses[ baseIndexServer ].port, addresses[ baseIndexServer ].host);
console.log(`App listening on http://${addresses[ baseIndexServer ].host}:${addresses[ baseIndexServer ].port}`);

setTimeout(checkLeader, 3000);
