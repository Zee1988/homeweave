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

# 0.1.3: the fast path used to look only at /data itself, and that was wrong. The
# Supervisor rewrites /data/options.json as root:root 0600 every time an option is
# changed (and does not restart the app when it does). After the first install, /data
# is already uid 1000, so the recursive chown was skipped and the file stayed
# unreadable forever -- the app fell back to defaults with no warning. On HAOS this
# was the whole of 0.1.2's step-8 failure: log_level=debug was written, startup_ok
# still reported logLevel=info, logLevelSource=fallback.
#
# So the test is "does the tree still belong to node", not "does the directory". The
# scan is one level deep: /data holds a handful of entries (options.json, the sqlite
# file), and anything found triggers the same recursive chown.
needs_chown=0
if [ -d /data ]; then
  if [ "$(stat -c %u /data 2>/dev/null || echo 0)" != "1000" ]; then
    needs_chown=1
  else
    for entry in /data/* /data/.[!.]*; do
      [ -e "$entry" ] || continue
      if [ "$(stat -c %u "$entry" 2>/dev/null || echo 0)" != "1000" ]; then
        needs_chown=1
        break
      fi
    done
  fi

  if [ "$needs_chown" -eq 1 ]; then
    if ! chown -R node:node /data; then
      # Same one-line JSON and the same exit code the server uses for a data
      # directory it cannot write: one contract, two enforcers.
      printf '%s\n' '{"level":"error","event":"startup_failed","reason":"dir_readonly","exitCode":78,"msg":"/data could not be handed to node"}'
      exit 78
    fi
  fi
fi

exec gosu node "$@"
