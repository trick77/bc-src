#!/bin/bash
set -ex

# TODO: Fire up miner only if start command is passed

cd /bc

echo "Firing up the CUDA miner first..."
./miner &
sleep 1

echo "Starting bcnode..."
exec "./bin/cli $*"

