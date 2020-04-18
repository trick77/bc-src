// The basic components of a GPU-based block collider miner
// lgray@github September 2018
// permission granted to use under MIT license
// this is a GPU miner for block collider that does ~ 20M hashes + distances per second

#include "bc_miner.h"
#include "blake2.h"
#include "blake2b.cu"
#include "cos_dist.cu"
#include <curand_kernel.h>
#include "stdio.h"
#include <random>
#include <chrono>
#include <pthread.h>

//mutexes
pthread_mutex_t solution_found_mutex = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t data_xfer_mutex = PTHREAD_MUTEX_INITIALIZER;

__global__ void setup_rand(curandState* state, uint32_t random)
{
  unsigned id = threadIdx.x + blockIdx.x * blockDim.x;
  unsigned clk = (unsigned)clock64();  
  /* Each thread gets same seed, a different sequence 
     number, no offset */
  curand_init(id+random +clk, 0, 0, &state[id]);
}

//__device__ __host__ __forceinline__ 
__global__
void one_unit_work(bc_mining_data* mining_info) {
  
  unsigned id = threadIdx.x + blockIdx.x *blockDim.x;
  
  uint8_t data_in[bc_mining_data::INLENGTH];
  //memset(data_in,0,bc_mining_data::INLENGTH); // this memset is unecessary 
  
  const size_t idoffset = id*BLAKE2B_OUTBYTES;
  memcpy(data_in,mining_info->work_template_,mining_info->work_size_);
  memcpy(data_in+mining_info->nonce_hash_offset_,mining_info->nonce_hashes+idoffset,BLAKE2B_OUTBYTES);

  
  blake2b_state s;
  blake2b_init_cu(&s,BLAKE2B_OUTBYTES);  
  blake2b_update_cu(&s,data_in,mining_info->work_size_);
  blake2b_final_cu(&s,mining_info->result+idoffset,BLAKE2B_OUTBYTES);
  

  mining_info->distance[id] = cosine_distance_cu(mining_info->received_work_,
						 mining_info->result+id*BLAKE2B_OUTBYTES);
}

__global__
void prepare_work_nonces(curandState *state, uint64_t startnonce, bc_mining_data* mining_info) {

  static uint16_t num_to_code[16] =  {48,49,50,51,52,53,54,55,56,57,97,98,99,100,101,102};  

  unsigned id = threadIdx.x + blockIdx.x * blockDim.x;
    
  curandState localState = state[id];
  uint8_t nonce_string[64]; // ten bytes and a null character max;
  uint8_t nonce_hash[BLAKE2B_OUTBYTES];
  memset(nonce_string,0,64);

  //2060688607;
  uint64_t nonce = startnonce + id + curand(&localState) + ( ((uint64_t)curand(&localState)) << 32 );
  
  // convert nonce
  nonce_string[0] = '0'; // take care of base case
  uint32_t length = 0;
  uint64_t red_nonce = nonce;
  while( red_nonce > 0 ) { ++length; red_nonce /= 10ULL; }
  red_nonce = nonce;
  for( uint64_t i = length; i > 1; --i ) {
    nonce_string[i-1] = num_to_code[red_nonce%10];
    red_nonce /= 10ULL;
  }
  nonce_string[0] = num_to_code[red_nonce];
  length = (length == 0) + (length > 0)*length;
  
  //printf("length: %u %u %s\n",length,nonce,nonce_string); 
  
  // create the nonce hash
  blake2b_state ns;
  blake2b_init_cu(&ns,BLAKE2B_OUTBYTES);  
  blake2b_update_cu(&ns,nonce_string,length);
  blake2b_final_cu(&ns,nonce_hash,BLAKE2B_OUTBYTES);

  // hash the hash for extra hashiness
  //blake2b_state ns1;
  //blake2b_init_cu(&ns1,BLAKE2B_OUTBYTES);
  //blake2b_update_cu(&ns1,nonce_hash,BLAKE2B_OUTBYTES);
  //blake2b_final_cu(&ns1,nonce_hash_hash,BLAKE2B_OUTBYTES);

  // convert nonce in place to string codes and "blake2bl" form
  #pragma unroll
  for( unsigned i = 32; i < BLAKE2B_OUTBYTES; ++i ) {
    uint8_t byte = nonce_hash[i];
    nonce_hash[2*(i-32)] = num_to_code[byte>>4];
    nonce_hash[2*(i-32)+1] = num_to_code[byte&0xf];
  }
    
  // now we put everything into the data_in string in stringified hex form  
  const size_t idoffset = id*BLAKE2B_OUTBYTES;
  memcpy(mining_info->nonce_hashes+idoffset,
	 nonce_hash,
	 BLAKE2B_OUTBYTES);  

  //copy the local work back to the gpu memory  
  mining_info->nonce[id] = nonce;

  state[id] = localState;
}

