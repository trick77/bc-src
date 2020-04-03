#include "blake2.h"
#include "bc_miner.h"

#include <string>
#include <vector>
#include <algorithm>
#include <ctime>
#include <pthread.h>
#include <assert.h>
#include <chrono>
#include <random>

#include <iostream>

/*
INFO	 mining.thread worker 4517 reporting in 
INFO	 mining.primitives twork: 7296c034e95304ee2a69c2a61e6287a0 58448d08d723222d19658c0364dd247c 64
                                  58448d08d723222d19658c0364dd247c
INFO	 mining.primitives miner: 0xf34fa87db39d15471bebe997860dcd49fc259318 42 
INFO	 mining.primitives merkl: 108459d41ce2399e13992528ea1bd9940fac9df181e29c2b61caeaad55f6532a 64 
INFO	 mining.primitives nhash: 1af153f4cf971b61cc867b760bebfbc98a8c216cd69d6bb5dbb63aaed9db1fc3 64 
INFO	 mining.primitives times: 1536810114 10 
INFO	 mining.primitives cocat: 0xf34fa87db39d15471bebe997860dcd49fc259318108459d41ce2399e13992528ea1bd9940fac9df181e29c2b61caeaad55f6532a1af153f4cf971b61cc867b760bebfbc98a8c216cd69d6bb5dbb63aaed9db1fc31536810114 180 
INFO	 mining.primitives solun: 2b08d9146a6ce1f02db88203bdc653cd0b5e33ec945f391f82dbe3d417fb586e 64 
INFO	 mining.primitives wrkck: 53,56,52,52,56,100,48,56,100,55,50,51,50,50,50,100,49,57,54,53,56,99,48,51,54,52,100,100,50,52,55,99, 55,50,57,54,99,48,51,52,101,57,53,51,48,52,101,101,50,97,54,57,99,50,97,54,49,101,54,50,56,55,97,48 2 
INFO	 mining.primitives compr: 2b08d9146a6ce1f02db88203bdc653cd0b5e33ec945f391f82dbe3d417fb586e 64 
INFO	 mining.primitives testr: 204933315567342 undefined
*/

uint64_t mypow(uint64_t base, uint64_t exp) {
  int result = 1;
  while( exp-- ) { result *= base; }
  return result;
}

struct sort_by_distance {
  const size_t* distances;
  bool operator()(size_t i1,size_t i2) const {
    //std::cout << i1 << ' ' << distances[i1] << " >?= " << i2 << ' ' << distances[i2] << std::endl;
    return distances[i1] >= distances[i2]; 
  }
};

