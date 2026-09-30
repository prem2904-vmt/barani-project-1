#!/usr/bin/env python3
"""Virtual null-modem cable for macOS/Linux when socat is not installed.

Equivalent to:  socat -d -d pty,raw,echo=0 pty,raw,echo=0

Opens two pseudo-terminals, prints their device paths as one JSON line on
stdout ({"a": "/dev/ttys003", "b": "/dev/ttys004"}), then relays bytes both
ways until killed. Point the simulator at one path and the connector at the
other. Test/dev tooling only — never shipped to a lab.
"""
import json
import os
import select
import sys
import tty


def open_pty():
    master, slave = os.openpty()
    tty.setraw(slave)  # raw, no echo — like socat's pty,raw,echo=0
    return master, os.ttyname(slave), slave


def main():
    ma, pa, sa = open_pty()
    mb, pb, sb = open_pty()
    sys.stdout.write(json.dumps({"a": pa, "b": pb}) + "\n")
    sys.stdout.flush()
    peers = {ma: mb, mb: ma}
    while True:
        r, _, _ = select.select([ma, mb], [], [], 1.0)
        for fd in r:
            try:
                data = os.read(fd, 4096)
            except OSError:
                data = b""
            if data:
                os.write(peers[fd], data)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