__global__ void prepare_max_distance(uint64_t *max, uint64_t *maxidx, const uint64_t *a) {
  __shared__ uint64_t maxtile[N_MINER_THREADS_PER_BLOCK];
  __shared__ uint64_t maxidxtile[N_MINER_THREADS_PER_BLOCK];
  
  unsigned int tid = threadIdx.x;
  uint64_t i = blockIdx.x * blockDim.x + threadIdx.x;
  maxtile[tid] = a[i];
  maxidxtile[tid] = i;
  __syncthreads();
  
  //sequential addressing by reverse loop and thread-id based indexing
  for (unsigned int s = blockDim.x / 2; s > 0; s >>= 1) {
    if (tid < s) {
      if (maxtile[tid + s] > maxtile[tid]) {
	maxtile[tid] = maxtile[tid + s];
	maxidxtile[tid] = maxidxtile[tid + s];
      }
    }
    __syncthreads();
  }
  
  if (tid == 0) {
    max[blockIdx.x] = maxtile[0];
    maxidx[blockIdx.x] = maxidxtile[0];
  }
}

__global__ void finalize_max_distance(uint64_t *max, uint64_t *maxidx) {
  __shared__ uint64_t maxtile[N_MINER_THREADS_PER_BLOCK];
  __shared__ uint64_t maxidxtile[N_MINER_THREADS_PER_BLOCK];

  unsigned int tid = threadIdx.x;
  uint64_t i = blockIdx.x * blockDim.x + threadIdx.x;
  maxtile[tid] = max[i];
  maxidxtile[tid] = maxidx[i];
  __syncthreads();
  
  //sequential addressing by reverse loop and thread-id based indexing
  for (unsigned int s = blockDim.x / 2; s > 0; s >>= 1) {
    if (tid < s) {
      if (maxtile[tid + s] > maxtile[tid]) {
	maxtile[tid] = maxtile[tid + s];
	maxidxtile[tid] = maxidxtile[tid + s];
      }
    }
    __syncthreads();
  }
  
  if (tid == 0) {    
    max[blockIdx.x] = maxtile[0];
    maxidx[blockIdx.x] = maxidxtile[0];
  }
}

void init_gpus(std::vector<bc_mining_stream>& streams) {
  streams.clear();
  int nGPUs = 0;
  cudaGetDeviceCount(&nGPUs);
  std::cout << "Found " << nGPUs << " GPUs to use for mining!" << std::endl;

  streams.resize(nGPUs);
  for( unsigned iGPU = 0; iGPU < nGPUs; ++iGPU ) {
    streams[iGPU].device = iGPU;
    cudaSetDevice(iGPU);
    cudaDeviceReset();
    cudaStreamCreate(&streams[iGPU].stream);
    init_mining_memory(streams[iGPU].pool,streams[iGPU].stream);
  }
}

// create the primary mining work areas
// run this once to create the memory pools necessary for mining
// large cudaMallocs take a long time, cudaMemset is fast
void init_mining_memory(bc_mining_mempools& pool, cudaStream_t stream) {
  if( pool.dev_cache != NULL ) return;
  if( pool.dev_states != NULL ) return;
  if( pool.scratch_dists != NULL ) return;
  if( pool.scratch_indices != NULL ) return;

  // allocate device memory for random states and hashing work
  cudaStreamSynchronize(stream);
  cudaMalloc((void **)&pool.dev_states, HASH_TRIES * 1 * sizeof(curandState));
  cudaMalloc(&pool.dev_cache,sizeof(bc_mining_data));
  cudaMalloc(&pool.scratch_dists,HASH_TRIES*sizeof(uint64_t));
  cudaMalloc(&pool.scratch_indices,HASH_TRIES*sizeof(uint64_t));
  cudaStreamSynchronize(stream);
}

