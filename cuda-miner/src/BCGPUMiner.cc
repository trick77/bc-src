#include "BCGPUMiner.h"

#include <sstream>
#include <iostream>
#include <cassert>
#include <pthread.h>
#include <cstring>

#include <random>
#include <chrono>

BCGPUMiner::BCGPUMiner():
  cancel(false),
  solution_found(false) {
  memset(&in, 0, sizeof(bc_mining_inputs));
}

BCGPUMiner::~BCGPUMiner() {}

void BCGPUMiner::init_memory() {
  std::cout << "init BCGPUMiner!" << std::endl;
  init_gpus(streams);
  thread_data.resize(streams.size());
  threads.resize(streams.size());
  outs.resize(streams.size());

  for(unsigned iGPU = 0; iGPU < streams.size(); ++iGPU) {
    thread_data[iGPU].in = &in;    
    thread_data[iGPU].out = &outs[iGPU];
    thread_data[iGPU].stream = &streams[iGPU];
    thread_data[iGPU].solution_found = &solution_found;
    thread_data[iGPU].cancel = &cancel;
  }
  
}

void BCGPUMiner::destroy_memory() {
  std::cout << "destroy BCGPUMiner" << std::endl;
  destroy_gpus(streams);
  thread_data.resize(0);
  threads.resize(0);
  outs.resize(0);
}

void BCGPUMiner::submit_job(const bc_mining_inputs& job) {
  cancel = true;

  std::lock_guard<std::mutex> lock(mtx_yield_results);
  std::cout << "captured lock in ::submit_job" << std::endl;
  cancel = false;
  solution_found = false;

  memcpy(&in, &job, sizeof(bc_mining_inputs));

  unsigned seed = std::chrono::system_clock::now().time_since_epoch().count();
  std::mt19937_64 generator(seed);
  uint64_t start_nonce = generator();

  for(unsigned iGPU = 0; iGPU < streams.size(); ++iGPU) {
    thread_data[iGPU].start_nonce = start_nonce + 100*iGPU*HASH_TRIES + generator();
    
    int result_code = pthread_create(&threads[iGPU], NULL, run_miner_thread, &thread_data[iGPU]);
    assert(!result_code);
  }
  std::cout << "submitted job successfully!" << std::endl;
}

BCGPUMiner::result_type BCGPUMiner::yield_result(bc_mining_outputs& out) {
  std::lock_guard<std::mutex> lock(mtx_yield_results);
  std::cout << "captured lock in ::yield_result" << std::endl;
  unsigned best_result = 0;
  uint64_t best_distance = 0;
  uint64_t total_iterations = 0;

  for ( unsigned iGPU = 0; iGPU < streams.size(); ++iGPU) {
    // block until thread 'index' completes
    int result_code = pthread_join(threads[iGPU], NULL);
    assert(!result_code);
    std::cout << "In mining_loop: thread " << iGPU <<" has completed" << std::endl;
    
    
    std::stringstream result;
    result << std::hex;
    for( unsigned i = 32; i < BLAKE2B_OUTBYTES; ++i ) {
      result << (unsigned)(outs[iGPU].result_blake2b_[i]>>4)
	     << (unsigned)(outs[iGPU].result_blake2b_[i]&0xf);
    }
    result << std::dec;
    std::cout << iGPU << " result     : " << result.str() << std::endl
	      << iGPU << " nonce      : " << outs[iGPU].nonce_ << std::endl
	      << iGPU << " difficulty : " << outs[iGPU].difficulty_ << std::endl
	      << iGPU << " iterations : " << outs[iGPU].iterations_ << std::endl
	      << iGPU << " distance   : " << outs[iGPU].distance_ << std::endl;
    
    if( outs[iGPU].distance_ > best_distance ) {
      best_result = iGPU;
      best_distance = outs[iGPU].distance_;
      memcpy(&out,&outs[best_result],sizeof(bc_mining_outputs));
    }
    total_iterations += outs[iGPU].iterations_;
  }
  out.iterations_ = total_iterations;

  // kill the processing loop if we try the first iteration
  // and nothing is above the minimum distance ("unsolvable" block)
  if( !out.canceled_ && ((double)best_distance < 0.990*((double)in.the_difficulty_)) ) {//290112262029012ULL ) {
    std::cout << "WEIRD --->>> Unsolvable block!" << std::endl;
  }

  cancel = false;
  solution_found = false;
  return out.canceled_ ? result_type::CANCELED : result_type::SUCCESS;
}
