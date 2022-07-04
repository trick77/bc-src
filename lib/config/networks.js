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
const { getRarePepeNames } = require('./counterparty');

const getAddress = exports.getAddress = () => {
  return "https://mainnet.infura.io/v3/";
};

const getIdStatus = exports.getIdStatus = () => {
  return ["97c8bf358b9942a9853fab1ba93dc5b3", "e1967f2f27e143c3b8831d0e612bc7b1", "42e30346ab5d41c7850f45adedfc9db2", "e5a3e9ed05704633b5807ca180e71f16", "bda837d7e4044d6c8b5b89691c9e262e", "a95781685090488a83012e1c37e9728b", "2e6d9331f74d472a9d47fe99f697ca2b", "f315575765b14720b32382a61a89341a", "3bbb5ebeb45e4b2b9a35261f272fb611", "e58d5891ebaf464dbcad6a926a107adf", "c334bb4b45a444979057f0fb8a0c9d1b", "781c281ea82347709935f5b394f2383c", "6d7880a8f4b347ca8953d2715e164241", "80311d26ccb74946b9d016f38ce901d2", "640777fe168f4b0091c93726b4f0463a", "8e609c76fce442f8a1735fbea9999747", "607a7dfcb1ad4a0b83152e30ce20cfc5", "bb136bc2d97342adaaf1c5872a2334ed", "da3717f25f824cc1baa32d812386d93f", "60522bb7c60d4cb5bb0f694ef0123ee0", "4876e0df8d31475799c8239ba2538c4c", "e8360842612d479483c14d2ab28dafbe", "1ed0d8f7f63e444a9eb73cb738b8c771", "6cbcb14ceae14decac19c71afc7c6c5d", "c3b0f4694b7a4e6aaf7f474e9522fa9c", "f039330d8fb747e48a7ce98f51400d65", "58073b4a32df4105906c702f167b91d2", "76fb6c10f1584483a45a0a28e91b07ad", "25c7c08910c04b0c9be79c09f559652e", "dc22c9c6245742069d5fe663bfa8a698", "eeb4395af38744ce9129d8975781d34e", "baba69547b5049d687d12db75d58431a", "e674ba0fd9dd4a78b50ed333a3198c64", "917eab7f24e645509c93f104186522e5", "aa7a461490244b65a54e2f67b959fa8a", "ab03d6233a77417db2b4dcc40884e4af", "6d816194aab74348b53e35232232a260", "06fd041b5d42478cb9d9b68b35069d85", "498494c790964af8be6eafe6e2cdffec", "326b0d7561824e0b8c4ee1f30e257019", "419c7f687f3b41f0bc9e0e647b9ab911", "4b2dbe30a1b1404e80749545bf913be9", "ef4d9142fb914a998dcabfcbddda8bdf", "7a153118eae44f8d808da67bb449362d", "19de6a4c0ccb416287b18bc81fa0b3b1", "94cc5e7210024cbda2686a62ae4e267a", "ff9137b012f144d7996e8957fb2f5b26", "22b2ebe2940745b3835907b30e8257a4", "48899b10645a48e189e345be4be19ece", "b58b6c88761446ec82f70ebc965c90e8", "7d0d81d0919f4f05b9ab6634be01ee73", "ed0e4d0e188240e7a0eeb68664f4787e", "26b896d72b16489a8927ee528b990e9f", "ef95db49a6254b6ea1fdcf98a1a620ca", "43dd12c4245b4924b4a29cea5afa18ef", "cf23197dd7954528a7b3adb180dd9995", "69500eb24e3a4bd79fbb8cd1fbb9a3ef", "7818d1d2356a45e68b03b25a5ad8052c", "5ffc47f65c4042ce847ef66a3fa70d4c", "f20390fe230e46608572ac4378b70668", "906693e94763465a9809e361fb530c87", "349e6679b09e46caae9cfa4337a22701", "97524564d982452caee95b257a54064e", "5fc47c37ebd24bc68c4f203742da9752", "19ae29fc531e46229a7dec1f77e1d067", "5bfa6b51715c4ee1a18c14364bfc8e13", "9bb3633d970044baa92a78ff9d26c8bd", "c8d36b72d2d04f16a94931809cdf6383", "32ed0b70fae34f309433209ac53794a9", "84294a5b020c4ab2990bdb28fb553297", "6b0f8cad403b42cabb4cdb1e62017d24", "18f52ed927a64f57ad1810599a18e209", "4e987044d78c44319523b16c7bf0412c", "698185618aa64a9f918c9bf9590520bd", "afb899cc7918472e9c54417ec13b6c39", "e65462856a9b46fbbec5d0fde337f2b0", "fb3eae44a02f4a37868d3cd0ba40f30f", "668b3268d5b241b5bab5c6cb886e4c61", "abbfbb3d267b4bc882ff8a1080a2a0f6", "15fe1eff1ac44d5b995232621c794ce4", "a2687d7078ff46d3b5f3f58cb97d3e44", "eb41d8eca36649e1a68a61e3f233e55c", "37efa691ffec4c41a60aa4a69865d8f6", "b05f5370e790473c99b74bed60d69162", "efaece4f5f4443979063839c124c8171", "eaf5e0b4a01042a48211762c8d4eec44", "4161ec5436de4608be5ddf1101c1d0a5", "b24ba38418084f5c974b3af71bd63117", "bbfb2fa1009e40e4b72b10166d9a5069", "e057d93273374902ae044401f8099775", "d25de4d32b0f48a6bc289cfc7d50d7fd", "006a20906c5c42f5a009c20d63988dd7", "8fa5e8ad9f914ec1867eadfbf93b1de0", "8831d56e946146a5bf2d5df68f034ee3", "d356a5affcea4eec8e0cdde7e52570ba", "624bfd9b2a084cd39ca8e1f50d79f56e", "fb32a606c5c646c7932e43cfaf6c39df", "2cf3ec9bd42d4099b8620c2a6ee8c51a", "e49eab7ebf6b47688265ad5e5c0aacd0", "e8235710b20f4f039a994b4f39c0d01f", "f8c3858f892d4199840f5354cc954713", "405d90835a22404f91c36993be519dc4", "0ecc3584199b4bdeb1c98d5c6e781818", "26a5f300569d4e938e10e3abd2caef74", "36b98a13557c4b8583d57934ede2f74d", "7bbf73a8855d4c0491f93e6dc498360d", "453d2049c15d4a8da5501a0464fa44f8", "c73ecd76112b419ab2766b7c7f3e233e", "cfac36101869499f961b31585449de88", "16dfd66c4a1a4a9da5724254c97c93e6", "6a6c66740e9e4cea9cc8425869e9d106"];
};