void run_miner(const bc_mining_inputs& in, const uint64_t start_nonce, bc_mining_stream& bcstream, bc_mining_outputs& out, bool& solution_found, bool& cancel) {
  cudaSetDevice(bcstream.device);
  cudaStream_t stream = bcstream.stream;
  bc_mining_mempools& pool = bcstream.pool;

  if( pool.dev_cache == NULL ) return;
  if( pool.dev_states == NULL ) return;
  if( pool.scratch_dists == NULL ) return;
  if( pool.scratch_indices == NULL ) return;
  
  uint64_t nonce_local = start_nonce;

  unsigned seed = std::chrono::system_clock::now().time_since_epoch().count();
  std::mt19937_64 generator(seed);

  dim3 threads(N_MINER_THREADS_PER_BLOCK,1,1), blocks(HASH_TRIES/N_MINER_THREADS_PER_BLOCK,1,1);
  
  //random numbers
  uint16_t work_size = in.miner_key_size_ + 2*BLAKE2B_OUTBYTES + in.time_stamp_size_;
  uint16_t nonce_hash_offset = in.miner_key_size_ + BLAKE2B_OUTBYTES;

  // prepare the mining work
  cudaMemsetAsync(pool.dev_cache,0,sizeof(bc_mining_data),stream);
  cudaMemcpyAsync(&pool.dev_cache->time_stamp_size_, &in.time_stamp_size_, sizeof(size_t), cudaMemcpyHostToDevice,stream);
  cudaMemcpyAsync(pool.dev_cache->time_stamp_, in.time_stamp_, in.time_stamp_size_, cudaMemcpyHostToDevice,stream);
  cudaMemcpyAsync(&pool.dev_cache->miner_key_size_, &in.miner_key_size_, sizeof(size_t), cudaMemcpyHostToDevice,stream);
  cudaMemcpyAsync(pool.dev_cache->miner_key_, in.miner_key_, in.miner_key_size_, cudaMemcpyHostToDevice,stream);
  cudaMemcpyAsync(pool.dev_cache->received_work_, in.received_work_, BLAKE2B_OUTBYTES, cudaMemcpyHostToDevice,stream);
  cudaMemcpyAsync(pool.dev_cache->merkel_root_,in.merkel_root_, BLAKE2B_OUTBYTES, cudaMemcpyHostToDevice,stream);

  //setup the work template
  cudaMemsetAsync(pool.dev_cache->work_template_,0,bc_mining_data::INLENGTH,stream);
  cudaMemcpyAsync(&pool.dev_cache->nonce_hash_offset_,&nonce_hash_offset,sizeof(uint16_t),cudaMemcpyHostToDevice,stream);
  cudaMemcpyAsync(&pool.dev_cache->work_size_,&work_size,sizeof(uint16_t),cudaMemcpyHostToDevice,stream);
  unsigned index = 0;
  cudaMemcpyAsync(pool.dev_cache->work_template_,pool.dev_cache->miner_key_,in.miner_key_size_,cudaMemcpyDeviceToDevice,stream);
  index += in.miner_key_size_;
  cudaMemcpyAsync(pool.dev_cache->work_template_+index,pool.dev_cache->merkel_root_,BLAKE2B_OUTBYTES,cudaMemcpyDeviceToDevice,stream);
  index += 2*BLAKE2B_OUTBYTES; //advance past nonce hash area
  cudaMemcpyAsync(pool.dev_cache->work_template_+index,pool.dev_cache->time_stamp_,in.time_stamp_size_,cudaMemcpyDeviceToDevice,stream);
  index += in.time_stamp_size_;
  
  // work areas for finding max
  uint64_t best_value(0);
  uint64_t max_value(0), max_idx(0);
  cudaMemsetAsync(pool.scratch_dists,0,HASH_TRIES*sizeof(uint64_t),stream);
  cudaMemsetAsync(pool.scratch_indices,0,HASH_TRIES*sizeof(uint64_t),stream);
  
  uint64_t iterations = 0;
  // the following kernel launches are the primary work
  // only set the random seeds once
  
  setup_rand<<<blocks,threads,0,stream>>>(pool.dev_states,((const uint32_t*)in.received_work_)[0]^((uint32_t)start_nonce));
  do {
    //cudaMemsetAsync(pool.dev_states,0,HASH_TRIES*sizeof(curandState),stream);
    //setup_rand<<<blocks,threads,0,stream>>>(pool.dev_states,((const uint32_t*)in.received_work_)[0]^((uint32_t)nonce_local));

    if( solution_found || cancel ) break;
    cudaMemsetAsync(pool.dev_cache->result,0,HASH_TRIES*BLAKE2B_OUTBYTES,stream);
    cudaMemsetAsync(pool.dev_cache->nonce,0,HASH_TRIES*sizeof(uint64_t),stream);
    cudaMemsetAsync(pool.dev_cache->nonce_hashes,0,HASH_TRIES*BLAKE2B_OUTBYTES,stream);
   
    prepare_work_nonces<<<blocks,threads,0,stream>>>(pool.dev_states, nonce_local, pool.dev_cache);
    one_unit_work<<<blocks,threads,0,stream>>>(pool.dev_cache);
    cudaMemsetAsync(pool.scratch_dists,0,HASH_TRIES*sizeof(uint64_t),stream);
    cudaMemsetAsync(pool.scratch_indices,0,HASH_TRIES*sizeof(uint64_t),stream);
    prepare_max_distance<<<blocks,threads,0,stream>>>(pool.scratch_dists,pool.scratch_indices,pool.dev_cache->distance);
    unsigned temp = blocks.x;
    while( temp > threads.x ) {
      temp /= threads.x;
      finalize_max_distance<<<temp,threads,0,stream>>>(pool.scratch_dists,pool.scratch_indices);
    }
    finalize_max_distance<<<1,temp,0,stream>>>(pool.scratch_dists,pool.scratch_indices);
    // get the max value and index, which are at index zero in the scratch arrays
    cudaMemcpyAsync(&max_value,pool.scratch_dists,sizeof(uint64_t),cudaMemcpyDeviceToHost,stream);
    cudaMemcpyAsync(&max_idx,pool.scratch_indices,sizeof(uint64_t),cudaMemcpyDeviceToHost,stream);
    cudaStreamSynchronize(stream);
    if( max_value > best_value ) {
      best_value = max_value;
      const uint64_t offsetb2b = max_idx*BLAKE2B_OUTBYTES;
      cudaMemcpyAsync(out.result_blake2b_,pool.dev_cache->result+offsetb2b, BLAKE2B_OUTBYTES,cudaMemcpyDeviceToHost,stream);
      cudaMemcpyAsync(&out.nonce_, &pool.dev_cache->nonce[max_idx], sizeof(uint64_t), cudaMemcpyDeviceToHost,stream);
    }
    ++iterations;    
    nonce_local = generator() ^ generator();
  } while( max_value <= in.the_difficulty_ && !solution_found && !cancel);

  if( !cancel ) {
    std::cout << bcstream.device << " found solution! " << max_value << std::endl;
    pthread_mutex_lock( &solution_found_mutex );
    if( !solution_found ) solution_found = true;
    pthread_mutex_unlock( &solution_found_mutex );

    out.difficulty_ = in.the_difficulty_;
    out.distance_ = best_value;
    out.iterations_ = iterations*HASH_TRIES;
    out.canceled_ = false;
  } else {
    std::cout << bcstream.device << " canceled!" << std::endl;

    out.difficulty_ = in.the_difficulty_;
    out.distance_ = best_value;
    out.iterations_ = iterations*HASH_TRIES;
    out.canceled_ = true;
  }

}

