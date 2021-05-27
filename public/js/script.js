let socket = io();

socket.on('status', (message) => {
    let content = document.createTextNode(message);
    let li = document.createElement("li");
    li.className = "list-group-item";
    li.appendChild(content);
    try {        
        document.getElementById('log-list').appendChild(li);
    } catch (error) {
        // no element here.
    }
});

socket.on('newLeader', (leaderId) => {
    document.getElementById('leader').innerHTML = `Node ${leaderId} is the leader`;
});

socket.on('newLearner', (learnerId) => {
    document.getElementById('learner').innerHTML = `Node ${learnerId} is the learner`;
});

socket.on('fileUpdated', (fileListString) => {
    try {
        let fileList = JSON.parse(fileListString);

        let fileListEl = document.getElementById('file-list');
        fileListEl.innerHTML = "";

        fileList.forEach(file => {
            let content = document.createTextNode(file);
            let li = document.createElement("li");
            // li.className = "list-group-item";
            li.appendChild(content);
            fileListEl.appendChild(li);
        });
        
    } catch (error) {
        console.error(`cannot find updated file list`, error)
    }
});

socket.on('chunkListReceived', (chunkListString) => {
    try {
        let fileList = JSON.parse(chunkListString);
        console.log(`received file chunk list >>> `, fileList)
    } catch (error) {
        console.error(`cannot find updated chunk list`, error)
    }
});

socket.on('disconnect', () => {
    socket.close();
    console.log('Socket connection closed!');
});

function downloadFile(fileName) {
    console.log(`send download request to file`, fileName)
    socket.emit('download', fileName);
}
