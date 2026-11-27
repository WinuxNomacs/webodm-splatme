# The splat node with LichtFeld Studio (GPL-3.0-or-later with its NVIDIA exception: its source is the pinned commit
# below, built by these steps). Its own Ubuntu CI's build (.github/workflows/ubuntu.yml at that commit), PTX-only
# from SM 7.5 so one image runs on RTX 20 to RTX 50, installed with its own install rules; then a second stage with
# only what runs. Build from the repository's root:
#   docker build -f node/lichtfeld.Dockerfile -t splatme-node-lichtfeld:dev node
FROM nvidia/cuda:12.8.2-devel-ubuntu24.04@sha256:7fc48a36965c6d0e5c9717dd899b2851cabb2dfef43d95dd12046a2d40bdc90f AS build

# v0.5.4.3 (2026-11-23); the tag is fetched too, as LichtFeld names its version after it (git describe), or after
# the commit alone
ARG LFS_COMMIT=06c9a040677c0f302dc0e169ff5d5641a9f9c88a
ARG LFS_TAG=v0.5.4.3
# vcpkg's master on 2026-11-24: it must hold every port version LichtFeld's vcpkg.json pins
ARG VCPKG_COMMIT=2f8bf7a5bad48aaef99d80b221fca712f016ab8f

ENV DEBIAN_FRONTEND=noninteractive \
    CC=gcc-14 CXX=g++-14 \
    VCPKG_ROOT=/opt/vcpkg \
    VCPKG_BUILD_TYPE=release \
    VCPKG_FORCE_SYSTEM_BINARIES=1 \
    CMAKE_MAKE_PROGRAM=/usr/bin/ninja \
    CUDA_PATH=/usr/local/cuda

