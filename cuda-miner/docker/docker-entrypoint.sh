#!/bin/sh
set -ex

# TODO: Fire up miner only if start command is passed

cd /bc

echo "Firing up the CUDA miner first..."
./miner &
sleep 1

echo "Patching sources on the fly to enable RPC miner..."
sed -i 's/if[[:space:]]\+(false[[:space:]]\+||[[:space:]]\+BC_RUST_MINER)[[:space:]]\+{/if (BC_RUST_MINER) {/g' ./lib/mining/officer.js

echo "Starting bcnode..."

exec "./bin/cli" $@

