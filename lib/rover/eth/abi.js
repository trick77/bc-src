"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
const ERC721 = exports.ERC721 = [{
  "inputs": [{
    "internalType": "string",
    "name": "name_",
    "type": "string"
  }, {
    "internalType": "string",
    "name": "symbol_",
    "type": "string"
  }],
  "stateMutability": "nonpayable",
  "type": "constructor"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "owner",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "address",
    "name": "approved",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }],
  "name": "Approval",
  "type": "event"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "owner",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "address",
    "name": "operator",
    "type": "address"
  }, {
    "indexed": false,
    "internalType": "bool",
    "name": "approved",
    "type": "bool"
  }],
  "name": "ApprovalForAll",
  "type": "event"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "from",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }],
  "name": "Transfer",
  "type": "event"
}, {
  "inputs": [{
    "internalType": "bytes4",
    "name": "interfaceId",
    "type": "bytes4"
  }],
  "name": "supportsInterface",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "owner",
    "type": "address"
  }],
  "name": "balanceOf",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }],
  "name": "ownerOf",
  "outputs": [{
    "internalType": "address",
    "name": "",
    "type": "address"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [],
  "name": "name",
  "outputs": [{
    "internalType": "string",
    "name": "",
    "type": "string"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [],
  "name": "symbol",
  "outputs": [{
    "internalType": "string",
    "name": "",
    "type": "string"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }],
  "name": "tokenURI",
  "outputs": [{
    "internalType": "string",
    "name": "",
    "type": "string"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [],
  "name": "baseURI",
  "outputs": [{
    "internalType": "string",
    "name": "",
    "type": "string"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "owner",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "index",
    "type": "uint256"
  }],
  "name": "tokenOfOwnerByIndex",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [],
  "name": "totalSupply",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "uint256",
    "name": "index",
    "type": "uint256"
  }],
  "name": "tokenByIndex",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "to",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }],
  "name": "approve",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }],
  "name": "getApproved",
  "outputs": [{
    "internalType": "address",
    "name": "",
    "type": "address"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "operator",
    "type": "address"
  }, {
    "internalType": "bool",
    "name": "approved",
    "type": "bool"
  }],
  "name": "setApprovalForAll",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "owner",
    "type": "address"
  }, {
    "internalType": "address",
    "name": "operator",
    "type": "address"
  }],
  "name": "isApprovedForAll",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "view",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "from",
    "type": "address"
  }, {
    "internalType": "address",
    "name": "to",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }],
  "name": "transferFrom",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "from",
    "type": "address"
  }, {
    "internalType": "address",
    "name": "to",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }],
  "name": "safeTransferFrom",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "from",
    "type": "address"
  }, {
    "internalType": "address",
    "name": "to",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "tokenId",
    "type": "uint256"
  }, {
    "internalType": "bytes",
    "name": "_data",
    "type": "bytes"
  }],
  "name": "safeTransferFrom",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}];