# CMake pinned as its CI pins it (4.4.1 misconfigures ports)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gpg wget \
    && wget -qO - https://apt.kitware.com/keys/kitware-archive-latest.asc | gpg --dearmor - > /usr/share/keyrings/kitware-archive-keyring.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/kitware-archive-keyring.gpg] https://apt.kitware.com/ubuntu/ noble main' > /etc/apt/sources.list.d/kitware.list \
    && apt-get update && apt-get install -y --no-install-recommends git curl unzip \
        cmake=4.4.0-0kitware1ubuntu24.04.1 cmake-data=4.4.0-0kitware1ubuntu24.04.1 \
        gcc-14 g++-14 ninja-build zip tar pkg-config python3 python3-dev python3-venv \
        libxinerama-dev libxcursor-dev xorg-dev libglu1-mesa-dev libwayland-dev libxkbcommon-dev libegl-dev \
        libdecor-0-dev libibus-1.0-dev libdbus-1-dev libsystemd-dev libgtk-3-dev \
        nasm autoconf autoconf-archive automake libtool libvulkan1 \
    && update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-14 100 --slave /usr/bin/g++ g++ /usr/bin/g++-14 \
    && rm -rf /var/lib/apt/lists/*

RUN git clone -q https://github.com/microsoft/vcpkg.git "$VCPKG_ROOT" \
    && git -C "$VCPKG_ROOT" checkout -q "$VCPKG_COMMIT" \
    && "$VCPKG_ROOT/bootstrap-vcpkg.sh" -disableMetrics \
    && printf 'set(VCPKG_BUILD_TYPE release)\n' >> "$VCPKG_ROOT/triplets/x64-linux.cmake"

WORKDIR /src
RUN git init -q . && git fetch -q --depth 1 https://github.com/MrNeRF/LichtFeld-Studio "$LFS_COMMIT" \
        "+refs/tags/$LFS_TAG:refs/tags/$LFS_TAG" \
    && git checkout -q "$LFS_COMMIT" && test "$(git describe --tags)" = "$LFS_TAG" && git submodule update -q --init --recursive --depth 1 \
    && mkdir -p "$VCPKG_ROOT/downloads" && cp .github/vcpkg-downloads/*.patch "$VCPKG_ROOT/downloads/"

RUN python3 tools/ci_retry_configure.py -- cmake -B build -S . -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc \
        -DBUILD_CUDA_PTX_ONLY=ON -DBUILD_CUDA_MIN_SM=75 \
        -DBUILD_PYTHON_STUBS=OFF \
        -DLFS_DEV_IMPORT_SOURCE_PYTHON=OFF -DLFS_DEV_IMPORT_SOURCE_RESOURCES=OFF \
        -DLFS_ENABLE_CUDA_DEVICE_DEBUG=OFF \
    && rm -rf build/vcpkg_installed/vcpkg/blds build/vcpkg_installed/vcpkg/pkgs "$VCPKG_ROOT/buildtrees" "$VCPKG_ROOT/packages"

RUN cmake --build build -j "$(nproc)" --target LichtFeld-Studio

# Its own install rules, then the libraries they leave in the build tree (found with ldd) and CUDA's that it loads;
# not what only building against it needs (headers, a static library, its bundled uv)
RUN cmake --install build --prefix /out/lichtfeld > /dev/null \
    && cp -a build/liblfs_rmlui.so build/Build/lib/libOpenMeshCore.so* build/vcpkg_installed/x64-linux/lib/libvulkan.so* \
        /usr/local/cuda/lib64/libcudart.so.12* /usr/local/cuda/lib64/libcurand.so.10* /usr/local/cuda/lib64/libnvjpeg.so.12* \
        /out/lichtfeld/lib/ \
    && rm -rf /out/lichtfeld/include /out/lichtfeld/lib/*.a /out/lichtfeld/bin/uv \
    && LD_LIBRARY_PATH=/out/lichtfeld/lib ldd /out/lichtfeld/bin/LichtFeld-Studio | grep -v libcuda.so | { ! grep -E "not found|/src/"; }

FROM nvidia/cuda:12.8.2-base-ubuntu24.04@sha256:b382332b575435b081b805b15b3aa1779a350a4e513f4d0449b4d7ad098e94ff
ENV DEBIAN_FRONTEND=noninteractive
# The base image's packages brought up to date (its security fixes), then only what runs: Python for the node,
# and the system libraries LichtFeld links (GTK's, for its file dialogs, brings most of them)
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
        python3 libgtk-3-0t64 libgomp1 libjpeg-turbo8 libxinerama1 libxcursor1 libxrandr2 libxi6 libxkbcommon0 \
        libwayland-client0 libwayland-cursor0 libwayland-egl1 libdbus-1-3 libsystemd0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /opt/
COPY splatnode.py /opt/splatnode/splatnode.py
ENV LD_LIBRARY_PATH=/opt/lichtfeld/lib \
    PYTHONUNBUFFERED=1 \
    SPLATNODE_DATA=/var/splatnode \
    SPLATNODE_TRAINER=/opt/lichtfeld/bin/LichtFeld-Studio \
    SPLATNODE_TRAINER_KIND=lichtfeld \
    SPLATNODE_PORT=3100 \
    CUDA_CACHE_PATH=/var/splatnode/cuda-cache \
    CUDA_CACHE_MAXSIZE=1073741824
# CUDA_CACHE_PATH: LichtFeld's GPU code is built for the GPU it finds (PTX) when it first runs, about 2 minutes; kept
# on the volume, a restart or an upgrade of the same version reuses it (200 MB measured on an RTX 5060)
# The image's own unprivileged user (ubuntu, 1000)
RUN mkdir -p /var/splatnode && chown ubuntu:ubuntu /var/splatnode \
    && LD_LIBRARY_PATH=/opt/lichtfeld/lib ldd /opt/lichtfeld/bin/LichtFeld-Studio | grep -v libcuda.so | { ! grep "not found"; }
USER ubuntu
VOLUME /var/splatnode
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3100/health', timeout=4)"]
CMD ["python3", "/opt/splatnode/splatnode.py"]
