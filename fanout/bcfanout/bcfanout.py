from concurrent import futures
import time

import grpc
from .grpc.miner_pb2_grpc import MinerStub, MinerServicer, add_MinerServicer_to_server
from .grpc.miner_pb2 import MinerRequest, MinerResponse, MinerResponseResult

TPE = futures.ThreadPoolExecutor
PPE = futures.ProcessPoolExecutor

def forward(request, context, miner, port):
    with grpc.insecure_channel(f'{miner}:{port}') as ch:
        print('forwarding', request, f'to {miner}:{port}')
        stub = MinerStub(ch)
        resp = None
        try:
            resp = stub.Mine(request)
        except Exception as e:
            print(e)
            resp = MinerResponse(result=MinerResponseResult.Error, distance='0')
        return resp

class MinerFanoutServicer(MinerServicer):
    def __init__(self, start_port, miners):
        super(MinerFanoutServicer, self).__init__()
        self.start_port = start_port
        self.miners = miners

    def Mine(self, request, context):
        print('got:', request, context)
        tic = time.monotonic()
        exe = TPE(max_workers = len(self.miners) + 1)

        responses = []
        for i, miner in enumerate(self.miners):
            port = self.start_port + i
            responses.append(exe.submit(forward, request, context, miner, port))

        print('responses:', responses)

        best_response = None
        total_iters = 0
        for response in responses:
            resp = response.result()
            best = 0 if best_response is None else int(best_response.distance)
            total_iters += resp.iterations
            if best_response is None or best < int(resp.distance):
                best_response = resp

        best_response.iterations = total_iters
        toc = time.monotonic()
        dtime = toc - tic
        hashrate = total_iters / dtime
        print(f'Completed mining request with a hash rate of: {hashrate} H/s')
                
        return best_response
        
def server_process(bind_ip, bcport, miners, start_port):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    add_MinerServicer_to_server(MinerFanoutServicer(start_port, miners), server)
    server.add_insecure_port(f'{bind_ip}:{bcport}')
    server.start()
    print(f'{bind_ip}:{bcport} started:', server)
    server.wait_for_termination()

class Fanout(object):
    def __init__(self, bind_ip, fanout_ips, bcport=50052, fanout_port_start=50053):
        self.bind_ip = bind_ip
        self.fanout_ips = fanout_ips
        self.bcport = bcport
        self.fanout_port_start = fanout_port_start
        self.server_exe = None
        self.server = None

    def start_server(self):
        if self.server is not None:
            raise Exception('bcfanout server already running!')

        self.server_exe = PPE(max_workers=1)
        self.server = self.server_exe.submit(server_process,
                                             self.bind_ip,
                                             self.bcport,
                                             self.fanout_ips,
                                             self.fanout_port_start)

    def wait_on_server(self):
        self.server.result()
        
    def test(self):
        req = MinerRequest()
        req.work = "7ca44f0c6f416240157a7d9067802269a64ab5503bd11970e3130d36e75ab815"
        req.miner_key = "0xf34fa87db39d15471bebe997860dcd49fc259318"
        req.merkle_root = "d1dde6972fa183f1b9ca2c0ee2d6d87656be16db28c7d6cc3c5086eb7fda8fe5"
        req.difficulty = "298874869807223"
        req.current_timestamp = 1585772256
        print(req)
        ip = self.bind_ip
        port = self.bcport
        exe = TPE(max_workers = 10)
        def submit_work(ip, port):
            with grpc.insecure_channel(f'{ip}:{port}') as ch:
                stub = MinerStub(ch)
                resp = stub.Mine(req)
                print('response:', resp)
        while True:
            exe.submit(submit_work, ip, port)
            time.sleep(5)
        exit()