const ERC20 = exports.ERC20 = [{
  'constant': true,
  'inputs': [],
  'name': 'name',
  'outputs': [{
    'name': '',
    'type': 'string'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'symbol',
  'outputs': [{
    'name': '',
    'type': 'string'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'decimals',
  'outputs': [{
    'name': '',
    'type': 'uint8'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'totalSupply',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_owner',
    'type': 'address'
  }],
  'name': 'balanceOf',
  'outputs': [{
    'name': 'balance',
    'type': 'uint256'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': false,
  "inputs": [{
    "internalType": "bytes27[]",
    "name": "_addressesAndAmounts",
    "type": "bytes27[]"
  }],
  "name": "multiTransfer",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  'payable': false,
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_to',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'transfer',
  'outputs': [{
    'name': 'success',
    'type': 'bool'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_from',
    'type': 'address'
  }, {
    'name': '_to',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'transferFrom',
  'outputs': [{
    'name': 'success',
    'type': 'bool'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'approve',
  'outputs': [{
    'name': 'success',
    'type': 'bool'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_owner',
    'type': 'address'
  }, {
    'name': '_spender',
    'type': 'address'
  }],
  'name': 'allowance',
  'outputs': [{
    'name': 'remaining',
    'type': 'uint256'
  }],
  'payable': false,
  'type': 'function'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': '_from',
    'type': 'address'
  }, {
    'indexed': true,
    'name': '_to',
    'type': 'address'
  }, {
    'indexed': false,
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'Transfer',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': '_owner',
    'type': 'address'
  }, {
    'indexed': true,
    'name': '_spender',
    'type': 'address'
  }, {
    'indexed': false,
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'Approval',
  'type': 'event'
}, {
  'inputs': [{
    'name': '_initialAmount',
    'type': 'uint256'
  }, {
    'name': '_tokenName',
    'type': 'string'
  }, {
    'name': '_decimalUnits',
    'type': 'uint8'
  }, {
    'name': '_tokenSymbol',
    'type': 'string'
  }],
  'payable': false,
  'type': 'constructor'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }, {
    'name': '_extraData',
    'type': 'bytes'
  }],
  'name': 'approveAndCall',
  'outputs': [{
    'name': 'success',
    'type': 'bool'
  }],
  'payable': false,
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'version',
  'outputs': [{
    'name': '',
    'type': 'string'
  }],
  'payable': false,
  'type': 'function'
}];

const EMBLEM_ABI = exports.EMBLEM_ABI = [{
  "inputs": [{
    "internalType": "string",
    "name": "_name",
    "type": "string"
  }, {
    "internalType": "string",
    "name": "_ticker",
    "type": "string"
  }, {
    "internalType": "uint8",
    "name": "_decimal",
    "type": "uint8"
  }, {
    "internalType": "uint256",
    "name": "_supply",
    "type": "uint256"
  }, {
    "internalType": "address",
    "name": "_wallet",
    "type": "address"
  }],
  "stateMutability": "nonpayable",
  "type": "constructor"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "owner",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "address",
    "name": "spender",
    "type": "address"
  }, {
    "indexed": false,
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
  }],
  "name": "Approval",
  "type": "event"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "from",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
  }, {
    "indexed": false,
    "internalType": "bytes12",
    "name": "vanity",
    "type": "bytes12"
  }],
  "name": "ApprovedVanity",
  "type": "event"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "previousOwner",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "address",
    "name": "newOwner",
    "type": "address"
  }],
  "name": "OwnershipTransferred",
  "type": "event"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "from",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
  }, {
    "indexed": false,
    "internalType": "uint256",
    "name": "value",
    "type": "uint256"
  }],
  "name": "Transfer",
  "type": "event"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "from",
    "type": "address"
  }, {
    "indexed": true,
    "internalType": "address",
    "name": "to",
    "type": "address"
  }, {
    "indexed": false,
    "internalType": "bytes12",
    "name": "vanity",
    "type": "bytes12"
  }],
  "name": "TransferVanity",
  "type": "event"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": false,
    "internalType": "uint256",
    "name": "cost",
    "type": "uint256"
  }],
  "name": "VanityPurchaseCost",
  "type": "event"
}, {
  "anonymous": false,
  "inputs": [{
    "indexed": true,
    "internalType": "address",
    "name": "from",
    "type": "address"
  }, {
    "indexed": false,
    "internalType": "bytes12",
    "name": "vanity",
    "type": "bytes12"
  }],
  "name": "VanityPurchased",
  "type": "event"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "owner",
    "type": "address"
  }, {
    "internalType": "address",
    "name": "spender",
    "type": "address"
  }],
  "name": "allowance",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "address",
    "name": "account",
    "type": "address"
  }],
  "name": "balanceOf",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [],
  "name": "cap",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [],
  "name": "decimals",
  "outputs": [{
    "internalType": "uint8",
    "name": "",
    "type": "uint8"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "address",
    "name": "spender",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "addedValue",
    "type": "uint256"
  }],
  "name": "increaseAllowance",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [],
  "name": "name",
  "outputs": [{
    "internalType": "string",
    "name": "",
    "type": "string"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "address",
    "name": "",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "name": "ownedVanities",
  "outputs": [{
    "internalType": "bytes12",
    "name": "",
    "type": "bytes12"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "address",
    "name": "",
    "type": "address"
  }, {
    "internalType": "bytes12",
    "name": "",
    "type": "bytes12"
  }],
  "name": "ownedVanitiesIndex",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [],
  "name": "owner",
  "outputs": [{
    "internalType": "address",
    "name": "",
    "type": "address"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [],
  "name": "renounceOwnership",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [],
  "name": "symbol",
  "outputs": [{
    "internalType": "string",
    "name": "",
    "type": "string"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [],
  "name": "totalSupply",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "address",
    "name": "newOwner",
    "type": "address"
  }],
  "name": "transferOwnership",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "bytes12",
    "name": "",
    "type": "bytes12"
  }],
  "name": "vanityAddresses",
  "outputs": [{
    "internalType": "address",
    "name": "",
    "type": "address"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_leaseExchange",
    "type": "address"
  }],
  "name": "setLeaseExchange",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "uint256",
    "name": "cost",
    "type": "uint256"
  }],
  "name": "setVanityPurchaseCost",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [],
  "name": "getVanityPurchaseCost",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "bool",
    "name": "enabled",
    "type": "bool"
  }],
  "name": "enableFees",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_address",
    "type": "address"
  }],
  "name": "setVanityPurchaseReceiver",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_lemb",
    "type": "address"
  }],
  "name": "setLEMB",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "bytes12",
    "name": "vanity",
    "type": "bytes12"
  }, {
    "internalType": "uint256",
    "name": "fee",
    "type": "uint256"
  }],
  "name": "setVanityFee",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "bytes12",
    "name": "vanity",
    "type": "bytes12"
  }],
  "name": "getFee",
  "outputs": [{
    "internalType": "uint256",
    "name": "",
    "type": "uint256"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [],
  "name": "enabledVanityFee",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_owner",
    "type": "address"
  }, {
    "internalType": "bytes12",
    "name": "_vanity",
    "type": "bytes12"
  }, {
    "internalType": "address",
    "name": "_spender",
    "type": "address"
  }],
  "name": "vanityAllowance",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "bytes12",
    "name": "_vanity",
    "type": "bytes12"
  }],
  "name": "getVanityOwner",
  "outputs": [{
    "internalType": "address",
    "name": "",
    "type": "address"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [],
  "name": "getAllVanities",
  "outputs": [{
    "internalType": "bytes12[]",
    "name": "",
    "type": "bytes12[]"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [],
  "name": "getMyVanities",
  "outputs": [{
    "internalType": "bytes12[]",
    "name": "",
    "type": "bytes12[]"
  }],
  "stateMutability": "view",
  "type": "function",
  "constant": true
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_spender",
    "type": "address"
  }, {
    "internalType": "bytes12",
    "name": "_vanity",
    "type": "bytes12"
  }],
  "name": "approveVanity",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "bytes12",
    "name": "_vanity",
    "type": "bytes12"
  }],
  "name": "clearVanityApproval",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "bytes12",
    "name": "van",
    "type": "bytes12"
  }, {
    "internalType": "address",
    "name": "newOwner",
    "type": "address"
  }],
  "name": "transferVanity",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_from",
    "type": "address"
  }, {
    "internalType": "address",
    "name": "_to",
    "type": "address"
  }, {
    "internalType": "bytes12",
    "name": "_vanity",
    "type": "bytes12"
  }],
  "name": "transferVanityFrom",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "bytes12",
    "name": "van",
    "type": "bytes12"
  }],
  "name": "purchaseVanity",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_to",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "_value",
    "type": "uint256"
  }],
  "name": "transfer",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "bytes27[]",
    "name": "_addressesAndAmounts",
    "type": "bytes27[]"
  }],
  "name": "multiTransfer",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_from",
    "type": "address"
  }, {
    "internalType": "address",
    "name": "_to",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "_value",
    "type": "uint256"
  }],
  "name": "releaseEMB",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_from",
    "type": "address"
  }, {
    "internalType": "address",
    "name": "_to",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "_value",
    "type": "uint256"
  }],
  "name": "transferFrom",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_spender",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "_subtractedValue",
    "type": "uint256"
  }],
  "name": "decreaseAllowance",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}, {
  "inputs": [{
    "internalType": "address",
    "name": "_spender",
    "type": "address"
  }, {
    "internalType": "uint256",
    "name": "_value",
    "type": "uint256"
  }],
  "name": "approve",
  "outputs": [{
    "internalType": "bool",
    "name": "",
    "type": "bool"
  }],
  "stateMutability": "nonpayable",
  "type": "function"
}];

