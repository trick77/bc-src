# README.md

Mining on Block Collider's blockchain with LG's CUDA RPC miner in a Docker container.

Important reminder: If something doesn't work, don't complain about it. Analyze it, fix it, improve it, submit a pull request.

## Prerequisites
1. Linux-capable x86_64 PC with at least 10 GB RAM
    1. It doesn't need a fast CPU but something faster than an Atom/Celeron may be required for low latency rovering.
    1. SSD always helps.
1. At least one CUDA compatible Nvidia GPU.
1. Preferably a low latency Internet connection.
1. Some basic Linux skills.

## Installation
In a nutshell:
1. Install Debian 10 Buster as the host OS.
1. Install Docker from https://docs.docker.com/install/linux/docker-ce/debian/
1. Install Nvidia's CUDA Drivers from https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&target_distro=Ubuntu&target_version=1804 
    1. Use the **runfile** installer type and installation instructions.
1. Install https://github.com/NVIDIA/nvidia-docker
1. This might be a good time for a system reboot.
1. Build the Docker image locally (don't rely on updated Dockerhub images)
    1. git clone -b cuda-miner https://github.com/trick77/bc-src
    2. cd ./bc-src/cuda-miner/docker && docker build --no-cache -t trick77/bcnode-gpu .
    3. Waiiiiiiit for it...
1. **Only** if the image build was a success, start the container with the provided start-gpu.sh from this directory (it might download an outdated version from Dockerhub otherwise)

Gotchas:
1. Watch for errors if sudo is not installed. While sudo is not required it's contained in some of the manual installation instructions.
2. Using --no-cache will always restart the image build from scratch when rebuilding the image but makes sure you will always get the latest sources. Remove --no-cache only if you know what you're doing.
3. The provided start script will output if Docker is able to find a compatible GPU on the host. If the output doesn't show any compatible GPU, you have to fix this first.
4. You didn't read this README.

## Tips & tricks

* To show what the miner is currently doing use ```docker logs -f bcnode --tail 100```, abort the output with CTRL-C (this will not terminate the miner)
* Kill a currently running bcnode container with ````docker rm -f bcnode````
* Use ```docker volume rm db``` to get rid of the blockchain database and start syncing from scratch. You obviously want to do this when the bcnode container is not currently running.
    * The named volume will only be created if the provided start script was used.