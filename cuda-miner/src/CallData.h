#ifndef __BC_CALLDATA_H__
#define __BC_CALLDATA_H__

#include <grpcpp/grpcpp.h>
#include <grpc/support/log.h>

#include "miner.grpc.pb.h"

#include <time.h>
#include <mutex>

using grpc::Server;
using grpc::ServerAsyncResponseWriter;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerCompletionQueue;
using grpc::Status;

using ::bc::Miner;
using ::bc::MinerResponse;
using ::bc::MinerRequest;

class BCGPUMiner;

class CallData {
 public:
  // Take in the "service" instance (in this case representing an asynchronous
  // server) and the completion queue "cq" used for asynchronous communication
  // with the gRPC runtime.
  CallData(BCGPUMiner* theminer, ::bc::Miner::AsyncService* service, ServerCompletionQueue* cq);
  
  void Proceed();
  
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
  // information about how long we mined for
  struct timespec start, finish;
  
  // The means to get back to the client.
  ServerAsyncResponseWriter<MinerResponse> responder_;
  
  // Let's implement a tiny state machine with the following states.
  enum CallStatus {
    CREATE,
    PROCESS,
    FINISH
  };

  std::mutex mtx_status_;
  CallStatus status_;  // The current serving state.
};

#endif
