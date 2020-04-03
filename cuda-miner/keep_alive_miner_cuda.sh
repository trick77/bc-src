#!/bin/bash
export LD_LIBRARY_PATH="${HOME}/grpc/build:$LD_LIBRARY_PATH"
while true; do
    logname=miner_`date +%s`.log
    timeout -s 9 60m ./cuda_miner >& $logname
    gzip $logname
done
