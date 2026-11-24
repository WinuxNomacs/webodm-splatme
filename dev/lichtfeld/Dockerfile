# LichtFeld Studio, headless, for the trainer spike (upcoming-changes.md, "19. Other trainers"): the steps of its
# own Ubuntu CI (.github/workflows/ubuntu.yml at the pinned commit), built PTX-only from SM 7.5 so one image runs on
# RTX 20 to RTX 50. A spike image: one stage, not slimmed. Build:
#   docker build -t splatme-lichtfeld:spike dev/lichtfeld
FROM nvidia/cuda:12.8.0-devel-ubuntu24.04@sha256:9a8fffc32a955361aa66d754e7a0cda2513052eaf5aaf8f3ba69b80578d1c6a9

# v0.5.4.3 (2026-11-23)
ARG LFS_COMMIT=06c9a040677c0f302dc0e169ff5d5641a9f9c88a
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
    && git checkout -q FETCH_HEAD && git submodule update -q --init --recursive --depth 1 \
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

ENTRYPOINT ["/src/build/LichtFeld-Studio"]
