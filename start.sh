#!/bin/sh
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "需要 Python 3，或在本目录运行任意静态服务器（例如 npx serve -l 8000）"; exit 1; }
echo "博美meme：http://localhost:8000/"
python3 -m http.server 8000
