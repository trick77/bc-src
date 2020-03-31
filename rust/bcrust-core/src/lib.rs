#![feature(rustc_private)]
#![feature(test)]
extern crate blake2_rfc;
extern crate grpc;
extern crate num_traits;
extern crate test;
extern crate tls_api;

extern crate crypto;
#[macro_use]
extern crate log;
extern crate num_bigint;
extern crate num_cpus;
extern crate protobuf;
extern crate rand;
extern crate rustc_serialize;
extern crate strsim;

pub mod data;
pub mod funcs;
pub mod miner;
pub mod mining;
pub mod protos;
