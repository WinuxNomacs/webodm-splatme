# The splat node: OpenSplat built for CUDA 12.8 (RTX 20 to RTX 50 series, GTX 16) and the job service around it.
# The first stage compiles; the second holds only what runs. Everything fetched is pinned: the base images by
# digest, OpenSplat by commit, libtorch by checksum. Upgrading one is a change to this file, rebuilt and tested.
FROM nvidia/cuda:12.8.2-devel-ubuntu24.04@sha256:7fc48a36965c6d0e5c9717dd899b2851cabb2dfef43d95dd12046a2d40bdc90f AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git ninja-build libopencv-dev unzip wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /code

# libtorch 2.7.1 for CUDA 12.8, the first to support the RTX 50 series; it brings its own cuDNN and cuBLAS
ARG LIBTORCH_URL=https://download.pytorch.org/libtorch/cu128/libtorch-cxx11-abi-shared-with-deps-2.7.1%2Bcu128.zip
ARG LIBTORCH_SHA256=ae513b437ae99150744ef1d06b02a4ecbbb9275c9ffe540c88909623e3293041
RUN wget -nv "$LIBTORCH_URL" -O libtorch.zip
RUN sum="$(sha256sum libtorch.zip | cut -d' ' -f1)" \
    && if [ "$sum" != "$LIBTORCH_SHA256" ]; then echo "libtorch.zip: sha256 $sum, expected $LIBTORCH_SHA256"; exit 1; fi \
    && unzip -q libtorch.zip && rm libtorch.zip

# OpenSplat v1.2.2, two commits on: a photo that cannot be decoded fails the training instead of stalling it
ARG OPENSPLAT_COMMIT=e33f9dde8ef9c9d59852ffe4d12e0adddcf1fc1b
RUN git init -q src && cd src \
    && git fetch -q --depth 1 https://github.com/WebODM/OpenSplat "$OPENSPLAT_COMMIT" \
    && git checkout -q FETCH_HEAD
RUN cmake -S src -B build -GNinja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=/code/libtorch \
        -DCMAKE_CUDA_ARCHITECTURES="75;80;86;89;120" \
    && ninja -C build opensplat
# The shared libraries only (not the static ones, the headers or the Python bindings)
RUN mkdir -p /out/libtorch/lib /out/opensplat \
    && cp -a libtorch/lib/*.so* /out/libtorch/lib/ && rm -f /out/libtorch/lib/libtorch_python.so \
    && cp build/opensplat /out/opensplat/ && cp src/LICENSE.txt /out/opensplat/

FROM nvidia/cuda:12.8.2-base-ubuntu24.04@sha256:b382332b575435b081b805b15b3aa1779a350a4e513f4d0449b4d7ad098e94ff
ENV DEBIAN_FRONTEND=noninteractive
# The base image's packages brought up to date (its security fixes), then only what runs
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
        python3 libopencv-core406t64 libopencv-imgproc406t64 libopencv-imgcodecs406t64 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /opt/
COPY splatnode.py /opt/splatnode/splatnode.py
ENV LD_LIBRARY_PATH=/opt/libtorch/lib \
    PYTHONUNBUFFERED=1 \
    SPLATNODE_DATA=/var/splatnode \
    SPLATNODE_TRAINER=/opt/opensplat/opensplat \
    SPLATNODE_PORT=3100
# The image's own unprivileged user (ubuntu, 1000)
RUN mkdir -p /var/splatnode && chown ubuntu:ubuntu /var/splatnode
USER ubuntu
VOLUME /var/splatnode
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3100/health', timeout=4)"]
CMD ["python3", "/opt/splatnode/splatnode.py"]
