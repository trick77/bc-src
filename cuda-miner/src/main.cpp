#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <cstdlib>
#include <time.h>
#include <signal.h>
#include <stdlib.h>

#include <mutex>

#include <grpcpp/grpcpp.h>
#include <grpc/support/log.h>

#include "miner.grpc.pb.h"

#include "BCGPUMiner.h"

#include "CallData.h"

using grpc::Server;
using grpc::ServerAsyncResponseWriter;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerCompletionQueue;
using grpc::Status;

using ::bc::Miner;
using ::bc::MinerResponse;
using ::bc::MinerRequest;

std::mutex rpc_lock;

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
    std::string server_address("0.0.0.0:50052");

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
    auto handler = [this](int i){ this->HandleRpcs(i); };
    std::thread one(handler, 1), two(handler, 2);

    one.join();
    two.join();
  }

 private:

  // This can be run in multiple threads if needed.
  void HandleRpcs(int thread) {
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

      std::cout << "thread: " << thread << " waiting for new rpc!" << std::endl;
      GPR_ASSERT(cq_->Next(&tag, &ok));
      //GPR_ASSERT(ok);
      
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

void sig_hndl(int signo) {
  if (signo == SIGINT) {
    std::cout << "Caught SIGINT, exiting!" << std::endl;
    exit(0);
  } else if (signo == SIGKILL) {
    std::cout << "Caught SIGKILL, exiting!" << std::endl;
    exit(0);
  }
}

int main(int argc, char** argv) {

  if (signal(SIGINT, sig_hndl) == SIG_ERR) {
    std::cout << "Not handling SIGINT!" << std::endl;
  }
  if (signal(SIGKILL, sig_hndl) == SIG_ERR) {
    std::cout << "Not handling SIGKILL!" << std::endl;
  }
  
  ServerImpl server;
  server.Run();

  return EXIT_SUCCESS;
}
