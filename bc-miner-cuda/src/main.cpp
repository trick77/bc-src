#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <cstdlib>
#include <time.h>

#include <mutex>

#include <grpcpp/grpcpp.h>
#include <grpc/support/log.h>

#include "miner.grpc.pb.h"

#include "BCGPUMiner.h"

using grpc::Server;
using grpc::ServerAsyncResponseWriter;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerCompletionQueue;
using grpc::Status;

using ::bc::Miner;
using ::bc::MinerResponse;
using ::bc::MinerRequest;

std::mutex gpu_lock;

class ServerImpl final {
 public:
  ~ServerImpl() {
    std::cout << "ServerImpl::~ServerImpl()" << std::endl << std::flush;

    server_->Shutdown();
    // Always shutdown the completion queue after the server.
    cq_->Shutdown();

    thegpuminer_.destroy_memory();
  }

  // There is no shutdown handling in this code.
  void Run() {
    std::string server_address("localhost:50052");

    ServerBuilder builder;

    // Listen on the given address without any authentication mechanism.
    builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());

    // Register "service_" as the instance through which we'll communicate with
    // clients. In this case it corresponds to an *asynchronous* service.
    builder.RegisterService(&service_);

    // Get hold of the completion queue used for the asynchronous communication
    // with the gRPC runtime.
    cq_ = builder.AddCompletionQueue();

    // Finally assemble the server.
    server_ = builder.BuildAndStart();
    std::cout << "Server listening on " << server_address << std::endl;

    thegpuminer_.init_memory();
    
