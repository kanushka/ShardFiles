let socket = io();

socket.on('status', (message) => {
    let content = document.createTextNode(message);
    let li = document.createElement("li");
    li.className = "list-group-item";
    li.appendChild(content);
    document.getElementById('log-list').appendChild(li);
});

socket.on('newLeader', (leaderId) => {
    document.getElementById('leader').innerHTML = `Node ${leaderId} is the leader`;
});

socket.on('newLearner', (learnerId) => {
    document.getElementById('learner').innerHTML = `Node ${learnerId} is the learner`;
});

socket.on('disconnect', () => {
    socket.close();
    console.log('Socket connection closed!');
});

function killing() {
    socket.emit('kill', '');
}