void* run_miner_thread(void * input) {
  bc_thread_data& inputs = *((bc_thread_data*)input);
  run_miner(*inputs.in,inputs.start_nonce,*inputs.stream,*inputs.out, *inputs.solution_found, *inputs.cancel);
  return NULL;
}

void destroy_mining_memory(bc_mining_mempools& pool, cudaStream_t stream) {
  if( pool.dev_cache == NULL ) return;
  if( pool.dev_states == NULL ) return;
  if( pool.scratch_dists == NULL ) return;
  if( pool.scratch_indices == NULL ) return;

  // free device memory
  cudaStreamSynchronize(stream);
  cudaFree(pool.dev_states);
  cudaFree(pool.dev_cache);
  cudaFree(pool.scratch_dists);
  cudaFree(pool.scratch_indices);
  cudaStreamSynchronize(stream);

  // set it to null
  pool.dev_states = NULL;
  pool.dev_cache = NULL;
  pool.scratch_dists = NULL;
  pool.scratch_indices = NULL;
}

void destroy_gpus(std::vector<bc_mining_stream>& streams) {
  for(unsigned i = 0; i < streams.size(); ++i ) {
    cudaSetDevice(streams[i].device);
    destroy_mining_memory(streams[i].pool,streams[i].stream);
    cudaStreamDestroy(streams[i].stream);
  }
  streams.resize(0);
}
