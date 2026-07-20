#!/usr/bin/env python3
"""Tiny client for the blender-mcp addon socket (same protocol the MCP server uses).

Usage:
  bmcp.py info                 -> get_scene_info
  bmcp.py exec <file.py>       -> execute_code with the file's contents
  bmcp.py shot <out.png>       -> viewport screenshot
"""
import json
import socket
import sys


def send(command, timeout=180):
    s = socket.create_connection(("localhost", 9876), timeout=timeout)
    s.sendall(json.dumps(command).encode())
    buf = b""
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        try:
            resp = json.loads(buf.decode())
            s.close()
            return resp
        except json.JSONDecodeError:
            continue
    s.close()
    raise RuntimeError("connection closed without full JSON response")


def main():
    cmd = sys.argv[1]
    if cmd == "info":
        resp = send({"type": "get_scene_info", "params": {}})
    elif cmd == "exec":
        code = open(sys.argv[2]).read()
        resp = send({"type": "execute_code", "params": {"code": code}})
    elif cmd == "shot":
        resp = send({"type": "get_viewport_screenshot",
                     "params": {"filepath": sys.argv[2], "max_size": 1200}})
    else:
        raise SystemExit(f"unknown cmd {cmd}")
    out = json.dumps(resp, indent=2)
    print(out[:6000])
    if resp.get("status") != "success":
        sys.exit(1)


if __name__ == "__main__":
    main()
