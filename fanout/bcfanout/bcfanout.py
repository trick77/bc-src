from concurrent import futures

import grpc
from .grpc.miner_pb2_grpc import MinerStub, MinerServicer, add_MinerServicer_to_server
from .grpc.miner_pb2 import MinerRequest, MinerResponse, MinerResponseResult

TPE = futures.ThreadPoolExecutor
PPE = futures.ProcessPoolExecutor

class MinerFanoutServicer(MinerServicer):
    def __init__(self, start_port, miners):
        super(MinerFanoutServicer, self).__init__()
        self.start_port = start_port
        self.miners = miners

    def Mine(self, request, context):
        print('got:', request, context)
        exe =TPE(max_workers = len(self.miners) + 1)

        def forward(request, miner, port):
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

        responses = []
        for i, miner in enumerate(self.miners):
            port = self.start_port + i
            responses.append(exe.submit(forward, request, miner, port))

        print('responses:', responses)

        best_response = None
        for response in responses:
            resp = response.result()
            best = 0 if best_response is None else int(best_response.distance)            
            if best_response is None or best < int(resp.distance):
                best_response = resp
        
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
        ip = self.bind_ip
        port = self.bcport
        for i in range(10):
            with grpc.insecure_channel(f'{ip}:{port}') as ch:
                stub = MinerStub(ch)
                resp = stub.Mine(req)
                print('response:', resp)            
