<#
.SYNOPSIS
    一键启动 pdf-search：后端(FastAPI) + 前端(Next.js) + cloudflared 公网隧道
.USAGE
    powershell -ExecutionPolicy Bypass -File start.ps1
#>
$ErrorActionPreference = "Stop"

# ============ 配置（按需修改） ============
$ProjectRoot = "F:\workspace\pdf-search"
$Python      = "F:\workspace\env\retrenv\Scripts\python.exe"
$Cloudflared = "F:\workspace\cloudflared.exe"   # 改成你的 cloudflared.exe 实际路径
$BackendPort  = 8000
$FrontendPort = 3000

function Test-TcpPort([int]$Port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect("127.0.0.1", $Port); $c.Close(); return $true } catch { return $false }
}

function Start-Backend {
    if (Test-TcpPort $BackendPort) { Write-Host "[后端] 已在运行 :$BackendPort" -ForegroundColor Green; return }
    Write-Host "[后端] 启动 :$BackendPort ..."
    $env:PYTHONPATH = "$ProjectRoot\src"
    Start-Process -FilePath $Python -ArgumentList "-m","pdfsearch.cli","serve","--port","$BackendPort" `
        -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
        -RedirectStandardOutput "$ProjectRoot\logs\backend.log" `
        -RedirectStandardError  "$ProjectRoot\logs\backend.err.log"
}

function Start-Frontend {
    if (Test-TcpPort $FrontendPort) { Write-Host "[前端] 已在运行 :$FrontendPort" -ForegroundColor Green; return }
    if (-not (Test-Path "$ProjectRoot\chat-agent\.next")) {
        Write-Host "[前端] 未构建，先执行 npm run build（约 1-2 分钟）..."
        Push-Location "$ProjectRoot\chat-agent"
        npm.cmd run build
        Pop-Location
    }
    Write-Host "[前端] 启动 :$FrontendPort ..."
    Start-Process -FilePath "npm.cmd" -ArgumentList "run","start" `
        -WorkingDirectory "$ProjectRoot\chat-agent" -WindowStyle Hidden `
        -RedirectStandardOutput "$ProjectRoot\logs\frontend.log" `
        -RedirectStandardError  "$ProjectRoot\logs\frontend.err.log"
}

# ============ 主流程 ============
New-Item -ItemType Directory -Path "$ProjectRoot\logs" -Force | Out-Null

Write-Host "========== 前置检查 =========="
if (-not (Test-Path $Python)) {
    Write-Host "[错误] 找不到 Python：$Python" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $Cloudflared)) {
    Write-Host "[错误] 找不到 cloudflared：$Cloudflared" -ForegroundColor Red
    Write-Host "       请把 cloudflared.exe 放到该路径，或改脚本里的 `$Cloudflared"
    exit 1
}
if (Test-TcpPort 11434) { Write-Host "[Ollama] 运行中 (11434)" -ForegroundColor Green }
else { Write-Host "[警告] Ollama (11434) 未运行，LLM 将不可用" -ForegroundColor Yellow }

Start-Backend
Start-Frontend

Write-Host "========== 等待服务就绪 =========="
$be = $false; $fe = $false
for ($i = 0; $i -lt 90; $i++) {
    $be = Test-TcpPort $BackendPort
    $fe = Test-TcpPort $FrontendPort
    if ($be -and $fe) { break }
    Start-Sleep -Seconds 2
}
if ($be) { Write-Host "[后端] 就绪 :$BackendPort" -ForegroundColor Green } else { Write-Host "[后端] 未就绪，看 logs\backend.err.log" -ForegroundColor Red }
if ($fe) { Write-Host "[前端] 就绪 :$FrontendPort" -ForegroundColor Green } else { Write-Host "[前端] 未就绪，看 logs\frontend.err.log" -ForegroundColor Red }

Write-Host "========== 启动 cloudflared =========="
Write-Host "下面会打印 https://xxx.trycloudflare.com 公网地址，发给别人即可访问。"
Write-Host "按 Ctrl+C 停止隧道（后端/前端仍会在后台运行）。"
& $Cloudflared tunnel --url "http://localhost:$FrontendPort"
