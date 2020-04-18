#ifndef __BCGPUMiner_h__
#define __BCGPUMiner_h__

#include "bc_miner.h"
#include <pthread.h>
#include <mutex>
#include <vector>

class BCGPUMiner {
 public:
  enum result_type{ SUCCESS, CANCELED };

  BCGPUMiner();
  ~BCGPUMiner();

  void init_memory();
  void destroy_memory();

  void submit_job(const bc_mining_inputs&);
  result_type yield_result(bc_mining_outputs&);
  
 private:
  // note: everything in bc_mining_mempools is a device ptr
  // don't try to access it without copying to host first
  bool cancel, solution_found;
  std::mutex mtx_yield_results;
  std::vector<pthread_t> threads;
  std::vector<bc_thread_data> thread_data;
  std::vector<bc_mining_stream> streams;
  bc_mining_inputs in;
  std::vector<bc_mining_outputs> outs;
};

#endif
