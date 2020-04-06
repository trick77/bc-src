#!/bin/sh
set -e

echo "*** Applying patch to re-enable RPC miner..."
sed -i 's/if[[:space:]]\+(false[[:space:]]\+||[[:space:]]\+BC_RUST_MINER)[[:space:]]\+{/if (BC_RPC_MINER) {/g' ./lib/mining/officer.js
sed -i 's/BC_RUST_MINER/BC_RPC_MINER/g' ./lib/mining/officer.js

echo "*** Applying some more monkey patching..."
perl -0777pe 's/if \(response\.getResult\(\) === MinerResponseResult\.CANCELED\) \{.*?\}/`cat monkey-patch`/se' ./lib/mining/officer.js

echo "*** Applying patch to override the RPC miner's address..."
sed -i "s/const[[:space:]]\+GRPC_MINER_URL[[:space:]]\+=.*/const GRPC_MINER_URL = 'gpuminer:50052'/g" ./lib/rpc/client.js

echo "*** Starting bcnode..."

exec "./bin/cli" $@

