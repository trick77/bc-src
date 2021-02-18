from concurrent import futures
import time
from copy import deepcopy
import secrets

import grpc
from google.protobuf import json_format
from .grpc.miner_pb2_grpc import MinerStub, MinerServicer, add_MinerServicer_to_server
from .grpc.miner_pb2 import MinerRequest, MinerResponse, MinerResponseResult

from .example_block import example_block

from jsonrpcserver import method
from jsonrpcserver.server import RequestHandler

from collections import OrderedDict
from threading import Lock

from http.server import HTTPServer
from concurrent.futures import ThreadPoolExecutor as TPE
from concurrent.futures import ProcessPoolExecutor as PPE

#we will use this cache for work ids to mark completion
lru_lock = Lock()
class LRUCache:
    def __init__(self, capacity: int):
        self.cache = OrderedDict()
        self.capacity = capacity
    # returns completion state of workid
    # if not present the work is not completed
    def get(self, key: str) -> bool:
        with lru_lock:
            if key not in self.cache:
                return False
            else:
                self.cache.move_to_end(key)
                return self.cache[key]

    def put(self, key: str) -> None:
        with lru_lock:
            self.cache[key] = True # put means work is completed
            self.cache.move_to_end(key)
            if len(self.cache) > self.capacity:
                self.cache.popitem(last = False)
check_work_completed = LRUCache(capacity=200)

class QuietRequestHandler(RequestHandler):
    def log_request(self, format, *args):
        return

# global state classes (ick)
gbl_workstate_lock = Lock()
class WorkState:
    def __init__(self):
        self.work_id = None
        self.number = None
        self.miner_key = None
        self.work = None
        self.merkle_root = None
        self.difficulty = None
        self.timestamp = None
        self.last_block_hash = None

gbl_solstate_lock = Lock()
class SolutionState:
    def __init__(self):
        self.work_id = None
        self.nonce = None
        self.difficulty = None
        self.distance = None
        self.timestamp = None
        self.iterations = None
        self.time_diff = None

@method
def ol_getWork():
    lcl_workstate = WorkState()
    lcl_workstate.__dict__.update(gbl_workstate.__dict__)
    done = check_work_completed.get(lcl_workstate.work_id) 
    return [lcl_workstate.work, lcl_workstate.merkle_root, lcl_workstate.difficulty,
            str(lcl_workstate.number), lcl_workstate.work_id, lcl_workstate.miner_key,
            str(lcl_workstate.timestamp), lcl_workstate.last_block_hash, str(done)]

@method
def ol_submitWork(work_id, nonce, difficulty, distance, timestamp, iterations, time_diff):
    print("called ol_submitWork")
    lcl_solstate = SolutionState()
    lcl_solstate.work_id = work_id
    lcl_solstate.nonce = nonce
    lcl_solstate.difficulty = difficulty
    lcl_solstate.distance = distance
    lcl_solstate.timestamp = int(timestamp)
    lcl_solstate.iterations = int(iterations)
    lcl_solstate.time_diff = int(time_diff)
    if lcl_solstate.work_id == gbl_workstate.work_id:
        with gbl_solstate_lock:
            gbl_solstate.__dict__.update(lcl_solstate.__dict__)
    return True

gbl_workstate = WorkState()
gbl_solstate = SolutionState()

null_resp = MinerResponse(result=MinerResponseResult.Canceled,
                          nonce='0',
                          difficulty='0',
                          distance='0',
                          timestamp=0,
                          iterations=0,
                          time_diff=0)

class MinerFanoutServicer(MinerServicer):
    def __init__(self):
        super(MinerFanoutServicer, self).__init__()

    def Mine(self, request, context):
        print('got:', request.work_id, request.difficulty, context)

        if request.work_id != gbl_workstate.work_id:
            print('updating work to', request.work_id)
            lcl_workstate = WorkState()
            lcl_workstate.work_id = request.work_id
            lcl_workstate.number = request.last_previous_block.height + 1
            lcl_workstate.miner_key = request.miner_key
            lcl_workstate.work = request.work
            lcl_workstate.merkle_root = request.merkle_root
            lcl_workstate.timestamp = request.current_timestamp
            lcl_workstate.difficulty = request.difficulty
            lcl_workstate.last_block_hash = request.last_previous_block.hash
            with gbl_workstate_lock:
                gbl_workstate.__dict__.update(lcl_workstate.__dict__)
            
        lcl_solstate = SolutionState()
        lcl_solstate.work_id = request.work_id
        lcl_solstate.distance = '0'
        gbl_work_id = request.work_id
        gbl_diff = None
        while True:
            gbl_work_id = gbl_workstate.work_id
            gbl_diff = gbl_workstate.difficulty
            lcl_solstate.__dict__.update(gbl_solstate.__dict__)
            if request.work_id != gbl_work_id:
                print('break new work id')
                break
            if (lcl_solstate.work_id is not None and
                gbl_work_id is not None and 
                lcl_solstate.work_id == gbl_work_id and
                lcl_solstate.distance is not None and
                gbl_diff is not None and
                int(lcl_solstate.distance) >= int(gbl_diff)):
                print('solution dist / diff ->', lcl_solstate.distance, gbl_diff)
                print('break difficulty')
                break
            time.sleep(0.001)

        check_work_completed.put(request.work_id)
        
        # if another request has updated work kill this one
        if request.work_id != gbl_work_id:
            print('solution for stale work ->', request.work_id)
            return null_resp

        # only accept pertinent work but don't die if we receive
        # work from another block
        return MinerResponse(result=MinerResponseResult.Ok,
                             nonce=lcl_solstate.nonce,
                             difficulty=lcl_solstate.difficulty,
                             distance=lcl_solstate.distance,
                             timestamp=lcl_solstate.timestamp,
                             iterations=lcl_solstate.iterations,
                             time_diff=lcl_solstate.time_diff)

def server_process(bind_ip, bc_port, api_port):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    add_MinerServicer_to_server(MinerFanoutServicer(), server)
    server.add_insecure_port(f'{bind_ip}:{bc_port}')
    server.start()
    print(f'{bind_ip}:{bc_port} started:', server)
    httpd = HTTPServer((bind_ip, api_port), QuietRequestHandler)
    print(f'{bind_ip}:{api_port} started', httpd)
    httpd.serve_forever()
    server.wait_for_termination()

class grpc_reformatter(object):
    def __init__(self, bind_ip, bc_port=50052, api_port=3001):
        self.bind_ip = bind_ip
        self.bc_port = bc_port
        self.api_port = api_port
        self.server_exe = None
        self.server = None

    def start_server(self):
        if self.server is not None:
            raise Exception('bcfanout server already running!')

        self.server_exe = PPE(max_workers=1)
        self.server = self.server_exe.submit(server_process,
                                             self.bind_ip,
                                             self.bc_port,
                                             self.api_port)

    def wait_on_server(self):
        self.server.result()
        
    def test(self):
        req = MinerRequest()
        json_format.Parse(example_block,req)
        print(req)
        time.sleep(0.5)
        ip = self.bind_ip
        port = self.bc_port
        exe = TPE(max_workers = 10)
        def submit_work(ip, port, request):
            with grpc.insecure_channel(f'{ip}:{port}') as ch:
                stub = MinerStub(ch)
                resp = stub.Mine(request)
                print('response:', resp)
        i = 0
        start_height = req.last_previous_block.height
        while True:
            req.work_id = str(i)
            req.work = secrets.token_hex(32)
            req.last_previous_block.height = start_height + i
            i+=1
            exe.submit(submit_work, ip, port, req)
            time.sleep(5)
        exit()
