// This file is generated. Do not edit
// @generated

// https://github.com/Manishearth/rust-clippy/issues/702
#![allow(unknown_lints)]
#![allow(clippy)]

#![cfg_attr(rustfmt, rustfmt_skip)]

#![allow(box_pointers)]
#![allow(dead_code)]
#![allow(missing_docs)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(non_upper_case_globals)]
#![allow(trivial_casts)]
#![allow(unsafe_code)]
#![allow(unused_imports)]
#![allow(unused_results)]


// interface

pub trait Bc {
    fn get_rovered_block_hash(&self, o: ::grpc::RequestOptions, p: super::bc::GetRoveredBlockHashRequest) -> ::grpc::SingleResponse<super::core::Block>;

    fn get_rovered_block_height(&self, o: ::grpc::RequestOptions, p: super::bc::GetRoveredBlockHeightRequest) -> ::grpc::SingleResponse<super::core::Block>;

    fn get_rovered_blocks(&self, o: ::grpc::RequestOptions, p: super::bc::GetRoveredBlocksRequest) -> ::grpc::SingleResponse<super::bc::GetRoveredBlocksResponse>;

    fn get_latest_rovered_blocks(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::GetRoveredBlocksResponse>;

    fn get_block_hash(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlockHashRequest) -> ::grpc::SingleResponse<super::core::BcBlock>;

    fn get_block_height(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlockHeightRequest) -> ::grpc::SingleResponse<super::core::BcBlock>;

    fn get_blocks_height(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlockHeightRequest) -> ::grpc::SingleResponse<super::bc::GetBlocksResponse>;

    fn get_blocks(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlocksRequest) -> ::grpc::SingleResponse<super::bc::GetBlocksResponse>;

    fn get_latest_block(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::core::BcBlock>;

    fn get_tx(&self, o: ::grpc::RequestOptions, p: super::bc::GetTxRequest) -> ::grpc::SingleResponse<super::core::Transaction>;

    fn get_marked_tx(&self, o: ::grpc::RequestOptions, p: super::bc::GetMarkedTxRequest) -> ::grpc::SingleResponse<super::core::MarkedTransaction>;

    fn get_trade_status(&self, o: ::grpc::RequestOptions, p: super::bc::GetOutPointRequest) -> ::grpc::SingleResponse<super::bc::GetTradeStatusResponse>;

    fn get_outpoint_status(&self, o: ::grpc::RequestOptions, p: super::bc::GetOutPointRequest) -> ::grpc::SingleResponse<super::bc::GetOutPointStatusResponse>;

    fn get_tx_claimed_by(&self, o: ::grpc::RequestOptions, p: super::bc::GetOutPointRequest) -> ::grpc::SingleResponse<super::core::Transaction>;

    fn get_raw_mempool(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::GetRawMempoolResponse>;

    fn get_block_by_tx(&self, o: ::grpc::RequestOptions, p: super::bc::GetTxRequest) -> ::grpc::SingleResponse<super::core::BcBlock>;

    fn get_rovered_block_for_marked_tx(&self, o: ::grpc::RequestOptions, p: super::bc::GetMarkedTxRequest) -> ::grpc::SingleResponse<super::core::Block>;

    fn help(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::HelpResponse>;

    fn stats(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::StatsResponse>;

    fn get_settings(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::SettingsResponse>;

    fn new_tx(&self, o: ::grpc::RequestOptions, p: super::bc::RpcTransaction) -> ::grpc::SingleResponse<super::bc::RpcTransactionResponse>;

    fn send_tx(&self, o: ::grpc::RequestOptions, p: super::core::Transaction) -> ::grpc::SingleResponse<super::bc::RpcTransactionResponse>;

    fn get_balance(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::bc::GetBalanceResponse>;

    fn get_wallet(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::core::WalletData>;

    fn get_spendable_outpoints(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::core::WalletData>;

    fn get_spendable_collateral(&self, o: ::grpc::RequestOptions, p: super::bc::GetSpendableCollateralRequest) -> ::grpc::SingleResponse<super::bc::GetSpendableCollateralResponse>;

    fn get_unlock_taker_tx_params(&self, o: ::grpc::RequestOptions, p: super::bc::GetUnlockTakerTxParamsRequest) -> ::grpc::SingleResponse<super::bc::GetUnlockTakerTxParamsResponse>;

    fn get_transfers(&self, o: ::grpc::RequestOptions, p: super::bc::TransferRequest) -> ::grpc::SingleResponse<super::bc::TransferResponse>;

    fn get_open_orders(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::bc::GetOpenOrdersResponse>;

    fn get_matched_orders(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::bc::GetMatchedOrdersResponse>;

    fn get_historical_orders(&self, o: ::grpc::RequestOptions, p: super::bc::GetHistoryRequest) -> ::grpc::SingleResponse<super::bc::GetMatchedOrdersResponse>;

    fn get_unmatched_orders(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::bc::GetOpenOrdersResponse>;

    fn get_utxo_length(&self, o: ::grpc::RequestOptions, p: super::bc::GetUtxoLengthRequest) -> ::grpc::SingleResponse<super::bc::GetUtxoLengthResponse>;

    fn get_stxo_length(&self, o: ::grpc::RequestOptions, p: super::bc::GetUtxoLengthRequest) -> ::grpc::SingleResponse<super::bc::GetUtxoLengthResponse>;

    fn get_blake2bl(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlake2blRequest) -> ::grpc::SingleResponse<super::bc::GetBlake2blResponse>;

    fn get_bc_address_via_vanity(&self, o: ::grpc::RequestOptions, p: super::bc::VanityConvertRequest) -> ::grpc::SingleResponse<super::bc::VanityConvertResponse>;

    fn get_current_work(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::CurrentWork>;

    fn get_sync_status(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::SyncStatus>;
}

// client

pub struct BcClient {
    grpc_client: ::grpc::Client,
    method_GetRoveredBlockHash: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetRoveredBlockHashRequest, super::core::Block>>,
    method_GetRoveredBlockHeight: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetRoveredBlockHeightRequest, super::core::Block>>,
    method_GetRoveredBlocks: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetRoveredBlocksRequest, super::bc::GetRoveredBlocksResponse>>,
    method_GetLatestRoveredBlocks: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Null, super::bc::GetRoveredBlocksResponse>>,
    method_GetBlockHash: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBlockHashRequest, super::core::BcBlock>>,
    method_GetBlockHeight: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBlockHeightRequest, super::core::BcBlock>>,
    method_GetBlocksHeight: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBlockHeightRequest, super::bc::GetBlocksResponse>>,
    method_GetBlocks: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBlocksRequest, super::bc::GetBlocksResponse>>,
    method_GetLatestBlock: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Null, super::core::BcBlock>>,
    method_GetTx: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetTxRequest, super::core::Transaction>>,
    method_GetMarkedTx: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetMarkedTxRequest, super::core::MarkedTransaction>>,
    method_GetTradeStatus: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetOutPointRequest, super::bc::GetTradeStatusResponse>>,
    method_GetOutpointStatus: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetOutPointRequest, super::bc::GetOutPointStatusResponse>>,
    method_GetTxClaimedBy: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetOutPointRequest, super::core::Transaction>>,
    method_GetRawMempool: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Null, super::bc::GetRawMempoolResponse>>,
    method_GetBlockByTx: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetTxRequest, super::core::BcBlock>>,
    method_GetRoveredBlockForMarkedTx: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetMarkedTxRequest, super::core::Block>>,
    method_Help: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Null, super::bc::HelpResponse>>,
    method_Stats: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Null, super::bc::StatsResponse>>,
    method_GetSettings: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Null, super::bc::SettingsResponse>>,
    method_NewTx: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::RpcTransaction, super::bc::RpcTransactionResponse>>,
    method_SendTx: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Transaction, super::bc::RpcTransactionResponse>>,
    method_GetBalance: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBalanceRequest, super::bc::GetBalanceResponse>>,
    method_GetWallet: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBalanceRequest, super::core::WalletData>>,
    method_GetSpendableOutpoints: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBalanceRequest, super::core::WalletData>>,
    method_GetSpendableCollateral: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetSpendableCollateralRequest, super::bc::GetSpendableCollateralResponse>>,
    method_GetUnlockTakerTxParams: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetUnlockTakerTxParamsRequest, super::bc::GetUnlockTakerTxParamsResponse>>,
    method_GetTransfers: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::TransferRequest, super::bc::TransferResponse>>,
    method_GetOpenOrders: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBalanceRequest, super::bc::GetOpenOrdersResponse>>,
    method_GetMatchedOrders: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBalanceRequest, super::bc::GetMatchedOrdersResponse>>,
    method_GetHistoricalOrders: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetHistoryRequest, super::bc::GetMatchedOrdersResponse>>,
    method_GetUnmatchedOrders: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBalanceRequest, super::bc::GetOpenOrdersResponse>>,
    method_GetUTXOLength: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetUtxoLengthRequest, super::bc::GetUtxoLengthResponse>>,
    method_GetSTXOLength: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetUtxoLengthRequest, super::bc::GetUtxoLengthResponse>>,
    method_GetBlake2bl: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::GetBlake2blRequest, super::bc::GetBlake2blResponse>>,
    method_GetBcAddressViaVanity: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::bc::VanityConvertRequest, super::bc::VanityConvertResponse>>,
    method_GetCurrentWork: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Null, super::bc::CurrentWork>>,
    method_GetSyncStatus: ::std::sync::Arc<::grpc::rt::MethodDescriptor<super::core::Null, super::bc::SyncStatus>>,
}

impl BcClient {
    pub fn with_client(grpc_client: ::grpc::Client) -> Self {
        BcClient {
            grpc_client: grpc_client,
            method_GetRoveredBlockHash: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetRoveredBlockHash".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetRoveredBlockHeight: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetRoveredBlockHeight".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetRoveredBlocks: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetRoveredBlocks".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetLatestRoveredBlocks: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetLatestRoveredBlocks".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetBlockHash: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetBlockHash".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetBlockHeight: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetBlockHeight".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetBlocksHeight: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetBlocksHeight".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetBlocks: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetBlocks".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetLatestBlock: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetLatestBlock".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetTx: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetTx".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetMarkedTx: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetMarkedTx".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetTradeStatus: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetTradeStatus".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetOutpointStatus: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetOutpointStatus".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetTxClaimedBy: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetTxClaimedBy".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetRawMempool: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetRawMempool".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetBlockByTx: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetBlockByTx".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetRoveredBlockForMarkedTx: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetRoveredBlockForMarkedTx".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_Help: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/Help".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_Stats: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/Stats".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetSettings: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetSettings".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_NewTx: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/NewTx".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_SendTx: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/SendTx".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetBalance: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetBalance".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetWallet: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetWallet".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetSpendableOutpoints: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetSpendableOutpoints".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetSpendableCollateral: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetSpendableCollateral".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetUnlockTakerTxParams: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetUnlockTakerTxParams".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetTransfers: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetTransfers".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetOpenOrders: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetOpenOrders".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetMatchedOrders: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetMatchedOrders".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetHistoricalOrders: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetHistoricalOrders".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetUnmatchedOrders: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetUnmatchedOrders".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetUTXOLength: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetUTXOLength".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetSTXOLength: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetSTXOLength".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetBlake2bl: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetBlake2bl".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetBcAddressViaVanity: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetBcAddressViaVanity".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetCurrentWork: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetCurrentWork".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
            method_GetSyncStatus: ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                name: "/bc.Bc/GetSyncStatus".to_string(),
                streaming: ::grpc::rt::GrpcStreaming::Unary,
                req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
            }),
        }
    }

    pub fn new_plain(host: &str, port: u16, conf: ::grpc::ClientConf) -> ::grpc::Result<Self> {
        ::grpc::Client::new_plain(host, port, conf).map(|c| {
            BcClient::with_client(c)
        })
    }
    pub fn new_tls<C : ::tls_api::TlsConnector>(host: &str, port: u16, conf: ::grpc::ClientConf) -> ::grpc::Result<Self> {
        ::grpc::Client::new_tls::<C>(host, port, conf).map(|c| {
            BcClient::with_client(c)
        })
    }
}

impl Bc for BcClient {
    fn get_rovered_block_hash(&self, o: ::grpc::RequestOptions, p: super::bc::GetRoveredBlockHashRequest) -> ::grpc::SingleResponse<super::core::Block> {
        self.grpc_client.call_unary(o, p, self.method_GetRoveredBlockHash.clone())
    }

    fn get_rovered_block_height(&self, o: ::grpc::RequestOptions, p: super::bc::GetRoveredBlockHeightRequest) -> ::grpc::SingleResponse<super::core::Block> {
        self.grpc_client.call_unary(o, p, self.method_GetRoveredBlockHeight.clone())
    }

    fn get_rovered_blocks(&self, o: ::grpc::RequestOptions, p: super::bc::GetRoveredBlocksRequest) -> ::grpc::SingleResponse<super::bc::GetRoveredBlocksResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetRoveredBlocks.clone())
    }

    fn get_latest_rovered_blocks(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::GetRoveredBlocksResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetLatestRoveredBlocks.clone())
    }

    fn get_block_hash(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlockHashRequest) -> ::grpc::SingleResponse<super::core::BcBlock> {
        self.grpc_client.call_unary(o, p, self.method_GetBlockHash.clone())
    }

    fn get_block_height(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlockHeightRequest) -> ::grpc::SingleResponse<super::core::BcBlock> {
        self.grpc_client.call_unary(o, p, self.method_GetBlockHeight.clone())
    }

    fn get_blocks_height(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlockHeightRequest) -> ::grpc::SingleResponse<super::bc::GetBlocksResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetBlocksHeight.clone())
    }

    fn get_blocks(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlocksRequest) -> ::grpc::SingleResponse<super::bc::GetBlocksResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetBlocks.clone())
    }

    fn get_latest_block(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::core::BcBlock> {
        self.grpc_client.call_unary(o, p, self.method_GetLatestBlock.clone())
    }

    fn get_tx(&self, o: ::grpc::RequestOptions, p: super::bc::GetTxRequest) -> ::grpc::SingleResponse<super::core::Transaction> {
        self.grpc_client.call_unary(o, p, self.method_GetTx.clone())
    }

    fn get_marked_tx(&self, o: ::grpc::RequestOptions, p: super::bc::GetMarkedTxRequest) -> ::grpc::SingleResponse<super::core::MarkedTransaction> {
        self.grpc_client.call_unary(o, p, self.method_GetMarkedTx.clone())
    }

    fn get_trade_status(&self, o: ::grpc::RequestOptions, p: super::bc::GetOutPointRequest) -> ::grpc::SingleResponse<super::bc::GetTradeStatusResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetTradeStatus.clone())
    }

    fn get_outpoint_status(&self, o: ::grpc::RequestOptions, p: super::bc::GetOutPointRequest) -> ::grpc::SingleResponse<super::bc::GetOutPointStatusResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetOutpointStatus.clone())
    }

    fn get_tx_claimed_by(&self, o: ::grpc::RequestOptions, p: super::bc::GetOutPointRequest) -> ::grpc::SingleResponse<super::core::Transaction> {
        self.grpc_client.call_unary(o, p, self.method_GetTxClaimedBy.clone())
    }

    fn get_raw_mempool(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::GetRawMempoolResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetRawMempool.clone())
    }

    fn get_block_by_tx(&self, o: ::grpc::RequestOptions, p: super::bc::GetTxRequest) -> ::grpc::SingleResponse<super::core::BcBlock> {
        self.grpc_client.call_unary(o, p, self.method_GetBlockByTx.clone())
    }

    fn get_rovered_block_for_marked_tx(&self, o: ::grpc::RequestOptions, p: super::bc::GetMarkedTxRequest) -> ::grpc::SingleResponse<super::core::Block> {
        self.grpc_client.call_unary(o, p, self.method_GetRoveredBlockForMarkedTx.clone())
    }

    fn help(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::HelpResponse> {
        self.grpc_client.call_unary(o, p, self.method_Help.clone())
    }

    fn stats(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::StatsResponse> {
        self.grpc_client.call_unary(o, p, self.method_Stats.clone())
    }

    fn get_settings(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::SettingsResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetSettings.clone())
    }

    fn new_tx(&self, o: ::grpc::RequestOptions, p: super::bc::RpcTransaction) -> ::grpc::SingleResponse<super::bc::RpcTransactionResponse> {
        self.grpc_client.call_unary(o, p, self.method_NewTx.clone())
    }

    fn send_tx(&self, o: ::grpc::RequestOptions, p: super::core::Transaction) -> ::grpc::SingleResponse<super::bc::RpcTransactionResponse> {
        self.grpc_client.call_unary(o, p, self.method_SendTx.clone())
    }

    fn get_balance(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::bc::GetBalanceResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetBalance.clone())
    }

    fn get_wallet(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::core::WalletData> {
        self.grpc_client.call_unary(o, p, self.method_GetWallet.clone())
    }

    fn get_spendable_outpoints(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::core::WalletData> {
        self.grpc_client.call_unary(o, p, self.method_GetSpendableOutpoints.clone())
    }

    fn get_spendable_collateral(&self, o: ::grpc::RequestOptions, p: super::bc::GetSpendableCollateralRequest) -> ::grpc::SingleResponse<super::bc::GetSpendableCollateralResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetSpendableCollateral.clone())
    }

    fn get_unlock_taker_tx_params(&self, o: ::grpc::RequestOptions, p: super::bc::GetUnlockTakerTxParamsRequest) -> ::grpc::SingleResponse<super::bc::GetUnlockTakerTxParamsResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetUnlockTakerTxParams.clone())
    }

    fn get_transfers(&self, o: ::grpc::RequestOptions, p: super::bc::TransferRequest) -> ::grpc::SingleResponse<super::bc::TransferResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetTransfers.clone())
    }

    fn get_open_orders(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::bc::GetOpenOrdersResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetOpenOrders.clone())
    }

    fn get_matched_orders(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::bc::GetMatchedOrdersResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetMatchedOrders.clone())
    }

    fn get_historical_orders(&self, o: ::grpc::RequestOptions, p: super::bc::GetHistoryRequest) -> ::grpc::SingleResponse<super::bc::GetMatchedOrdersResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetHistoricalOrders.clone())
    }

    fn get_unmatched_orders(&self, o: ::grpc::RequestOptions, p: super::bc::GetBalanceRequest) -> ::grpc::SingleResponse<super::bc::GetOpenOrdersResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetUnmatchedOrders.clone())
    }

    fn get_utxo_length(&self, o: ::grpc::RequestOptions, p: super::bc::GetUtxoLengthRequest) -> ::grpc::SingleResponse<super::bc::GetUtxoLengthResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetUTXOLength.clone())
    }

    fn get_stxo_length(&self, o: ::grpc::RequestOptions, p: super::bc::GetUtxoLengthRequest) -> ::grpc::SingleResponse<super::bc::GetUtxoLengthResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetSTXOLength.clone())
    }

    fn get_blake2bl(&self, o: ::grpc::RequestOptions, p: super::bc::GetBlake2blRequest) -> ::grpc::SingleResponse<super::bc::GetBlake2blResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetBlake2bl.clone())
    }

    fn get_bc_address_via_vanity(&self, o: ::grpc::RequestOptions, p: super::bc::VanityConvertRequest) -> ::grpc::SingleResponse<super::bc::VanityConvertResponse> {
        self.grpc_client.call_unary(o, p, self.method_GetBcAddressViaVanity.clone())
    }

    fn get_current_work(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::CurrentWork> {
        self.grpc_client.call_unary(o, p, self.method_GetCurrentWork.clone())
    }

    fn get_sync_status(&self, o: ::grpc::RequestOptions, p: super::core::Null) -> ::grpc::SingleResponse<super::bc::SyncStatus> {
        self.grpc_client.call_unary(o, p, self.method_GetSyncStatus.clone())
    }
}

