#!/bin/bash

# Don't use set -e: x11vnc and other services may fail transiently
# and we still want the worker to start

# Clean up stale X lock files from previous runs/restarts
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true

# Start Xvfb (virtual framebuffer)
Xvfb :99 -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH} -ac &

# Wait for Xvfb to be ready
for i in $(seq 1 10); do
    if xdpyinfo -display :99 >/dev/null 2>&1; then
        echo "Xvfb is ready"
        break
    fi
    echo "Waiting for Xvfb... ($i/10)"
    sleep 1
done

# Start fluxbox window manager
fluxbox &
sleep 1

# Start VNC server (no password for easy live viewing access)
x11vnc -display :99 -rfbport ${VNC_PORT} -nopw -forever -shared -bg || echo "Warning: x11vnc failed to start (non-fatal)"

# Start websockify (WebSocket to VNC bridge)
websockify --web=/usr/share/novnc ${WEBSOCKIFY_PORT} localhost:${VNC_PORT} &

echo "VNC server started on port ${VNC_PORT}"
echo "WebSocket bridge started on port ${WEBSOCKIFY_PORT}"

# Check if we should start in worker mode or standalone
if [ "$MODE" = "worker" ]; then
    echo "Starting BullMQ worker..."
    exec node /app/packages/executor/dist/worker.js
else
    echo "Starting in standalone mode..."
    # Keep container running
    tail -f /dev/null
fi
