#!/usr/bin/env bash
export BC_MINER_KEY="0x....."
export BC_NETWORK="main"
export BC_FORCE_MINE=true
export MIN_HEALTH_NET=true
export NODE_OPTIONS=--max_old_space_size=13000
export BC_LOG="info"
export BC_DEBUG=true
export BC_TUNNEL_HTTPS=true
export BC_MAX_CONNECTIONS=500
export BC_GRPC_RUST_MINER_PORT=50052
export BC_RUST_MINER=true
../bin/cli start --rovers --rpc --ws --ui --node --scookie "gestalt consciousness ball pit"