const EMBLEM_TESTNET = exports.EMBLEM_TESTNET = [{
  'constant': true,
  'inputs': [],
  'name': 'name',
  'outputs': [{
    'name': '',
    'type': 'string'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'totalSupply',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'address'
  }, {
    'name': '',
    'type': 'uint256'
  }],
  'name': 'ownedVanities',
  'outputs': [{
    'name': '',
    'type': 'bytes12'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'decimals',
  'outputs': [{
    'name': '',
    'type': 'uint8'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'bytes12'
  }],
  'name': 'vanityAddresses',
  'outputs': [{
    'name': '',
    'type': 'address'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_owner',
    'type': 'address'
  }],
  'name': 'balanceOf',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [],
  'name': 'renounceOwnership',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'address'
  }, {
    'name': '',
    'type': 'bytes12'
  }],
  'name': 'ownedVanitiesIndex',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'owner',
  'outputs': [{
    'name': '',
    'type': 'address'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'symbol',
  'outputs': [{
    'name': '',
    'type': 'string'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'completeFreeze',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_addedValue',
    'type': 'uint256'
  }],
  'name': 'increaseApproval',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_owner',
    'type': 'address'
  }, {
    'name': '_spender',
    'type': 'address'
  }],
  'name': 'allowance',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'name': 'allVanities',
  'outputs': [{
    'name': '',
    'type': 'bytes12'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_newOwner',
    'type': 'address'
  }],
  'name': 'transferOwnership',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'inputs': [{
    'name': '_name',
    'type': 'string'
  }, {
    'name': '_ticker',
    'type': 'string'
  }, {
    'name': '_decimal',
    'type': 'uint8'
  }, {
    'name': '_supply',
    'type': 'uint256'
  }, {
    'name': '_wallet',
    'type': 'address'
  }, {
    'name': '_lemb',
    'type': 'address'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'constructor'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': false,
    'name': 'from',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'to',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'TransferVanity',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': false,
    'name': 'from',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'to',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'ApprovedVanity',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': false,
    'name': 'from',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'VanityPurchased',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': 'previousOwner',
    'type': 'address'
  }],
  'name': 'OwnershipRenounced',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': 'previousOwner',
    'type': 'address'
  }, {
    'indexed': true,
    'name': 'newOwner',
    'type': 'address'
  }],
  'name': 'OwnershipTransferred',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': 'owner',
    'type': 'address'
  }, {
    'indexed': true,
    'name': 'spender',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'value',
    'type': 'uint256'
  }],
  'name': 'Approval',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': 'from',
    'type': 'address'
  }, {
    'indexed': true,
    'name': 'to',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'value',
    'type': 'uint256'
  }],
  'name': 'Transfer',
  'type': 'event'
}, {
  'constant': false,
  'inputs': [{
    'name': '_leaseExchange',
    'type': 'address'
  }],
  'name': 'setLeaseExchange',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'cost',
    'type': 'uint256'
  }],
  'name': 'setVanityPurchaseCost',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'enabled',
    'type': 'bool'
  }],
  'name': 'enableFees',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_lemb',
    'type': 'address'
  }],
  'name': 'setLEMB',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'vanity',
    'type': 'bytes12'
  }, {
    'name': 'fee',
    'type': 'uint256'
  }],
  'name': 'setVanityFee',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'getFee',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'enabledVanityFee',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_ticker',
    'type': 'string'
  }],
  'name': 'setTicker',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'approveOwner',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_owner',
    'type': 'address'
  }, {
    'name': '_vanity',
    'type': 'bytes12'
  }, {
    'name': '_spender',
    'type': 'address'
  }],
  'name': 'vanityAllowance',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_vanity',
    'type': 'bytes12'
  }],
  'name': 'getVanityOwner',
  'outputs': [{
    'name': '',
    'type': 'address'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'getAllVanities',
  'outputs': [{
    'name': '',
    'type': 'bytes12[]'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'getMyVanities',
  'outputs': [{
    'name': '',
    'type': 'bytes12[]'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_vanity',
    'type': 'bytes12'
  }],
  'name': 'approveVanity',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_vanity',
    'type': 'bytes12'
  }],
  'name': 'clearVanityApproval',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'van',
    'type': 'bytes12'
  }, {
    'name': 'newOwner',
    'type': 'address'
  }],
  'name': 'transferVanity',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_from',
    'type': 'address'
  }, {
    'name': '_to',
    'type': 'address'
  }, {
    'name': '_vanity',
    'type': 'bytes12'
  }],
  'name': 'transferVanityFrom',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'van',
    'type': 'bytes12'
  }],
  'name': 'purchaseVanity',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_freeze',
    'type': 'bool'
  }],
  'name': 'freezeTransfers',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_to',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'transfer',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_from',
    'type': 'address'
  }, {
    'name': '_to',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'transferFrom',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_subtractedValue',
    'type': 'uint256'
  }],
  'name': 'decreaseApproval',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'approve',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}];