int main(int argc, char **argv) {
    
    std::string work ("7ca44f0c6f416240157a7d9067802269a64ab5503bd11970e3130d36e75ab815");
    std::string mhash("0xc95d2b8fe219f528d10cc35d0df78da90a32a8a9");
              //mhash("0xbfcf55b8fcb3d1937a1c6d02ff6d17089651882c");
	      //mhash("0xf34fa87db39d15471bebe997860dcd49fc259318");
    std::string merkl("d1dde6972fa183f1b9ca2c0ee2d6d87656be16db28c7d6cc3c5086eb7fda8fe5");
    uint64_t thenonce = std::numeric_limits<uint64_t>::max();
    uint8_t nonce_string[22]; // ten digits and a null character max;
    memset(nonce_string,0,22);
    // convert nonce
    static uint16_t num_to_code[16] = {48,49,50,51,52,53,54,55,56,57};
    nonce_string[0] = '0'; // take care of base case
    int length = 0;
    uint64_t red_nonce = thenonce;
    while( red_nonce > 0 ) { ++length; red_nonce /= 10ULL; }
    red_nonce = thenonce;
    std::cout << "the length: " << length << std::endl;
    for( uint64_t i = length; i > 1; --i ) {
      nonce_string[i-1] = num_to_code[red_nonce%10];
      red_nonce /= 10ULL;
    }
    nonce_string[0] = num_to_code[red_nonce];
    std::cout << thenonce << ' ' << nonce_string << ' ' << red_nonce << std::endl;    
    std::string nhash("cb5d17fe5c27f7b7426002eb665142d00190553b9d945a936eed3ffd23cdde71");
    std::string times("1585772256");

    std::string the_thing = mhash + merkl + nhash + times;

    std::string result_bc("c0d42acc9793a81096411b74b78fe9a12645737c57ee1544fb35d5fa6f09503e");
        
    // now let's do it on the GPU for real
    size_t stash_size = mhash.length();
    size_t tstamp_size = times.length();
        
    std::vector<bc_mining_stream> streams;    

    unsigned seed = std::chrono::system_clock::now().time_since_epoch().count();

    std::mt19937 generator(seed);

    init_gpus(streams);

    std::vector<pthread_t> threads(streams.size());
    std::vector<bc_thread_data> thread_data(streams.size());

    bc_mining_inputs* in; 
    cudaMallocHost(&in,streams.size()*sizeof(bc_mining_inputs));
    bc_mining_outputs* out;
    cudaMallocHost(&out,streams.size()*sizeof(bc_mining_outputs));

    uint64_t start_nonce = generator();
    bool solution_found = false;
    for(unsigned iGPU = 0; iGPU < streams.size(); ++iGPU ) {
      in[iGPU].miner_key_size_ = mhash.length();
      in[iGPU].time_stamp_size_ = times.length();
      in[iGPU].work_size_ = work.length();    
      in[iGPU].the_difficulty_ = 315874869807223ULL;
      
      memcpy(in[iGPU].miner_key_,mhash.c_str(),in[iGPU].miner_key_size_);
      memcpy(in[iGPU].merkel_root_,merkl.c_str(),BLAKE2B_OUTBYTES);
      memcpy(in[iGPU].time_stamp_,times.c_str(),in[iGPU].time_stamp_size_);
      //set the work
      for(unsigned i = 0; i < in[iGPU].work_size_; ++i ) {
	char temp[2];
	temp[0] = work[i];
	temp[1] = '\0';
	in[iGPU].received_work_[i/2] += strtol(temp,NULL,16)<<(4*((i+1)%2));
      }

      thread_data[iGPU].in = in + iGPU;
      thread_data[iGPU].out = out + iGPU;
      thread_data[iGPU].stream = &streams[iGPU];
      thread_data[iGPU].start_nonce = std::numeric_limits<uint64_t>::max() - iGPU*100*HASH_TRIES; //start_nonce + 100*HASH_TRIES*iGPU + generator();
      thread_data[iGPU].solution_found = &solution_found;
      std::cout<< iGPU << ' ' << thread_data[iGPU].start_nonce << std::endl;
    }

    int result_code;
    for( unsigned iGPU = 0; iGPU < streams.size(); ++iGPU ) {      
      result_code = pthread_create(&threads[iGPU], NULL, run_miner_thread, &thread_data[iGPU]);
      assert(!result_code);
    }
    
    
    for ( unsigned iGPU = 0; iGPU < streams.size(); ++iGPU) {
      // block until thread 'index' completes
      result_code = pthread_join(threads[iGPU], NULL);
      assert(!result_code);
      std::cout << "In main: thread " << iGPU <<" has completed" << std::endl;
    }

    for( unsigned iGPU = 0; iGPU < streams.size(); ++iGPU ) {
      std::cout << "gpu: " << streams[iGPU].device << " trial = 0x" << std::hex;
      // output "blake2bl"
      for( unsigned i = 32; i < BLAKE2B_OUTBYTES; ++i ) {
	std::cout << std::hex << (unsigned)(out[iGPU].result_blake2b_[i]>>4) << (unsigned)(out[iGPU].result_blake2b_[i]&0xf);
      }
      std::cout << std::dec << std::endl;
      std::cout << "gpu distance is: " << out[iGPU].distance_ << std::endl;
      std::cout << "gpu nonce is   : " << out[iGPU].nonce_ << std::endl;
      std::cout << "gpu iterations : " << out[iGPU].iterations_ << std::endl;
    }

    destroy_gpus(streams);
    
    cudaFreeHost(in);
    cudaFreeHost(out);
    
    return 0;
}
