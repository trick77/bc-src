. ./buildenv-cuda
pushd cuda-miner/src/
make -f ../Makefile
cp miner ../../cuda_miner
popd
