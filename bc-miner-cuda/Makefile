#
# Copyright 2015 gRPC authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

HOST_SYSTEM = $(shell uname | cut -f 1 -d_)
SYSTEM ?= $(HOST_SYSTEM)
CXX = g++
NVCC = nvcc
CPPFLAGS += `pkg-config --cflags protobuf`
CXXFLAGS += -std=c++11
CPPFLAGS += -I$(HOME)/grpc/include -I/usr/local/cuda/include
ifeq ($(SYSTEM),Darwin)
LDFLAGS += -L/usr/local/lib `pkg-config --libs protobuf`\
           -L/usr/local/cuda/lib64\
           -L/usr/local/cuda/lib64/stubs\
           -L$(HOME)/grpc/build\
           -L$(HOME)/grpc/build/third_party/cares/cares/lib\
           -L$(HOME)/grpc/build/third_party/boringssl/ssl\
           -L$(HOME)/grpc/build/third_party/boringssl/crypto\
           -L$(HOME)/grpc/build/third_party/zlib\
           -lgrpc++_reflection -lgrpc++_unsecure -lgrpc -lgrpc++\
	   -lgrpc_cronet -lgrpc_plugin_support -lgrpcpp_channelz -lcares -lssl -lcrypto -laddress_sorting\
	   -lgpr -lz \
           -ldl
else
LDFLAGS += -L/usr/local/lib `pkg-config --libs protobuf`\
           -L$(HOME)/grpc/build\
           -L/usr/local/cuda/lib64\
           -L/usr/local/cuda/lib64/stubs\
           -L$(HOME)/grpc/build/third_party/cares/cares/lib\
           -L$(HOME)/grpc/build/third_party/boringssl/ssl\
           -L$(HOME)/grpc/build/third_party/boringssl/crypto\
	   -L$(HOME)/grpc/build/third_party/zlib\
           -Wl,--no-as-needed -lgrpc++_reflection -lgrpc++_unsecure -lgrpc -lgrpc++ -lgrpc_cronet -lgrpc_plugin_support -lgrpcpp_channelz -lcares -lssl -lcrypto -lz -laddress_sorting -lgpr -lcuda -lcudart -Wl,--as-needed\
           -ldl
endif
PROTOC = protoc
GRPC_CPP_PLUGIN = grpc_cpp_plugin
GRPC_CPP_PLUGIN_PATH ?= `which $(GRPC_CPP_PLUGIN)`

PROTOS_PATH = ../../protos

vpath %.proto $(PROTOS_PATH)

all: system-check miner

test: bcminer.o main.cu
	$(NVCC) $^ -o $@
miner: bc_miner.o BCGPUMiner.o core.pb.o miner.pb.o miner.grpc.pb.o main.o
	$(CXX) $^ $(LDFLAGS) -o $@

bc_miner.o: bc_miner.cu 
	$(NVCC) $^ -c $@

%.grpc.pb.cc: %.proto
	$(PROTOC) -I $(PROTOS_PATH) --grpc_out=. --plugin=protoc-gen-grpc=$(GRPC_CPP_PLUGIN_PATH) $<

%.pb.cc: %.proto
	$(PROTOC) -I $(PROTOS_PATH) --cpp_out=. $<

generate: ../protos/miner.proto
	$(PROTOC) -I $(PROTOS_PATH) --grpc_out=. --plugin=protoc-gen-grpc=$(GRPC_CPP_PLUGIN_PATH) --cpp_out=. $<
clean:
	rm -f *.o *.pb.cc *.pb.h miner test


# The following is to test your system and ensure a smoother experience.
# They are by no means necessary to actually compile a grpc-enabled software.

PROTOC_CMD = which $(PROTOC)
PROTOC_CHECK_CMD = $(PROTOC) --version | grep -q libprotoc.3
PLUGIN_CHECK_CMD = which $(GRPC_CPP_PLUGIN)
HAS_PROTOC = $(shell $(PROTOC_CMD) > /dev/null && echo true || echo false)
ifeq ($(HAS_PROTOC),true)
HAS_VALID_PROTOC = $(shell $(PROTOC_CHECK_CMD) 2> /dev/null && echo true || echo false)
endif
HAS_PLUGIN = $(shell $(PLUGIN_CHECK_CMD) > /dev/null && echo true || echo false)

SYSTEM_OK = false
ifeq ($(HAS_VALID_PROTOC),true)
ifeq ($(HAS_PLUGIN),true)
SYSTEM_OK = true
endif
endif

system-check:
ifneq ($(HAS_VALID_PROTOC),true)
	@echo " DEPENDENCY ERROR"
	@echo
	@echo "You don't have protoc 3.0.0 installed in your path."
	@echo "Please install Google protocol buffers 3.0.0 and its compiler."
	@echo "You can find it here:"
	@echo
	@echo "   https://github.com/google/protobuf/releases/tag/v3.0.0"
	@echo
	@echo "Here is what I get when trying to evaluate your version of protoc:"
	@echo
	-$(PROTOC) --version
	@echo
	@echo
endif
ifneq ($(HAS_PLUGIN),true)
	@echo " DEPENDENCY ERROR"
	@echo
	@echo "You don't have the grpc c++ protobuf plugin installed in your path."
	@echo "Please install grpc. You can find it here:"
	@echo
	@echo "   https://github.com/grpc/grpc"
	@echo
	@echo "Here is what I get when trying to detect if you have the plugin:"
	@echo
	-which $(GRPC_CPP_PLUGIN)
	@echo
	@echo
endif
ifneq ($(SYSTEM_OK),true)
	@false
endif

