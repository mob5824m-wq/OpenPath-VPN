import importlib.util
import pathlib
import unittest


path = pathlib.Path(__file__).resolve().parents[1] / 'test-android-peer.py'
spec = importlib.util.spec_from_file_location('android_test_peer', path)
peer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(peer)


class FragmentedSocket:
    def __init__(self, chunks):
        self.chunks = iter(chunks)
        self.requests = []

    def recv(self, count):
        self.requests.append(count)
        return next(self.chunks)


class AndroidPeerTest(unittest.TestCase):
    def test_reads_a_fragmented_tcp_message(self):
        sock = FragmentedSocket([b'op', b'en', b'path'])
        self.assertEqual(peer.receive_exact(sock, 8), b'openpath')
        self.assertEqual(sock.requests, [8, 6, 4])

    def test_incomplete_message_fails_on_eof(self):
        sock = FragmentedSocket([b'op', b''])
        with self.assertRaises(EOFError):
            peer.receive_exact(sock, 8)


if __name__ == '__main__':
    unittest.main()
