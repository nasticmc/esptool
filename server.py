#!/usr/bin/env python3
"""Static file server that suppresses noisy BrokenPipeError tracebacks."""

import os
import shutil
import socketserver
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class QuietHandler(SimpleHTTPRequestHandler):
    def copyfile(self, source, outputfile):
        try:
            shutil.copyfileobj(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format, *args):  # noqa: A002
        super().log_message(format, *args)


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    port = int(os.environ.get("ESPTOOL_PORT", 8000))
    bind = os.environ.get("ESPTOOL_BIND", "0.0.0.0")
    with ThreadingHTTPServer((bind, port), QuietHandler) as httpd:
        print(f"Serving on {bind}:{port}")
        httpd.serve_forever()