    // Proceed to the server's main loop.
    HandleRpcs();
  }

 private:
  // Class encompasing the state and logic needed to serve a request.
  class CallData {
   public:
    // Take in the "service" instance (in this case representing an asynchronous
    // server) and the completion queue "cq" used for asynchronous communication
    // with the gRPC runtime.
    CallData(BCGPUMiner* theminer, ::bc::Miner::AsyncService* service, ServerCompletionQueue* cq)
      : theminer_(theminer), service_(service), cq_(cq), responder_(&ctx_), status_(CREATE) {

      // Invoke the serving logic right away.
      Proceed();
    }

    void Proceed() {
      std::cout << "Proceed() - " <<  status_ << std::endl << std::flush;

      if (status_ == CREATE) {
        // Make this instance progress to the PROCESS state.
        status_ = PROCESS;

        // As part of the initial CREATE state, we *request* that the system
        // start processing Mine requests. In this request, "this" acts are
        // the tag uniquely identifying the request (so that different CallData
        // instances can serve different requests concurrently), in this case
        // the memory address of this CallData instance.
	
        service_->RequestMine(&ctx_, &request_, &responder_, cq_, cq_, this);
      } else if (status_ == PROCESS) {
        // Spawn a new CallData instance to serve new clients while we process
        // the one for this CallData. The instance will deallocate itself as
        // part of its FINISH state.
        new CallData(theminer_,service_, cq_);
	
	// get all the miner data
	const std::string& miner_key = request_.miner_key();
	const std::string& work = request_.work();
	const std::string& merkel_root = request_.merkle_root();
	const std::string& difficulty = request_.difficulty();
	const uint64_t& timestamp = request_.current_timestamp();

	std::cout << "received: " << std::endl;
	std::cout << "\tminer_key   : " << miner_key << std::endl;
	std::cout << "\twork        : " << work << std::endl;
	std::cout << "\tmerkel_root : " << merkel_root << std::endl;
	std::cout << "\tdifficulty  : " << difficulty << std::endl;
	std::cout << "\ttimestamp   : " << timestamp << std::endl;
	
	bc_mining_inputs in;
	bc_mining_outputs out;
	in.miner_key_size_ = miner_key.length();
	memcpy(in.miner_key_,miner_key.c_str(),in.miner_key_size_);
	// make sure merkel root is ok
	assert(merkel_root.length() == BLAKE2B_OUTBYTES && "Received malformed Merkel root!!!");
	memcpy(in.merkel_root_,merkel_root.c_str(),BLAKE2B_OUTBYTES);
	// prepare the work
	in.work_size_ = work.length();
	memset(in.received_work_,0,BLAKE2B_OUTBYTES);
	assert(BLAKE2B_OUTBYTES == in.work_size_ && "Received malformed work!!!");
	for(unsigned i = 0; i < in.work_size_; ++i ) { // convert it packed form in place
	  char temp[2];
	  temp[0] = work[i];
	  temp[1] = '\0';
	  in.received_work_[i/2] += strtol(temp,NULL,16)<<(4*((i+1)%2));
	}
	// convert timestamp
	std::stringstream tsstr;
	tsstr << timestamp;
	in.time_stamp_size_ = tsstr.str().length();
	memcpy(in.time_stamp_,tsstr.str().c_str(),in.time_stamp_size_);

	//convert the difficulty
	std::cout << " received difficulty: " << difficulty << std::endl;
	in.the_difficulty_ = strtoull(difficulty.c_str(),NULL,10);
	if(in.the_difficulty_ > 350000000000000ULL) {
	  std::cout << " got a bogus difficulty " << in.the_difficulty_ << ", reducing to min!" << std::endl;
	  in.the_difficulty_ = 290112262029012ULL;
	}
	
	struct timespec start, finish;
	
	// the actual processing
	clock_gettime(CLOCK_MONOTONIC, &start);
	std::lock_guard<std::mutex> guard(gpu_lock);
	theminer_->do_mining(in,out);
	clock_gettime(CLOCK_MONOTONIC, &finish);
	
        // send to output
	std::stringstream strnonce, strdistance, strdifficulty;
	strnonce << out.nonce_;
	response_.set_nonce(strnonce.str());
	strdifficulty << out.difficulty_;
	response_.set_difficulty(strdifficulty.str());
	strdistance << out.distance_;
	response_.set_distance(strdistance.str());
	response_.set_timestamp(request_.current_timestamp());
	response_.set_iterations(out.iterations_);
	double tdiff = (double)finish.tv_sec + 1e-9*(double)finish.tv_nsec;
	tdiff = tdiff - ((double)start.tv_sec + 1e-9*(double)start.tv_nsec);
	tdiff *= 1e3;
	std::cout << "mining took: " << tdiff << " ms" << std::endl;
	response_.set_time_diff(uint64_t(tdiff));

	std::stringstream result;
	result << std::hex;
	for( unsigned i = 32; i < BLAKE2B_OUTBYTES; ++i ) {
	  result << (unsigned)(out.result_blake2b_[i]>>4)
		 << (unsigned)(out.result_blake2b_[i]&0xf);
	}
	result << std::dec;
	std::cout << "mining result      : " << std::endl;
	std::cout << "\tresult           : " << result.str() << std::endl;
	std::cout << "\tnonce            : " << out.nonce_ << std::endl;
	std::cout << "\tdifficulty       : " << out.difficulty_ << std::endl;
	std::cout << "\titerations       : " << out.iterations_ << std::endl;
	std::cout << "\tdistance         : " << out.distance_ << std::endl; 
	std::cout << "\titers per second : " << (1e3 * out.iterations_ / tdiff) << std::endl; 
	
	response_.set_result(::bc::MinerResponseResult::Ok);

	// if distance is less than difficulty something bad happened
	if( out.distance_ < out.difficulty_ ) {
	  std::cout << "ERROR --->>> Invalid solution! Distance less than difficulty!" << std::endl;
	  response_.set_result(::bc::MinerResponseResult::Error);
	}        

        std::cout << "Proceed() - processing request" << std::endl << std::flush;

        // And we are done! Let the gRPC runtime know we've finished, using the
        // memory address of this instance as the uniquely identifying tag for
        // the event.
        status_ = FINISH;
        responder_.Finish(response_, Status::OK, this);
      } else {
        GPR_ASSERT(status_ == FINISH);
        // Once in the FINISH state, deallocate ourselves (CallData).
        delete this;
      }
    }

   private:
    //
    BCGPUMiner* theminer_;
    // The means of communication with the gRPC runtime for an asynchronous
    // server.
    ::bc::Miner::AsyncService* service_;
    // The producer-consumer queue where for asynchronous server notifications.

    ServerCompletionQueue* cq_;
    // Context for the rpc, allowing to tweak aspects of it such as the use
    // of compression, authentication, as well as to send metadata back to the
    // client.
    ServerContext ctx_;

    // What we get from the client.
    MinerRequest request_;
    // What we send back to the client.
    MinerResponse response_;

    // The means to get back to the client.
    ServerAsyncResponseWriter<MinerResponse> responder_;

    // Let's implement a tiny state machine with the following states.
    enum CallStatus {
        CREATE,
        PROCESS,
        FINISH
    };

    CallStatus status_;  // The current serving state.
  };

  // This can be run in multiple threads if needed.
  void HandleRpcs() {
    std::cout << "HandleRpcs() - started!" << std::endl << std::flush;
    // Spawn a new CallData instance to serve new clients.
    new CallData(&thegpuminer_,&service_, cq_.get());
    void* tag;  // uniquely identifies a request.
    bool ok;

    while (true) {
      // Block waiting to read the next event from the completion queue. The
      // event is uniquely identified by its tag, which in this case is the
      // memory address of a CallData instance.
      // The return value of Next should always be checked. This return value
      // tells us whether there is any kind of event or cq_ is shutting down.

      GPR_ASSERT(cq_->Next(&tag, &ok));
      GPR_ASSERT(ok);

      CallData* call = static_cast<CallData*>(tag);
      call->Proceed();
    }

    std::cout << "HandleRpcs() - finished!" << std::endl << std::flush;
  }

  std::unique_ptr<ServerCompletionQueue> cq_;
  ::bc::Miner::AsyncService service_;
  std::unique_ptr<Server> server_;
  // this handles the GPU(s)                                                                                       
  BCGPUMiner thegpuminer_;
};

int main(int argc, char** argv) {
  ServerImpl server;
  server.Run();

  return EXIT_SUCCESS;
}