const wasabiBulletProofs = exports.wasabiBulletProofs = [];

const validChains = exports.validChains = ['btc', 'eth', 'lsk', 'wav', 'neo', 'dai', 'emb', 'usdt', 'xaut', 'wbtc', 'uni', 'wise', 'frax', 'ust', 'link', 'usdc', 'core', 'dpi', 'hez', 'bond', 'mkr', 'ampl', 'bac', 'lon', 'alpha', 'sdt', 'duck', 'pols', 'exrd', 'tusd', 'lrc', 'ddim', 'cel', 'cc10', 'crv', 'tru', 'xor', 'yfi', 'snx', 'rook', 'pbtc35a', 'pickle', 'farm', 'grt', 'combo', 'orn', 'perp', 'ankreth', 'fnk', 'ren', 'onx', 'apy', 'comp', 'bao', 'omg', 'cvp', 'yfdai', 'stake', 'ramp', 'sand', 'keep', 'mph', 'renbtc', 'ens', 'shib', 'leash', 'bone', 'overline', 'wristband', 'wristband.evangelist', 'wristband.olympia', 'wristband.olympiagold', 'wristband.staff', 'wristband.studiorum', 'wool', 'museums', 'forbesnft', 'nftm', 'emblems', 'evangelists', 'boreddoge'].concat(getRarePepeNames());

