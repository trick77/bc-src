#!/bin/bash

pushd $HOME
git clone -b v1.24.2 https://github.com/grpc/grpc
pushd grpc
git submodule update --init
mkdir -p build
pushd build
cmake ..
make

popd

popd

popd
