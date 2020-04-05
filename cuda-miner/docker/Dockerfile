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
RUN mkdir -p /var/local/git/grpc/build && cd /var/local/git/grpc/build && cmake .. && make && make install
ENV PATH="/var/local/git/grpc/build:${PATH}"

# Compile LG's CUDA grpc miner
ARG BRANCH_NAME=cuda-miner
RUN git clone -b ${BRANCH_NAME} https://github.com/trick77/bc-src /var/local/git/bc-src && \
    cd /var/local/git/bc-src/cuda-miner
#COPY ./Makefile /var/local/git/bc-src/cuda-miner/Makefile
RUN cd /var/local/git/bc-src/cuda-miner/src && make -f ../Makefile

# ------------------------------------------------------------------------------
FROM nvidia/cuda:10.0-cudnn7-devel-ubuntu18.04

# Install required packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      git \
      libssl-dev \
      python3 && \
      apt-get clean && rm -rf /var/lib/apt/lists

# Install node
RUN curl -sL https://deb.nodesource.com/setup_10.x | bash - && apt-get install -y nodejs

# Install yarn
ENV YARN_VERSION=1.21.1
RUN curl -o- -L https://yarnpkg.com/install.sh | bash -s -- --version ${YARN_VERSION}
ENV PATH="/root/.yarn/bin:/root/.config/yarn/global/node_modules/.bin:${PATH}"
RUN yarn global add node-gyp

# Copy grpc libraries from builder image to /usr/local/lib
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /usr/local/lib /usr/local/lib
COPY --from=builder /var/local/git/grpc/build/*.a /usr/local/lib/

# Clone master branch of bc-src
RUN git clone https://github.com/trick77/bc-src /bc && \
    mkdir -p /bc/_data /bc/_logs /bc/config && \
    cd /bc && rm -rf .git && \
    yarn

WORKDIR /bc

# Copy miner binary from the builder image
COPY --from=builder /var/local/git/bc-src/cuda-miner/src/miner ./

# Make sure miner finds CUDA libraries
ENV LD_LIBRARY_PATH="/usr/local/lib:/usr/local/cuda/lib64:/usr/local/cuda/compat:${LD_LIBRARY_PATH}"

# Custom entrypoint
COPY docker-entrypoint.sh /

VOLUME /bc/config
VOLUME /bc/_data
VOLUME /bc/_logs

EXPOSE 3000 3001 16060 16061 36060 36061

ENTRYPOINT [ "/docker-entrypoint.sh" ]
