'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getOriginalMakerOrder;


const { GetOutPointRequest } = require('@overline/proto/proto/bc_pb'); /**
                                                                        * Copyright (c) 2017-present, BlockCollider developers, All rights reserved.
                                                                        *
                                                                        * This source code is licensed under the MIT license found in the
                                                                        * LICENSE file in the root directory of this source tree.
                                                                        *
                                                                        * 
                                                                        */

const { toASM } = require('bcjs/dist/script/bytecode');

function getOriginalMakerOrder(context, call, callback) {
  const req = call.request;
  const hash = req.getHash();
  const index = req.getIndex();
  context.server.engine._persistence.getTransactionByHash(hash).then(tx => {
    let script = toASM(Buffer.from(tx.getOutputsList()[index].getOutputScript()), 0x01);
    if (script.includes('OP_CALLBACK')) {
      context.server.engine.utxoManager.getInitialMakerOrderWithTxAndIndex(script).then(res => {
        let tx = res[2];
        callback(null, tx);
      }).catch(err => {
        context.logger.error(`Could not get tx, reason: ${err}'`);
        callback(err);
      });
    } else {
      callback(`Transaction is not a callback order`);
    }
  }).catch(err => {
    context.logger.error(`Could not get tx, reason: ${err}'`);
    callback(err);
  });
}