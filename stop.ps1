# 停止后端和前端（cloudflared 在 start.ps1 里 Ctrl+C 已停）
$ErrorActionPreference = "SilentlyContinue"

Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -like "*pdfsearch.cli*serve*" -or
    $_.CommandLine -like "*next-server*" -or
    $_.CommandLine -like "*next*start*"
} | ForEach-Object {
    Write-Host "停止进程 PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
}
Write-Host "已停止后端和前端。"