// All utxos rely on the script type to organize the index
const scriptTypes = exports.scriptTypes = ['marker_output', 'taker_output', 'taker_callback', 'nrg_transfer', 'feed_update', 'feed_create'];

// Hashes which support updates to the UTXO engine
const orderedHashes = exports.orderedHashes = ['16b1360cc9e3cb7f38459a3321defa5cd0b09df131ff31c90d01ba082a887b9f', 'f19dbc52af8b0d97a1445d55bf2425b0e1c4912af7d6ecde9b31572c87c940f1', 'ac967e8a7a4a60c1268d1b4bb2350649ca851d2d49e4cb5d982213bbb8fada29', '82cdabe20831d77ab9a88c818e684f2943a3b87b948f6f87b0dbeb044f490647', '00be539c6d9eebccfb37d3cdee7f23ecc63d6e69e39ffef1070134a6324d050d', '744d77e46c123bfaafc1ebd4671c79679ca819ab09665b1f04e2c11417a6a48f', 'e3c668d5eac9384583c5dafc234c1eac139fcce8f4e3f11946bb1561431ed139', '512502137fe4e14bcb098a1d6a0d0395df036870d433eb1b313631559c9d8d0c', 'c96a3b7d36cc83a84c416fff6c76f3791d44224b307e103c41940d1f59cf3ffe', '29090a964c56107a84820bf5caf70a629e5ada8337220c8b1a61acc2269e91e0', 'f7f1f845e7aeb41f6929900eaf8eda0911932785c9831065f80b4e2574527b68', 'b24263d12b0c48cd16be2e089c0beb07795f4b1fc83205f5bb44429a0145de72', '49699e566a0262d000644d44249566432e6b490bb0e91f2d31f3dc69f9060e4c', '101f865e7270f1fc4b6551d0a64fb48ae3b76b611dbc748bc3c7b66762f1e858', 'f6a7a72e36803fb7fedf09dc2ddc471db5c12ed0f2df7e403bb9c3526f838d7d', 'aba220b8225b4e32771cd65f4d90ba7b8c5a19f9e97517adb361251cd5d50337', '49f7a97b434c3935c182845960ebd98331522d72fabfe01fe6d15d185adfef66', 'bc8f395d6b61d390867852bd0285d0f0b1db4cbb499439349699b4b4d5b0ce50', '665367bf11800dec4ac4057a5c78dbdfa4f6caa925eaae48ce51680d29fc5bec', '196e92a80496cead4ce0bbb37aaa6a149f9abf2867c508a0fef225c9e7879484', '9fea92a6de565e8e9f3c8e97885b43ddccc42c652603c398d503262e35bd0ef1', '88fbc8627a70f0767a997047f8c70a0859d826334d82b3507066875b244b9fc7', '28a0b2011dc915c42015713386ecc9cd1440bc30b563f10993b43e6ba1845e74', '21ca81cd0349d4b9acf4f40185bb714f70b5c31a97f469770dae1bc04d8a6ade', 'be6a2023cbcc453dae8c6aaf573c9a17bbf23d9a8cea1b8682bb9d0572a2819c', '820af8ffb68b04d2fbb109b3a0636486e85e960f061e9c7df784cfdd0d7c60b0', '7daa7d5264608c0f28c7b01fe1e8b76b8df966c6dbd09d35c96441523438a292', 'd89ca974507196b645367f852b40b514610a3859c344fd60842e0014e8ec4dff', 'b9b531ea95215b7e307c73fcb8169355363123f3d75d2344207ca2bc98fcbbed', '59656013b2c5ec3c2c6af22029ac4f8da54c96ab0bc9b5d5568b61020b275a7d', '63b89ffd54586dc2441cff425fb2a6f6bd8e062910118b053881c4cdb381d446', '28f4596374000323d88d8fbd76e12b8d1256b4b8239ed54fa272d5b80dd38200', '684ec223c6b50fd2b6f73c771c2fe5a71158c6f2f8315dffbc43fe04fa5cc32b', '51862d0af4fe5daefa598e94f83a382c9b82c9f0f8284f1893d04709e4f6cf23', 'b6b4010f7476361f3c773a402d4a2502ba935032e0aaabf5a60ac27c314ca654', '7a57487c9472ba16248c6158a3d018a3566eb06fc1ef9995099f7bc1ecd2692e', '3f29b8913a873711030b6f576bfafc0c8470e56018e9ea8bb45d4e96c75700f8', '0e234d2f797fb8eb3a2520a9619e71252712f5f31a425b2e95d5d0f649918b53', '243a3b22d50a8f8002241acbc4b46e70a9a8d064df91cb308ad02eb11b183eb8', '5cf5bd4c978699ffecc660b12e7a4346cef8ba13c1eef6856b2ee6a9e697e8d7', '52296437a32d82d372f062932f7690387a6c67e89b3eb83f01595a7955bd849d', '176b76b3421b59ca14e4b21afe88dd487c80c924c0439101fc3d2f9f955bf93b', '8cb1484899825a1ad3ec18ef8cec99452dc7236d12645787bbab5de87e164cd3', 'f84a4ea196c752fb069593bc4740d358dad8470d187fe732ccd23371d24d613a', 'ea50badab352a567c109bd14ed025b5dcd0dfbf756a19a5c2f9c082a506a8127', '24cbf7ed78e4e29127f09196e873002c1ad2b56e3fb79ce308bf63eb188d3ff4', '809ad6576dbffa19958e2e30c2cb14c67d2003ee60964a527777a518319688f4', '932897f0443096940abdd53cfcd7b9526f08cc4dd490d2e25f47adabcd49fbb2', '7ddb69cc8fd308e8eee966a6576dfb559e39ff2923bdd3f0c2d014453b4547ca', 'a2100ee8f35735d3fb36d480ada4e24b05a574194e44baa5d3917c8c82c16f47', 'dfbdffd6bccf8fbb93f154e8842c3e3e73b07afc45820ca21cc03513902385dc', '84148528d7b2dbd7242aaec96ebe1b6799fa04eb196fd8cb8458a9f1d8f2f121', 'c994320f3ed5fdfce1fcbb835f003192497a350361c37d357c271f4782f6b341', 'e987a3c0dc915717777e8214ad43e98bec674320bcaa95c5ca9b28ed1dd379bf', '5d2be3d4638b16a71028319851bff75b06f7991b2e93eba506bfadcfd493bb2e', '6dddf9dfcd0d7a3089c4409d45429a0b2114a6f917aa94b4d73a02e675500a23'];

