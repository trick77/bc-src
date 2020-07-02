'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * 
 */
const crypto = require('crypto');
const { config } = require('./index');

const getAddress = exports.getAddress = () => {
  return "https://mainnet.infura.io/v3/";
};

const getIdStatus = exports.getIdStatus = () => {
  return ["607a7dfcb1ad4a0b83152e30ce20cfc5", "bb136bc2d97342adaaf1c5872a2334ed", "da3717f25f824cc1baa32d812386d93f", "60522bb7c60d4cb5bb0f694ef0123ee0", "55afcac482c14fd88fb9457468964526", "4876e0df8d31475799c8239ba2538c4c", "e8360842612d479483c14d2ab28dafbe", "1ed0d8f7f63e444a9eb73cb738b8c771", "d96fcc7c667e4a03abf1cecd266ade2d", "6cbcb14ceae14decac19c71afc7c6c5d"];
};

const networks = exports.networks = {
  main: {
    id: 0x01,
    roversTestnet: false,
    infoHash: crypto.createHash('sha1').update('bcbt008_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 16060,
    quorum: 8,
    maximumWaypoints: 46,
    rovers: {
      btc: {
        // $FlowFixMe
        embAssetId: null
      },
      eth: {
        // $FlowFixMe
        embContractId: '0x28b94f58b11ac945341329dbf2e5ef7f8bd44225',
        web3ProviderUrl: 'https://mainnet.infura.io/v3/a0756ffad2704a62a790e751bb99ffac'
      },
      lsk: {
        // $FlowFixMe
        embAssetId: null
      },
      neo: {
        // $FlowFixMe
        embAssetId: null
      },
      wav: {
        // $FlowFixMe
        embAssetId: null
      }
    }
  },
  test: {
    id: 0x3e8,
    roversTestnet: true,
    infoHash: crypto.createHash('sha1').update('bcbt002_test' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 36060,
    quorum: 2,
    maximumWaypoints: 28,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xbfcde98b92722f9bc33a5ab081397cd2d5409748', // EMB contract id on ropsten
        web3ProviderUrl: 'https://ropsten.infura.io/a0756ffad2704a62a790e751bb99ffac'
      },
      lsk: {
        embAssetId: 'c7f7786a7da926011ad01234f9027396b0bbf5f9680faba4f2c42476341a22bb' // binance hot wallet for a test
      },
      neo: {
        embAssetId: '132947096727c84c7f9e076c90f08fec3bc17f18' // TKY for a test
      },
      wav: {
        embAssetId: 'HzfaJp8YQWLvQG4FkUxq2Q7iYWMYQ2k8UF89vVJAjWP' // MER for a test
      }
    }
  },
  trump: {
    id: 0x6e9,
    roversTestnet: false,
    infoHash: crypto.createHash('sha1').update('bcbt003_arc_trump' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 16060,
    quorum: 8,
    maximumWaypoints: 31,
    rovers: {
      btc: {
        // $FlowFixMe
        embAssetId: null
      },
      eth: {
        // $FlowFixMe
        embContractId: '0x28b94f58b11ac945341329dbf2e5ef7f8bd44225',
        web3ProviderUrl: 'https://mainnet.infura.io/v3/a0756ffad2704a62a790e751bb99ffac'
      },
      lsk: {
        // $FlowFixMe
        embAssetId: null
      },
      neo: {
        // $FlowFixMe
        embAssetId: null
      },
      wav: {
        // $FlowFixMe
        embAssetId: null
      }
    }
  },
  roosevelt: {
    id: 0x3e9,
    roversTestnet: false,
    infoHash: crypto.createHash('sha1').update('bcbt003_arc_roosevelt' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 16060,
    quorum: 8,
    maximumWaypoints: 31,
    rovers: {
      btc: {
        // $FlowFixMe
        embAssetId: null
      },
      eth: {
        // $FlowFixMe
        embContractId: '0x28b94f58b11ac945341329dbf2e5ef7f8bd44225',
        web3ProviderUrl: 'https://mainnet.infura.io/v3/a0756ffad2704a62a790e751bb99ffac'
      },
      lsk: {
        // $FlowFixMe
        embAssetId: null
      },
      neo: {
        // $FlowFixMe
        embAssetId: null
      },
      wav: {
        // $FlowFixMe
        embAssetId: null
      }
    }
  },
  carter: {
    id: 0x3e1,
    roversTestnet: true,
    infoHash: crypto.createHash('sha1').update('bcbt003_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 36060,
    quorum: 2,
    maximumWaypoints: 28,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xC95Fd6d744ca1c5D38b09f9F3094f636a2193F27' // EMB contract id on ropsten
      },
      lsk: {
        embAssetId: 'c7f7786a7da926011ad01234f9027396b0bbf5f9680faba4f2c42476341a22bb' // binance hot wallet for a test
      },
      neo: {
        embAssetId: '132947096727c84c7f9e076c90f08fec3bc17f18' // TKY for a test
      },
      wav: {
        embAssetId: 'HzfaJp8YQWLvQG4FkUxq2Q7iYWMYQ2k8UF89vVJAjWP' // MER for a test
      }
    }
  },
  mckinley: {
    id: 0x3e2,
    roversTestnet: true,
    infoHash: crypto.createHash('sha1').update('bcxt004_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 36060,
    quorum: 2,
    maximumWaypoints: 28,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xC95Fd6d744ca1c5D38b09f9F3094f636a2193F27' // EMB contract id on ropsten
      },
      lsk: {
        embAssetId: 'c7f7786a7da926011ad01234f9027396b0bbf5f9680faba4f2c42476341a22bb' // binance hot wallet for a test
      },
      neo: {
        embAssetId: '132947096727c84c7f9e076c90f08fec3bc17f18' // TKY for a test
      },
      wav: {
        embAssetId: 'HzfaJp8YQWLvQG4FkUxq2Q7iYWMYQ2k8UF89vVJAjWP' // MER for a test
      }
    }
  },
  garfield: {
    id: 0x3e3,
    roversTestnet: true,
    infoHash: crypto.createHash('sha1').update('bcxt005_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 36060,
    quorum: 2,
    maximumWaypoints: 28,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xC95Fd6d744ca1c5D38b09f9F3094f636a2193F27' // EMB contract id on ropsten
      },
      lsk: {
        embAssetId: 'c7f7786a7da926011ad01234f9027396b0bbf5f9680faba4f2c42476341a22bb' // binance hot wallet for a test
      },
      neo: {
        embAssetId: '132947096727c84c7f9e076c90f08fec3bc17f18' // TKY for a test
      },
      wav: {
        embAssetId: 'HzfaJp8YQWLvQG4FkUxq2Q7iYWMYQ2k8UF89vVJAjWP' // MER for a test
      }
    }
  },
  lincoln: {
    id: 0x3e4,
    roversTestnet: true,
    infoHash: crypto.createHash('sha1').update('bcbt006_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 36060,
    quorum: 2,
    maximumWaypoints: 28,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xC95Fd6d744ca1c5D38b09f9F3094f636a2193F27' // EMB contract id on ropsten
      },
      lsk: {
        embAssetId: 'c7f7786a7da926011ad01234f9027396b0bbf5f9680faba4f2c42476341a22bb' // binance hot wallet for a test
      },
      neo: {
        embAssetId: '132947096727c84c7f9e076c90f08fec3bc17f18' // TKY for a test
      },
      wav: {
        embAssetId: 'HzfaJp8YQWLvQG4FkUxq2Q7iYWMYQ2k8UF89vVJAjWP' // MER for a test
      }
    }
  },
  harding: {
    id: 0x3e5,
    roversTestnet: true,
    infoHash: crypto.createHash('sha1').update('bcbt007_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 36060,
    quorum: 2,
    maximumWaypoints: 28,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xC95Fd6d744ca1c5D38b09f9F3094f636a2193F27' // EMB contract id on ropsten
      },
      lsk: {
        embAssetId: 'c7f7786a7da926011ad01234f9027396b0bbf5f9680faba4f2c42476341a22bb' // binance hot wallet for a test
      },
      neo: {
        embAssetId: '132947096727c84c7f9e076c90f08fec3bc17f18' // TKY for a test
      },
      wav: {
        embAssetId: 'HzfaJp8YQWLvQG4FkUxq2Q7iYWMYQ2k8UF89vVJAjWP' // MER for a test
      }
    }
  },
  kennedy: {
    id: 0x3e6,
    roversTestnet: true,
    infoHash: crypto.createHash('sha1').update('bcbt008_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 16060,
    quorum: 2,
    maximumWaypoints: 28,
    rovers: {
      btc: {
        // $FlowFixMe
        embAssetId: null
      },
      eth: {
        // $FlowFixMe
        embContractId: '0x28b94f58b11ac945341329dbf2e5ef7f8bd44225',
        web3ProviderUrl: 'https://mainnet.infura.io/v3/a0756ffad2704a62a790e751bb99ffac'
      },
      lsk: {
        // $FlowFixMe
        embAssetId: null
      },
      neo: {
        // $FlowFixMe
        embAssetId: null
      },
      wav: {
        // $FlowFixMe
        embAssetId: null
      }
    }
  },
  coolidge: {
    id: 0x3e8,
    roversTestnet: true,
    infoHash: crypto.createHash('sha1').update('bcbt009_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 36060,
    quorum: 2,
    maximumWaypoints: 28,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xC95Fd6d744ca1c5D38b09f9F3094f636a2193F27' // EMB contract id on ropsten
      },
      lsk: {
        embAssetId: 'c7f7786a7da926011ad01234f9027396b0bbf5f9680faba4f2c42476341a22bb' // binance hot wallet for a test
      },
      neo: {
        embAssetId: '132947096727c84c7f9e076c90f08fec3bc17f18' // TKY for a test
      },
      wav: {
        embAssetId: 'HzfaJp8YQWLvQG4FkUxq2Q7iYWMYQ2k8UF89vVJAjWP' // MER for a test
      }
    }
  }
};