#!/bin/sh
# Startup prelude: hand /data to the runtime user, then become the server.
#
# Why this exists (0.1.2): the Supervisor bind-mounts its own /data over the
# directory the Dockerfile creates, so the `chown node:node /data` done at build
# time is invisible at runtime. On the first real install (HAOS, aarch64, 0.1.1)
# /data arrived owned by root:root while the server runs as uid 1000, and the
# process died before it could listen:
#
#   startup_failed reason=dir_readonly "data directory /data is not writable by this user"
#
# So the image starts as root, fixes the ownership, and drops privileges before
# exec'ing the server. What runs the server is still uid 1000 -- that is what the
# D2 Dockerfile rule and the image assertions check.
#
# gosu rather than su: `su` forks and leaves a root PID 1, which swallows SIGTERM
# and would break the 8 s drain budget this image is built around. `exec gosu`
# replaces this shell, so the server itself is PID 1 and receives the signal.

set -eu

if [ -d /data ]; then
  # Short-circuit the common case: on a second start /data is already owned by
  # node, so the recursive walk is skipped entirely.
  owner=$(stat -c %u /data 2>/dev/null || echo 0)
  if [ "$owner" != "1000" ]; then
    if ! chown -R node:node /data; then
      # Same one-line JSON and the same exit code the server uses for a data
      # directory it cannot write: one contract, two enforcers.
      printf '%s\n' '{"level":"error","event":"startup_failed","reason":"dir_readonly","exitCode":78,"msg":"/data could not be handed to node"}'
      exit 78
    fi
  fi
fi

exec gosu node "$@"
