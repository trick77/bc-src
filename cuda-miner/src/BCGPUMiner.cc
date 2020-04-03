#include "BCGPUMiner.h"

#include <sstream>
#include <iostream>
#include <cassert>
#include <pthread.h>
#include <cstring>

#include <random>
#include <chrono>

BCGPUMiner::BCGPUMiner() {}
BCGPUMiner::~BCGPUMiner() {}

void BCGPUMiner::init_memory() {
  std::cout << "init BCGPUMiner!" << std::endl;
  init_gpus(streams);  
}

void BCGPUMiner::destroy_memory() {
  std::cout << "destroy BCGPUMiner" << std::endl;
  destroy_gpus(streams);
}

void BCGPUMiner::do_mining(const bc_mining_inputs& in,
                           bc_mining_outputs& out) {
  std::cout << "running BCGPUMiner!" << std::endl;

  unsigned seed = std::chrono::system_clock::now().time_since_epoch().count();

  std::mt19937_64 generator (seed);
  
  std::vector<pthread_t> threads(streams.size());
  std::vector<bc_thread_data> thread_data(streams.size());

  std::vector<bc_mining_outputs> outs(streams.size());

  bool solution_found = false;
  uint64_t start_nonce = generator();
  for(unsigned iGPU = 0; iGPU < streams.size(); ++iGPU) {
    thread_data[iGPU].in = &in;
    thread_data[iGPU].out = &outs[iGPU];
    thread_data[iGPU].stream = &streams[iGPU];
    thread_data[iGPU].start_nonce = start_nonce + 100*iGPU*HASH_TRIES + generator();
    thread_data[iGPU].solution_found = &solution_found;
  }
  
  int result_code;
  unsigned best_result = 0;
  uint64_t best_distance = 0;
  uint64_t total_iterations = 0;
  const unsigned max_iters = 1;
  unsigned iters = 0; 
  do {
    solution_found = false;
    
    for( unsigned iGPU = 0; iGPU < streams.size(); ++iGPU ) {
      if( iters != 0 ) {
	thread_data[iGPU].start_nonce = thread_data[iGPU].start_nonce + 100*iGPU*HASH_TRIES + generator(); // just take a MT random
      }
      //std::cout << iGPU << " mixer: " << std::hex << thread_data[iGPU].seed_mixer << std::dec << std::endl;
      result_code = pthread_create(&threads[iGPU], NULL, run_miner_thread, &thread_data[iGPU]);
      assert(!result_code);
    }
    
    
    for ( unsigned iGPU = 0; iGPU < streams.size(); ++iGPU) {
      // block until thread 'index' completes
      result_code = pthread_join(threads[iGPU], NULL);
      assert(!result_code);
      std::cout << "In do_mining: thread " << iGPU <<" has completed" << std::endl;

      
      std::stringstream result;
      result << std::hex;
      for( unsigned i = 32; i < BLAKE2B_OUTBYTES; ++i ) {
	result << (unsigned)(outs[iGPU].result_blake2b_[i]>>4)
	       << (unsigned)(outs[iGPU].result_blake2b_[i]&0xf);
      }
      result << std::dec;
      std::cout << iGPU << " result     : " << result.str() << std::endl;
      std::cout << iGPU << " nonce      : " << outs[iGPU].nonce_ << std::endl;
      std::cout << iGPU << " difficulty : " << outs[iGPU].difficulty_ << std::endl;
      std::cout << iGPU << " iterations : " << outs[iGPU].iterations_ << std::endl;
      std::cout << iGPU << " distance   : " << outs[iGPU].distance_ << std::endl;
        
      if( outs[iGPU].distance_ > best_distance ) {
	best_result = iGPU;
	best_distance = outs[iGPU].distance_;
	memcpy(&out,&outs[best_result],sizeof(bc_mining_outputs));
      }
      total_iterations += outs[iGPU].iterations_;
    }
    // kill the processing loop if we try the first iteration
    // and nothing is above the minimum distance ("unsolvable" block)
    if( (double)best_distance < 0.990*((double)in.the_difficulty_) ) {//290112262029012ULL ) {
      std::cout << "WEIRD --->>> Unsolvable block!" << std::endl;
      break;
    }
    ++iters;
  } while( best_distance <= in.the_difficulty_ && iters < max_iters );
  out.iterations_ = total_iterations;
}