const networks = exports.networks = {
  main: {
    id: 0x01,
    roversTestnet: false,
    infoHash: crypto.createHash('sha1').update('bcbt008_arc' + config.blockchainFingerprintsHash).digest('hex'),
    portBase: 16060,
    quorum: 8,
    maximumWaypoints: 18,
    rovers: {
      btc: {
        // $FlowFixMe
        embAssetId: null
      },
      eth: {
        // $FlowFixMe
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d',
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d', // EMB contract id on ropsten
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        // $FlowFixMe
        embAssetId: null
      },
      eth: {
        // $FlowFixMe
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d',
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        // $FlowFixMe
        embAssetId: null
      },
      eth: {
        // $FlowFixMe
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d',
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d' // EMB contract id on ropsten
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d' // EMB contract id on ropsten
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d' // EMB contract id on ropsten
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d' // EMB contract id on ropsten
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d' // EMB contract id on ropsten
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        // $FlowFixMe
        embAssetId: null
      },
      eth: {
        // $FlowFixMe
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d',
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
    maximumWaypoints: 18,
    rovers: {
      btc: {
        embAssetId: 'EMBX'
      },
      eth: {
        embContractId: '0xdb0acc14396d108b3c5574483acb817855c9dc8d' // EMB contract id on ropsten
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