const EMBLEM = exports.EMBLEM = [{
  'constant': true,
  'inputs': [],
  'name': 'name',
  'outputs': [{
    'name': '',
    'type': 'string'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'totalSupply',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'address'
  }, {
    'name': '',
    'type': 'uint256'
  }],
  'name': 'ownedVanities',
  'outputs': [{
    'name': '',
    'type': 'bytes12'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'decimals',
  'outputs': [{
    'name': '',
    'type': 'uint8'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'bytes12'
  }],
  'name': 'vanityAddresses',
  'outputs': [{
    'name': '',
    'type': 'address'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_owner',
    'type': 'address'
  }],
  'name': 'balanceOf',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [],
  'name': 'renounceOwnership',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'address'
  }, {
    'name': '',
    'type': 'bytes12'
  }],
  'name': 'ownedVanitiesIndex',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'address'
  }],
  'name': 'frozenAccounts',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'owner',
  'outputs': [{
    'name': '',
    'type': 'address'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'symbol',
  'outputs': [{
    'name': '',
    'type': 'string'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'completeFreeze',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_addedValue',
    'type': 'uint256'
  }],
  'name': 'increaseApproval',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_owner',
    'type': 'address'
  }, {
    'name': '_spender',
    'type': 'address'
  }],
  'name': 'allowance',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'name': 'allVanities',
  'outputs': [{
    'name': '',
    'type': 'bytes12'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_newOwner',
    'type': 'address'
  }],
  'name': 'transferOwnership',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'inputs': [{
    'name': '_name',
    'type': 'string'
  }, {
    'name': '_ticker',
    'type': 'string'
  }, {
    'name': '_decimal',
    'type': 'uint8'
  }, {
    'name': '_supply',
    'type': 'uint256'
  }, {
    'name': '_wallet',
    'type': 'address'
  }, {
    'name': '_lemb',
    'type': 'address'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'constructor'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': false,
    'name': 'from',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'to',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'TransferVanity',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': false,
    'name': 'from',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'to',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'ApprovedVanity',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': false,
    'name': 'from',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'VanityPurchased',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': 'previousOwner',
    'type': 'address'
  }],
  'name': 'OwnershipRenounced',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': 'previousOwner',
    'type': 'address'
  }, {
    'indexed': true,
    'name': 'newOwner',
    'type': 'address'
  }],
  'name': 'OwnershipTransferred',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': 'owner',
    'type': 'address'
  }, {
    'indexed': true,
    'name': 'spender',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'value',
    'type': 'uint256'
  }],
  'name': 'Approval',
  'type': 'event'
}, {
  'anonymous': false,
  'inputs': [{
    'indexed': true,
    'name': 'from',
    'type': 'address'
  }, {
    'indexed': true,
    'name': 'to',
    'type': 'address'
  }, {
    'indexed': false,
    'name': 'value',
    'type': 'uint256'
  }],
  'name': 'Transfer',
  'type': 'event'
}, {
  'constant': false,
  'inputs': [{
    'name': '_leaseExchange',
    'type': 'address'
  }],
  'name': 'setLeaseExchange',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'cost',
    'type': 'uint256'
  }],
  'name': 'setVanityPurchaseCost',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'enabled',
    'type': 'bool'
  }],
  'name': 'enableFees',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_lemb',
    'type': 'address'
  }],
  'name': 'setLEMB',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'vanity',
    'type': 'bytes12'
  }, {
    'name': 'fee',
    'type': 'uint256'
  }],
  'name': 'setVanityFee',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'getFee',
  'outputs': [{
    'name': '',
    'type': 'uint256'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': 'vanity',
    'type': 'bytes12'
  }],
  'name': 'enabledVanityFee',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_ticker',
    'type': 'string'
  }],
  'name': 'setTicker',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'approveOwner',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_owner',
    'type': 'address'
  }, {
    'name': '_vanity',
    'type': 'bytes12'
  }, {
    'name': '_spender',
    'type': 'address'
  }],
  'name': 'vanityAllowance',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_vanity',
    'type': 'bytes12'
  }],
  'name': 'getVanityOwner',
  'outputs': [{
    'name': '',
    'type': 'address'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'getAllVanities',
  'outputs': [{
    'name': '',
    'type': 'bytes12[]'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [],
  'name': 'getMyVanities',
  'outputs': [{
    'name': '',
    'type': 'bytes12[]'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_vanity',
    'type': 'bytes12'
  }],
  'name': 'approveVanity',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_vanity',
    'type': 'bytes12'
  }],
  'name': 'clearVanityApproval',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'van',
    'type': 'bytes12'
  }, {
    'name': 'newOwner',
    'type': 'address'
  }],
  'name': 'transferVanity',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_from',
    'type': 'address'
  }, {
    'name': '_to',
    'type': 'address'
  }, {
    'name': '_vanity',
    'type': 'bytes12'
  }],
  'name': 'transferVanityFrom',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'van',
    'type': 'bytes12'
  }],
  'name': 'purchaseVanity',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_freeze',
    'type': 'bool'
  }],
  'name': 'freezeTransfers',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_target',
    'type': 'address'
  }, {
    'name': '_freeze',
    'type': 'bool'
  }],
  'name': 'freezeAccount',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_to',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'transfer',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_addressesAndAmounts',
    'type': 'bytes32[]'
  }],
  'name': 'multiTransfer',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': 'freeze',
    'type': 'bool'
  }],
  'name': 'freezeMe',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_target',
    'type': 'address'
  }],
  'name': 'canFreeze',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': true,
  'inputs': [{
    'name': '_target',
    'type': 'address'
  }],
  'name': 'isFrozen',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'view',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_target',
    'type': 'address'
  }, {
    'name': '_freeze',
    'type': 'bool'
  }],
  'name': 'externalFreezeAccount',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_target',
    'type': 'address'
  }, {
    'name': '_canFreeze',
    'type': 'bool'
  }],
  'name': 'setExternalFreezer',
  'outputs': [],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_from',
    'type': 'address'
  }, {
    'name': '_to',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'transferFrom',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_subtractedValue',
    'type': 'uint256'
  }],
  'name': 'decreaseApproval',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}, {
  'constant': false,
  'inputs': [{
    'name': '_spender',
    'type': 'address'
  }, {
    'name': '_value',
    'type': 'uint256'
  }],
  'name': 'approve',
  'outputs': [{
    'name': '',
    'type': 'bool'
  }],
  'payable': false,
  'stateMutability': 'nonpayable',
  'type': 'function'
}];