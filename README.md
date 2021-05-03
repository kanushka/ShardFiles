# ShardFiles
ShardFiles is a distributed file management system. Its purpose is to provide quick and reliable access to large files. The system is designed such that there is a master coordinator and multiple slave nodes. All salve nodes keep chunk of large file.

## How to setup

clone the ShardFiles project

Install node modules
`npm install`

Build packages
`npm build`

Run instance with NODE_INDEX environment variable. NODE_INDEX will set the Node id and published port
`export NODE_INDEX=1 && npm start`

Running Nodes will automatically detect max NODE_INDEX Node as a leader. (Bully Algorithm)
