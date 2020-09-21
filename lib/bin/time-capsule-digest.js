'use strict';

const fs = require('fs');
const { blake2bl } = require('../utils/crypto');
const TIME_CAPSULE_DATA = require('../bc/timecapsule.raw');

const contentStr = TIME_CAPSULE_DATA.signatures.map(l => String(l.address) + String(l.message) + String(l.signedMessage)).join('');
console.log(blake2bl(contentStr));