'use strict';

const defaultHost = '0.0.0.0';
const defaultPort = 10000;
const maxNumberOfNodes = 7; // include leader and learner nodes

function getAddressList() {
    const addressList = [];
    for (let nodeId = 0; nodeId < maxNumberOfNodes; nodeId++) {
        addressList.push({
            host: defaultHost,
            port: defaultPort + nodeId
        });
    }
    return addressList;
}

exports.addresses = getAddressList();