#!/usr/bin/env bash
image="trick77/bcnode-gpu:latest"

echo "Check the following output if Docker has access to one or more GPUs:"
docker run --rm --gpus all nvidia/cuda:10.2-base nvidia-smi

if [ -z "${BC_MINER_KEY}" ]; then
  echo
  echo "Error: Miner key missing in the environment. Do something like export BC_MINER_KEY=\"0x..yourminerkey\""
  echo "Aborting."
  exit 1
fi

if [ -z "${BC_SCOOKIE}" ]; then
  echo
  echo "Error: Scookie is missing in the environment. Do something like export BC_SCOOKIE=\"s3cr3t\""
  echo "Aborting."
  exit 1
fi

# Start bcnode-gpu container
docker run --rm --name bcnode \
--memory-reservation="6900m" \
--gpus all \
-p 3000:3000 -p 16060:16060/tcp -p 16060:16060/udp -p 16061:16061/tcp -p 16061:16061/udp -p 36061:36061/tcp -p 36061:36061/udp -p 36060:36060/tcp -p 36060:36060/udp -d \
-e BC_MINER_KEY="${BC_MINER_KEY}" \
-e BC_NETWORK="main" \
-e BC_FORCE_MINE=true \
-e MIN_HEALTH_NET=true \
-e BC_TUNNEL_HTTPS=true \
-e BC_GRPC_RUST_MINER_PORT=50052 \
-e BC_RUST_MINER=true \
-e NODE_OPTIONS=--max_old_space_size=6096 \
--mount source=db,target=/bc/_data \
${image} \
start --rovers --rpc --ws --ui --node --scookie "${BC_SCOOKIE}" 2>&1
