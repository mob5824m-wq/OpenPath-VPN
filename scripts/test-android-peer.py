#!/usr/bin/env python3
"""Disposable TCP peer for the Android WireGuard emulator smoke test."""
import argparse
import socket


def receive_exact(conn: socket.socket, size: int) -> bytes:
    """TCP is a stream: one recv is not guaranteed to return the full message."""
    data = bytearray()
    while len(data) < size:
        part = conn.recv(size - len(data))
        if not part:
            raise EOFError('Android test client closed before sending its full message')
        data.extend(part)
    return bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('address')
    parser.add_argument('port', type=int)
    parser.add_argument('--connections', type=int, default=2)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535 or args.connections < 1:
        parser.error('Invalid port or connection count')
    with socket.socket() as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((args.address, args.port))
        server.listen(2)
        server.settimeout(120)
        print(f'ANDROID TEST PEER READY {server.getsockname()[1]}', flush=True)
        for _ in range(args.connections):
            conn, _ = server.accept()
            with conn:
                conn.settimeout(30)
                if receive_exact(conn, 8) != b'openpath':
                    raise RuntimeError('Unexpected test message')
                conn.sendall(b'ok')


if __name__ == '__main__':
    main()
