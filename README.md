# RemoteTerm for MeshCore

[![All Quality](https://github.com/statico/remoteterm-meshcore/actions/workflows/all-quality.yml/badge.svg)](https://github.com/statico/remoteterm-meshcore/actions/workflows/all-quality.yml)
[![Docker](https://github.com/statico/remoteterm-meshcore/actions/workflows/docker.yml/badge.svg)](https://github.com/statico/remoteterm-meshcore/actions/workflows/docker.yml)
[![CodeQL](https://github.com/statico/remoteterm-meshcore/actions/workflows/codeql.yml/badge.svg)](https://github.com/statico/remoteterm-meshcore/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/statico/remoteterm-meshcore?logo=github)](https://github.com/statico/remoteterm-meshcore/releases)
[![Container](https://img.shields.io/badge/ghcr.io-statico%2Fremoteterm--meshcore-blue?logo=docker)](https://github.com/statico/remoteterm-meshcore/pkgs/container/remoteterm-meshcore)
[![AUR](https://img.shields.io/aur/version/remoteterm-meshcore-statico?logo=archlinux)](https://aur.archlinux.org/packages/remoteterm-meshcore-statico)
[![License](https://img.shields.io/github/license/statico/remoteterm-meshcore)](LICENSE.md)

> [!NOTE]
> This is a fork of [jkingsman/Remote-Terminal-for-MeshCore](https://github.com/jkingsman/Remote-Terminal-for-MeshCore). The original author is on a [development pause](https://github.com/jkingsman/Remote-Terminal-for-MeshCore/issues/343), so this fork continues the work. The goal is to merge it back into upstream later.

RemoteTerm is a server and web interface for MeshCore mesh radio networks. It connects to a companion radio and gives you a full messaging and management tool in your browser.

![Screenshot of the application's web interface](app_screenshot.png)

## Contents

- [Features](#features)
- [Before you start](#before-you-start)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration](#configuration)
- [Update](#update)
- [More documentation](#more-documentation)
- [Disclaimer](#disclaimer)

## Features

Connect your radio over serial, TCP, or BLE. Then you can:

- Send and receive direct messages (DMs) and channel messages.
- Keep every packet that the radio receives. RemoteTerm decrypts old packets when you add new keys.
- Monitor any number of contacts and channels. The server decrypts packets, so the limits of the radio do not apply.
- Run Python bots that read messages and reply in DMs and channels.
- Use your radio from another computer on your network or VPN.
- Search for hashtag channel names when you do not have their keys yet.
- Send packets, messages, and repeater telemetry to MQTT, Home Assistant, LetsMesh, MeshRank, SQS, and Apprise.
- Use 1.14+ firmware with multibyte paths.
- See the mesh as a map or as a node graph, read repeater statistics, and more.

## Before you start

> [!CAUTION]
> Use RemoteTerm only on a network that you trust. Do not open it to the public internet.

Anyone who can open the app can run Python code on the server through the bots. You have these options to limit access:

- **HTTP Basic auth:** set `MESHCORE_BASIC_AUTH_USERNAME` and `MESHCORE_BASIC_AUTH_PASSWORD`. This is a simple gate for the whole app. Use it only with HTTPS, because Basic auth credentials are not safe on plain HTTP.
- **No bots:** set `MESHCORE_DISABLE_BOTS=true`. The server then runs no bot code and refuses bot configuration changes through the API.
- **A reverse proxy:** for stronger access control, put the app behind a proxy such as Nginx. User accounts and permissions are not part of this app.

The CORS policy of the app accepts all origins. This is a deliberate choice for trusted networks. As a result, Basic auth does not reliably stop JavaScript on other websites from reaching the app.

> [!WARNING]
> RemoteTerm takes full control of the radio. When you connect a radio, RemoteTerm imports all of its contacts and channels. After that, RemoteTerm decides which contacts are stored on the radio. If you often move one radio between different apps, or want the radio to keep its own favorites and channels, RemoteTerm is a poor fit.

## Requirements

- Python 3.11 or later.
- Node.js LTS or current (20, 22, 24, or 25). You do not need Node.js if you use a prebuilt frontend.
- The [uv](https://astral.sh/uv) package manager: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- A MeshCore radio, connected by USB serial, TCP, or BLE.

<details>
<summary>Find your serial port</summary>

```bash
#######
# Linux
#######
ls /dev/ttyUSB* /dev/ttyACM*

#######
# macOS
#######
ls /dev/cu.usbserial-* /dev/cu.usbmodem*

###########
# Windows
###########
# In PowerShell:
Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Caption

######
# WSL2
######
# Run this in an elevated PowerShell (not WSL) window
winget install usbipd
# restart console
# then find device ID
usbipd list
# make device shareable
usbipd bind --busid 3-8 # (or whatever the right ID is)
# attach device to WSL (run this each time you plug in the device)
usbipd attach --wsl --busid 3-8
# device will appear in WSL as /dev/ttyUSB0 or /dev/ttyACM0
```
</details>

## Install

There are three ways to install RemoteTerm:

| Method | Best for |
|--------|----------|
| [Clone and build](#option-1-clone-and-build) | Most users. This is the most reliable method for serial radios. |
| [Docker](#option-2-docker) | Users who already run their services in Docker. |
| [Arch Linux (AUR)](#option-3-arch-linux-aur) | Arch Linux users who want a system package. |

### Option 1: Clone and build

This method is better than Docker for serial radios. Docker has had intermittent serial problems on Linux and other Unix systems.

1. Get the code:

   ```bash
   git clone https://github.com/statico/remoteterm-meshcore.git
   cd remoteterm-meshcore
   ```

2. Install the Python dependencies:

   ```bash
   uv sync
   ```

3. Build the frontend:

   ```bash
   cd frontend && npm install && npm run build && cd ..
   ```

4. Start the server:

   ```bash
   uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

5. Open http://localhost:8000. The API documentation is at http://localhost:8000/docs.

> [!IMPORTANT]
> Do not skip `uv sync`. It creates a `.venv` folder in the checkout and installs all Python dependencies there. RemoteTerm does not use the Python of your distribution or its `apt` and `dnf` packages. You do not need to install `python3-*` system packages, and the PEP 668 "externally-managed-environment" restriction on Debian and Ubuntu does not apply. If `uv run` fails with `ModuleNotFoundError: No module named 'meshcore'`, read [README_ADVANCED.md](README_ADVANCED.md#modulenotfounderror-no-module-named-meshcore).

**Use a prebuilt frontend.** On small hardware, you can download a prebuilt frontend instead of step 3. From the checkout, run `python3 scripts/setup/fetch_prebuilt_frontend.py`. The script unpacks the frontend into `frontend/prebuilt`. Then start the server as usual. A checkout that you build yourself uses `frontend/dist`.

**Run as a service on Linux.** To start RemoteTerm at boot and restart it after a crash, install it as a `systemd` service:

```bash
bash scripts/setup/install_service.sh
```

For more about the service, read [README_ADVANCED.md](README_ADVANCED.md).

### Option 2: Docker

> [!WARNING]
> Some users have reported intermittent problems with serial events in Docker. Option 1 is more reliable.

Some facts to know before you start:

- **Serial radios need rootful Docker.** Rootless Docker can fail to map serial devices, even when the compose file is correct. Usually this means that you run `sudo docker compose ...`.
- **BLE needs more work.** The setup script can collect BLE settings, but BLE in Docker also needs Bluetooth passthrough. It can also need privileged mode or host networking. For BLE, Option 1 is simpler.
- **Local builds match your CPU.** On Apple Silicon Macs and ARM64 Linux hosts such as a Raspberry Pi, `docker compose build` makes an ARM64 image unless you set a different platform.

1. Make a `docker-compose.yml` file. Do one of these:

   - Copy the example file, then edit it:

     ```bash
     cp docker-compose.example.yml docker-compose.yml
     ```

   - Or answer the questions of the setup script:

     ```bash
     bash scripts/setup/install_docker.sh
     ```

     By default, the script turns on HTTPS with a self-signed ("snakeoil") certificate. It adds the certificate mounts and an SSL command to the compose file. If you want plain HTTP, or if TLS ends at another server, refuse this option.

2. Edit `docker-compose.yml` for your radio connection.

3. Start the container:

   ```bash
   sudo docker compose up
   ```

4. When the app works, stop it and start it again in the background:

   ```bash
   sudo docker compose up -d
   ```

To stop the container:

```bash
sudo docker compose down
```

Notes:

- Git ignores your `docker-compose.yml`, so a `git pull` does not overwrite it.
- The database is in `./data/`, which is a bind mount. The container and a native install can use the same database.
- The container runs as root by default, because this works with the most serial setups. On Linux, this can make `./data` owned by root if you change between Docker and native runs. If you do not need root for serial access, enable the `user: "${UID:-1000}:${GID:-1000}"` line in `docker-compose.yml`.

**Build the image yourself.** The example file and the setup script use the published image from GHCR. To build from your checkout instead, replace this line:

```yaml
image: ghcr.io/statico/remoteterm-meshcore:latest
```

with this line:

```yaml
build: .
```

Then build and start the container:

```bash
sudo docker compose up -d --build
```

### Option 3: Arch Linux (AUR)

The AUR has a [`remoteterm-meshcore-statico`](https://aur.archlinux.org/packages/remoteterm-meshcore-statico) package. It conflicts with the upstream `remoteterm-meshcore` package. If you have the upstream package, remove it first.

1. Install the package with an AUR helper, or build it manually:

   ```bash
   # with an AUR helper
   yay -S remoteterm-meshcore-statico

   # or manually
   git clone https://aur.archlinux.org/remoteterm-meshcore-statico.git
   cd remoteterm-meshcore-statico
   makepkg -si
   ```

2. Configure the radio connection:

   ```bash
   sudo vi /etc/remoteterm-meshcore/remoteterm.env
   ```

3. Start the service:

   ```bash
   sudo systemctl enable --now remoteterm-meshcore
   ```

4. Open http://localhost:8000.

## Configuration

You configure RemoteTerm with environment variables. Use only one radio connection type: serial, TCP, or BLE. If you set more than one, the server does not start.

| Variable | Default | Description |
|----------|---------|-------------|
| `MESHCORE_SERIAL_PORT` | (auto-detect) | Serial port path. |
| `MESHCORE_SERIAL_BAUDRATE` | 115200 | Serial baud rate. |
| `MESHCORE_TCP_HOST` | | TCP host. Do not use with serial or BLE. |
| `MESHCORE_TCP_PORT` | 5000 | TCP port. |
| `MESHCORE_BLE_ADDRESS` | | BLE device address. Do not use with serial or TCP. |
| `MESHCORE_BLE_PIN` | | BLE PIN. Required when you set `MESHCORE_BLE_ADDRESS`. |
| `MESHCORE_LOG_LEVEL` | INFO | `DEBUG`, `INFO`, `WARNING`, or `ERROR`. |
| `MESHCORE_DATABASE_PATH` | `data/meshcore.db` | Path of the SQLite database. |
| `MESHCORE_DISABLE_BOTS` | false | Turns off the bot system. No bot code runs, and the API refuses bot configuration changes. Basic auth gives better protection. |
| `MESHCORE_BASIC_AUTH_USERNAME` | | Username for HTTP Basic auth on the whole app. Set it together with `MESHCORE_BASIC_AUTH_PASSWORD`. |
| `MESHCORE_BASIC_AUTH_PASSWORD` | | Password for HTTP Basic auth on the whole app. Set it together with `MESHCORE_BASIC_AUTH_USERNAME`. |
| `MESHCORE_VAPID_SUBJECT` | `mailto:noreply@meshcore.local` | Contact for Web Push (the VAPID `sub` claim). It must start with `mailto:` or `https:`. Apple rejects the `.local` default, so for iOS and Safari, set a real address, for example `mailto:you@example.com`. |

Examples:

```bash
# Serial (explicit port)
MESHCORE_SERIAL_PORT=/dev/ttyUSB0 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# TCP
MESHCORE_TCP_HOST=192.168.1.100 MESHCORE_TCP_PORT=5000 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# BLE
MESHCORE_BLE_ADDRESS=AA:BB:CC:DD:EE:FF MESHCORE_BLE_PIN=123456 uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

In Windows PowerShell, set the variable in a separate statement:

```powershell
$env:MESHCORE_SERIAL_PORT="COM8" # or your COM port
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

> [!WARNING]
> **Windows and MQTT:** if you use an MQTT integration on Windows, add `--loop none` to the uvicorn command. The default Windows event loop (ProactorEventLoop) does not work with the MQTT libraries.
>
> ```powershell
> uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --loop none
> ```
>
> Without this option, the app starts, but MQTT connections fail. The app then shows a message with this same fix.

## Update

Update RemoteTerm in place. Do not reinstall it from the start.

Your data is in one SQLite file at `MESHCORE_DATABASE_PATH`. By default this is `data/meshcore.db`. For the AUR package, it is `/var/lib/remoteterm-meshcore/meshcore.db`. The app upgrades the database schema automatically when it starts.

1. Stop the app.
2. Make a backup copy of the database file.
3. Do the steps for your install method below.

**Clone and build:**

```bash
cd remoteterm-meshcore
git pull
uv sync
cd frontend && npm install && npm run build && cd ..
```

If you use the prebuilt frontend, run `python3 scripts/setup/fetch_prebuilt_frontend.py` instead of the `frontend` step. Then start the app again. If you installed the `systemd` service, run `sudo systemctl restart remoteterm`.

**Docker:**

```bash
sudo docker compose pull
sudo docker compose up -d
```

The `./data` bind mount stays, so the database is safe. If you build the image yourself (`build: .`), run `sudo docker compose up -d --build` instead. The `pull` command only gets published images.

**Arch Linux (AUR):**

```bash
# with an AUR helper
yay -Syu remoteterm-meshcore-statico

# or manually, from your checkout of the AUR repo
git pull
makepkg -si
sudo systemctl restart remoteterm-meshcore
```

Package upgrades do not change the database in `/var/lib/remoteterm-meshcore/`.

## More documentation

- [README_ADVANCED.md](README_ADVANCED.md): advanced setup, troubleshooting, HTTPS, `systemd`, remediation variables, and debug logs.
- [README_HA.md](README_HA.md): Home Assistant setup and the names of entities and sensors.
- [CONTRIBUTING.md](CONTRIBUTING.md): how to contribute, with tests, linting, end-to-end tests, and the important `AGENTS.md` files.
- http://localhost:8000/docs: the live API documentation, when the server runs.

## Disclaimer

RemoteTerm comes with no warranty of fitness for any purpose. An engineer who cares about clean code and good tests guides the work, but most of the code comes from AI agents. You can find bugs.

If you use an AI agent to extend RemoteTerm, give it the three `AGENTS.md` files first: `./AGENTS.md`, `./frontend/AGENTS.md`, and `./app/AGENTS.md`.
