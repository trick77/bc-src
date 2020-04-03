// The basic components of a GPU-based block collider miner
// lgray@github September 2018
// permission granted to use under MIT license
// this is a GPU miner for block collider that does ~ 40M hashes + distances per second on a Tesla P100, ~17 M hashes + distances per second on a 1060

#ifndef __BC_GPU_MINER_H__
#define __BC_GPU_MINER_H__

#include <cuda.h>
#include <cuda_runtime.h>
#include <vector>
#include "blake2.h"

static const unsigned HASH_TRIES = 1 << 23;
static const unsigned N_MINER_THREADS_PER_BLOCK = 32;

// forward decl of curandState
// include curand_kernel.h in your .cu file!!
typedef struct curandStateXORWOW curandState; 
//typedef CUstream_st * cudaStream_t;

struct bc_mining_data {
  static const size_t INLENGTH = 2048;
  uint8_t  result[HASH_TRIES*BLAKE2B_OUTBYTES],nonce_hashes[HASH_TRIES*BLAKE2B_OUTBYTES];
  uint64_t distance[HASH_TRIES];
  uint64_t nonce[HASH_TRIES];
  bool     over_difficulty[HASH_TRIES];
  // common data
  uint8_t  work_template_[INLENGTH]; 
  uint8_t  miner_key_[BLAKE2B_OUTBYTES];
  uint8_t  merkel_root_[BLAKE2B_OUTBYTES];
  uint8_t  received_work_[BLAKE2B_OUTBYTES];
  uint8_t  time_stamp_[BLAKE2B_OUTBYTES];
  uint16_t nonce_hash_offset_;
  uint16_t work_size_;
  size_t   miner_key_size_;
  size_t   time_stamp_size_;
  unsigned long long the_difficulty_;
};

struct bc_mining_inputs {
  uint8_t  miner_key_[BLAKE2B_OUTBYTES];
  uint8_t  merkel_root_[BLAKE2B_OUTBYTES];
  uint8_t  received_work_[BLAKE2B_OUTBYTES];
  uint8_t  time_stamp_[BLAKE2B_OUTBYTES];
  uint16_t work_size_;
  size_t   miner_key_size_;
  size_t   time_stamp_size_;
  unsigned long long the_difficulty_;
};

struct bc_mining_outputs {
  uint8_t  result_blake2b_[BLAKE2B_OUTBYTES];
  uint64_t distance_, difficulty_, iterations_;
  uint64_t nonce_;  
};

struct bc_mining_mempools {

  bc_mining_mempools() : dev_states(NULL), dev_cache(NULL), scratch_dists(NULL), scratch_indices(NULL) {}
  
  curandState*    dev_states;
  bc_mining_data* dev_cache;
  uint64_t*       scratch_dists;
  uint64_t*       scratch_indices;
};

struct bc_mining_stream {
  bc_mining_mempools pool;
  cudaStream_t stream;
  int device;
};

struct bc_thread_data {
  const bc_mining_inputs* in;
  bc_mining_outputs *out;
  bc_mining_stream* stream;
  uint64_t start_nonce;
  bool *solution_found;
};

// do this once
void init_gpus(std::vector<bc_mining_stream>& streams);
// do this once for each GPU you would like to use
void init_mining_memory(bc_mining_mempools& pool, cudaStream_t stream);
// do this a bunch
void run_miner(const bc_mining_inputs& in, const unsigned seed_mixer, bc_mining_stream& pool,bc_mining_outputs& out);
// for threading
void* run_miner_thread(void *);
// do this once for each GPU
void destroy_mining_memory(bc_mining_mempools& pool, cudaStream_t stream);
// do this once
void destroy_gpus(std::vector<bc_mining_stream>& streams);
 

#endif
