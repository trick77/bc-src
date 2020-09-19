P2P 46-062 
==========

### Persitence Keys
* "bc.sync.initialpeerheader" string of status of the IPH test {pending -> running -> complete}
* "bc.sync.initialpeerdata" string of status of the IPD test {pending -> running -> complete}
* "bc.sync.initialpeernum" number of unique peers evaluated in IPH test 
* "bc.sync.initialpeerevents" array of the times for each peer participating in IPH 
* "bc.sync.initialpeer" the peer for the current series of requests 

## Data
* the first seven characters of the message encoded to ASCII must be the message type listed in p2p/protocol.es6

### Case 1: New Node

- IPD and IPH tests are set to incomplete
    bc.sync.initialpeerheader = pending
    bc.sync.initialpeerdata = pending
    bc.sync.initialpeernum = 0
    bc.sync.initialpeerevents = []
    bc.sync.initialpeer = {deleted} 
- the discovery module passes a potential peer connection to the p2p/node 
- connection is opening using FRAMING_OPTS and data is piped to p2p/node.peerDataHandler
- the status of IPH is checked first, if it is "running" only message types BLOCK, BLOCKS, HEADER, HEADERS can be recieved 
- if IPH is "complete" then IPD status is checked, if IPD is not equal to complete then all messages of BLOCK type are ignored
- if "bc.sync.initialpeer" has been set to a peer, it checks if it has expired if so the IPH test resets to the next best peer and IPH to "running"




