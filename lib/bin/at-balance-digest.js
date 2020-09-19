'use strict';

const fs = require('fs');
const { blake2b } = require('../utils/crypto');

const content = fs.readFileSync(`${__dirname}/../bc/at_genesis_balances.csv`, 'utf8');
const contentStr = content.split('\n').map(l => l.trim()).join('');
console.log(blake2b(contentStr));