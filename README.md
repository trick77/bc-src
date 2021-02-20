[![deepcode](https://www.deepcode.ai/api/gh/badge?key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwbGF0Zm9ybTEiOiJnaCIsIm93bmVyMSI6InRyaWNrNzciLCJyZXBvMSI6ImJjLXNyYyIsImluY2x1ZGVMaW50IjpmYWxzZSwiYXV0aG9ySWQiOjI3NjE3LCJpYXQiOjE2MTM4MDYwMDN9.YNWMYw_Iyv_iKMPpOuQCESeSKn_8FBgD4AECilH9Ah4)](https://www.deepcode.ai/app/gh/trick77/bc-src/_/dashboard?utm_content=gh%2Ftrick77%2Fbc-src)

# When open source?

Since the Overline (ex. Block Collider) team chose not to open source their miner's ES6 code and tool chain (even though they're obliged to), here's a repository 
with the current code of the miner' post-transpilation JavaScript code extracted from the official Docker image.

All versions/tags are pushed to https://hub.docker.com/r/trick77/bcnode/tags?page=1&ordering=last_updated 

## Installation hints

### Node.js

1. Get nvm: https://github.com/nvm-sh/nvm
2. Make sure to add the nvm env vars at the end of your .bashrc
3. Install Nodejs:
   ```
   nvm install v10.21.0
   nvm use v10.21.0
   nvm alias default v10.21.0
   ```
4. Edit start.sh
5. ./start.sh or screen -dm ./start.sh

