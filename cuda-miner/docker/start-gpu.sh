#!/usr/bin/env bash
image="bcnode-gpu:latest"

# Outputs if docker has access to your GPU. Does nothing else.
docker run --rm --gpus all nvidia/cuda:10.0-base nvidia-smi

docker run --rm --name bcnode \
--memory-reservation="6900m" \
--gpus all \
-p 3000:3000 -p 16060:16060/tcp -p 16060:16060/udp -p 16061:16061/tcp -p 16061:16061/udp -p 36061:36061/tcp -p 36061:36061/udp -p 36060:36060/tcp -p 36060:36060/udp  \
-e BC_MINER_KEY="${MINER_KEY}" \
-e BC_NETWORK="main" \
-e BC_FORCE_MINE=true \
-e MIN_HEALTH_NET=true \
-e BC_TUNNEL_HTTPS=true \
-e BC_GRPC_RUST_MINER_PORT=50052 \
-e BC_RUST_MINER=true \
-e NODE_OPTIONS=--max_old_space_size=6096 \
${image} \
start --rovers --rpc --ws --ui --node --scookie "scookie" 2>&1
