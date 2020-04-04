FROM nvidia/cuda:10.0-cudnn7-devel-ubuntu18.04 AS builder

# Get basic packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      apt-utils \
      autoconf \
      automake \
      build-essential \
      curl \
      wget \
      git \
      python3 \
      python3-dev \
      python3-pip \
      python3-wheel \
      python3-numpy \
      ca-certificates \
      golang \
      nano \
      cmake \
      libboost-all-dev \
      libtool \
      libprotobuf-dev \
      protobuf-compiler \
      locales \
      pkg-config \
      unzip

# Fetch grpc
ARG GRPC_RELEASE=1.24.2
RUN git clone -b v${GRPC_RELEASE} https://github.com/grpc/grpc /var/local/git/grpc && \
    cd /var/local/git/grpc && \
    git submodule update --init --recursive
RUN mkdir -p /var/local/git/grpc/build && cd /var/local/git/grpc/build && cmake -DBUILD_SHARED_LIBS=ON .. && make install
ENV PATH="/var/local/git/grpc/build:${PATH}"

# Compile LG's CUDA grpc miner
ARG BRANCH_NAME=cuda-miner
RUN git clone -b ${BRANCH_NAME} https://github.com/trick77/bc-src /var/local/git/bc-src && \
    cd /var/local/git/bc-src/cuda-miner
#COPY ./Makefile /var/local/git/bc-src/cuda-miner/Makefile
RUN cd /var/local/git/bc-src/cuda-miner/src && make -f ../Makefile

FROM nvidia/cuda:10.0-cudnn7-devel-ubuntu18.04

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      git \
      python3 &&\
      apt-get clean && rm -rf /var/lib/apt/lists

# Install yarn
RUN curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
RUN echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
RUN apt-get update && apt-get install -y yarn

# Install nvm/node
ARG NVM_VERSION=0.35.3
ARG NODE_VERSION=10.19.0
ENV NVM_DIR=/usr/local/nvm
RUN mkdir -p ${NVM_DIR} && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v${NVM_VERSION}/install.sh | bash && \
    . ${NVM_DIR}/nvm.sh &&\
    nvm install ${NODE_VERSION} &&\
    nvm alias default ${NODE_VERSION} &&\
    nvm use default

ENV NODE_PATH="${NVM_DIR}/versions/node/${NODE_VERSION}/lib/node_modules"
ENV PATH="${NVM_DIR}/versions/node/${NODE_VERSION}/bin:${PATH}"

RUN git clone https://github.com/trick77/bc-src /bc && \
    mkdir -p /bc/_data /bc/_logs /bc/config

WORKDIR /bc
COPY --from=builder /var/local/git/bc-src/cuda-miner ./
RUN yarn global add node-gyp && \
    yarn

VOLUME /bc/config
VOLUME /bc/_data
VOLUME /bc/_debug
VOLUME /bc/_logs

EXPOSE 3000 3001 16060 16061 36060 36061

ENTRYPOINT [ "./bin/cli" ]
