#ifndef __BCGPUMiner_h__
#define __BCGPUMiner_h__

#include "bc_miner.h"

class BCGPUMiner {
 public:
  BCGPUMiner();
  ~BCGPUMiner();

  void init_memory();
  void destroy_memory();
  
  void do_mining(const bc_mining_inputs&, bc_mining_outputs&);
  
 private:
  // note: everything in bc_mining_mempools is a device ptr
  // don't try to access it without copying to host first
  std::vector<bc_mining_stream> streams;
};

#endif