// server

pub struct BcServer;


impl BcServer {
    pub fn new_service_def<H : Bc + 'static + Sync + Send + 'static>(handler: H) -> ::grpc::rt::ServerServiceDefinition {
        let handler_arc = ::std::sync::Arc::new(handler);
        ::grpc::rt::ServerServiceDefinition::new("/bc.Bc",
            vec![
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetRoveredBlockHash".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_rovered_block_hash(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetRoveredBlockHeight".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_rovered_block_height(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetRoveredBlocks".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_rovered_blocks(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetLatestRoveredBlocks".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_latest_rovered_blocks(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetBlockHash".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_block_hash(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetBlockHeight".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_block_height(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetBlocksHeight".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_blocks_height(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetBlocks".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_blocks(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetLatestBlock".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_latest_block(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetTx".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_tx(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetMarkedTx".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_marked_tx(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetTradeStatus".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_trade_status(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetOutpointStatus".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_outpoint_status(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetTxClaimedBy".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_tx_claimed_by(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetRawMempool".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_raw_mempool(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetBlockByTx".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_block_by_tx(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetRoveredBlockForMarkedTx".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_rovered_block_for_marked_tx(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/Help".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.help(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/Stats".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.stats(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetSettings".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_settings(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/NewTx".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.new_tx(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/SendTx".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.send_tx(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetBalance".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_balance(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetWallet".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_wallet(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetSpendableOutpoints".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_spendable_outpoints(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetSpendableCollateral".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_spendable_collateral(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetUnlockTakerTxParams".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_unlock_taker_tx_params(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetTransfers".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_transfers(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetOpenOrders".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_open_orders(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetMatchedOrders".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_matched_orders(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetHistoricalOrders".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_historical_orders(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetUnmatchedOrders".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_unmatched_orders(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetUTXOLength".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_utxo_length(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetSTXOLength".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_stxo_length(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetBlake2bl".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_blake2bl(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetBcAddressViaVanity".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_bc_address_via_vanity(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetCurrentWork".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_current_work(o, p))
                    },
                ),
                ::grpc::rt::ServerMethod::new(
                    ::std::sync::Arc::new(::grpc::rt::MethodDescriptor {
                        name: "/bc.Bc/GetSyncStatus".to_string(),
                        streaming: ::grpc::rt::GrpcStreaming::Unary,
                        req_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                        resp_marshaller: Box::new(::grpc::protobuf::MarshallerProtobuf),
                    }),
                    {
                        let handler_copy = handler_arc.clone();
                        ::grpc::rt::MethodHandlerUnary::new(move |o, p| handler_copy.get_sync_status(o, p))
                    },
                ),
            ],
        )
    }
}
