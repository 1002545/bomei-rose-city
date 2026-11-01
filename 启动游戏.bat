@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 博美meme：在 http://localhost:8000/ 启动（关闭本窗口即停止）
where python >nul 2>nul || (echo 未找到 Python。请安装 Python 3，或在本目录运行任意静态服务器（例如 npx serve -l 8000）。 & pause & exit /b 1)
start "" http://localhost:8000/
python -m http.server 8000
