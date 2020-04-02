. ./buildenv_cuda
pushd bc-miner-cuda/src/
make -f ../Makefile
cp miner ../../cuda_miner
popd
