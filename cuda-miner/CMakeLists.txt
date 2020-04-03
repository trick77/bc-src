cmake_minimum_required(VERSION 3.1)

project(bc-miner-cuda CXX)

if(NOT MSVC)
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++11")
else()
  add_definitions(-D_WIN32_WINNT=0x600)
endif()

# Protobuf
set(protobuf_MODULE_COMPATIBLE TRUE)
find_package(protobuf CONFIG REQUIRED)
message(STATUS "Using protobuf ${protobuf_VERSION}")

# gRPC
#find_package(gRPC CONFIG REQUIRED)
#add_subdirectory("/home/lgray/grpc" "${CMAKE_CURRENT_BINARY_DIR}/grpc")
message(STATUS "Using gRPC ${gRPC_VERSION}")

# gRPC C++ plugin
set(gRPC_CPP_PLUGIN_EXECUTABLE "/home/lgray/grpc/build/grpc_cpp_plugin")
set(_GRPC_GRPCPP_UNSECURE "/home/lgray/grpc/build/libgrpc++_unsecure.a")

include_directories(${protobuf_INCLUDE_DIRS})
include_directories("/home/lgray/grpc/include/")
include_directories(${CMAKE_CURRENT_BINARY_DIR})

file(COPY ${CMAKE_CURRENT_SOURCE_DIR}/../../protos DESTINATION ${PROJECT_SOURCE_DIR})

set(PROTOS
    ${CMAKE_CURRENT_SOURCE_DIR}/protos/core.proto
    ${CMAKE_CURRENT_SOURCE_DIR}/protos/miner.proto
)

set(SRCS
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp
)

protobuf_generate_cpp(PROTO_SRCS PROTO_HDRS ${PROTOS})

set(GRPC_SRCS "${CMAKE_CURRENT_SOURCE_DIR}/src/miner.grpc.pb.cc")
set(GRPC_HDRS "${CMAKE_CURRENT_SOURCE_DIR}/src/miner.grpc.pb.h")

add_custom_command(
    COMMAND "${protobuf_PROTOC_EXECUTABLE}"
    # COMMAND "/usr/local/bin/protoc"
    ARGS --grpc_out="${CMAKE_CURRENT_SOURCE_DIR}/src" -I "${CMAKE_CURRENT_SOURCE_DIR}/protos" --plugin=protoc-gen-grpc="${gRPC_CPP_PLUGIN_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/protos/miner.proto"
    DEPENDS "${PROTOS}"
    OUTPUT "${GRPC_SRCS}" "${GRPC_HDRS}"
)

add_executable(bc-miner-cuda ${PROTO_HDRS} ${PROTO_SRCS} ${GRPC_HDRS} ${GRPC_SRCS} ${SRCS})

target_link_libraries(bc-miner-cuda ${PROTOBUF_LIBRARIES} ${_GRPC_GRPCPP_UNSECURE})
