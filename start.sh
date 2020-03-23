#!/usr/bin/env bash
export BC_MINER_KEY="0xbadcafe0cafebabe0dabbad000cafed00ddead00"
export BC_NETWORK="main"
export BC_FORCE_MINE=true
export MIN_HEALTH_NET=true
export NODE_OPTIONS=--max_old_space_size=6096
export BC_DEBUG=true
export BC_LOG="debug"
./bin/cli start --rovers --rpc --ws --ui --node --scookie "whenhoodie"
