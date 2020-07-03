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
  return ["97c8bf358b9942a9853fab1ba93dc5b3", "e1967f2f27e143c3b8831d0e612bc7b1", "42e30346ab5d41c7850f45adedfc9db2", "e5a3e9ed05704633b5807ca180e71f16", "ce55a2288521418389de018b33afb6c9", "bda837d7e4044d6c8b5b89691c9e262e", "6c3cc2ec874b4e8e977bdcb0204f9220", "a95781685090488a83012e1c37e9728b", "2e6d9331f74d472a9d47fe99f697ca2b", "f315575765b14720b32382a61a89341a", "3bbb5ebeb45e4b2b9a35261f272fb611", "e58d5891ebaf464dbcad6a926a107adf", "cabc724fb9534d1bb245582a74ccf3e7", "c334bb4b45a444979057f0fb8a0c9d1b", "740f8a307aa34141a298506577f063bc", "781c281ea82347709935f5b394f2383c", "6d7880a8f4b347ca8953d2715e164241", "80311d26ccb74946b9d016f38ce901d2", "640777fe168f4b0091c93726b4f0463a", "8e609c76fce442f8a1735fbea9999747", "607a7dfcb1ad4a0b83152e30ce20cfc5", "bb136bc2d97342adaaf1c5872a2334ed", "da3717f25f824cc1baa32d812386d93f", "60522bb7c60d4cb5bb0f694ef0123ee0", "55afcac482c14fd88fb9457468964526", "4876e0df8d31475799c8239ba2538c4c", "e8360842612d479483c14d2ab28dafbe", "1ed0d8f7f63e444a9eb73cb738b8c771", "d96fcc7c667e4a03abf1cecd266ade2d", "6cbcb14ceae14decac19c71afc7c6c5d"];
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