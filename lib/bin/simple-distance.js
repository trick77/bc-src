'use strict';

const fs = require('fs');
const { overlineDistance } = require('../mining/primitives');
const { blake2bl } = require('../utils/crypto');

let STATIC_STRING = "";
let INPUT_STRING = "";

if (process.argv.length === 4) {
  STATIC_STRING = process.argv[2];
  INPUT_STRING = process.argv[3];
}

console.log(`STATIC_STRING: ${STATIC_STRING}`);
console.log(`INPUT_STRING: ${INPUT_STRING}`);

const inputHash = blake2bl(INPUT_STRING);
let staticHash = STATIC_STRING;

console.log(`converted -> INPUT_STRING Hash: ${inputHash}`);

if (inputHash.length !== STATIC_STRING.length) {
  staticHash = blake2bl(staticHash);
  console.log(`converted -> STATIC_STRING Hash: ${staticHash}`);
}

console.log(`distance: ${overlineDistance(staticHash, inputHash)}`);