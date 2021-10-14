#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <cstdlib>
#include <signal.h>
#include <stdlib.h>

#include <mutex>

#include "BCGPUMiner.h"

#include "CallData.h"

using grpc::Server;
using grpc::ServerAsyncResponseWriter;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerCompletionQueue;
using grpc::Status;

using ::bc::miner::Miner;
using ::bc::miner::MinerResponse;
using ::bc::miner::MinerRequest;

CallData::CallData(BCGPUMiner* theminer, ::bc::miner::Miner::AsyncService* service, ServerCompletionQueue* cq)
  : theminer_(theminer), service_(service), cq_(cq), responder_(&ctx_), status_(CREATE) {

  // Invoke the serving logic right away.
  Proceed();
}

void CallData::Proceed() {
  std::lock_guard<std::mutex> lock(mtx_status_);
  std::cout << this << " Proceed() - " <<  status_ << std::endl << std::flush;

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
    new CallData(theminer_, service_, cq_);

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

    // start processing this mining request
    bc_mining_outputs out;

    clock_gettime(CLOCK_MONOTONIC, &start);
    theminer_->submit_job(in);

    BCGPUMiner::result_type mining_outcome = theminer_->yield_result(out);
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
    std::cout << "mining result      : " << std::endl
	      << "\tresult           : " << result.str() << std::endl
	      << "\tnonce            : " << out.nonce_ << std::endl
	      << "\tdifficulty       : " << out.difficulty_ << std::endl
	      << "\titerations       : " << out.iterations_ << std::endl
	      << "\tdistance         : " << out.distance_ << std::endl
	      << "\titers per second : " << (1e3 * out.iterations_ / tdiff) << std::endl;



    switch( mining_outcome ) {
    case BCGPUMiner::SUCCESS:
      response_.set_result(::bc::miner::MinerResponseResult::Ok);
      break;
    case BCGPUMiner::CANCELED:
      response_.set_result(::bc::miner::MinerResponseResult::Canceled);
      break;
    default:
      assert(0 && "unknown miner response!");
    }

    if( mining_outcome == BCGPUMiner::SUCCESS && out.distance_ < out.difficulty_ ) {
      response_.set_result(::bc::miner::MinerResponseResult::Error);
    }

    std::cout << "Proceed() - yielding result " << response_.result() << std::endl << std::flush;

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
