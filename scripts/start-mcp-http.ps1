# ============================================================
# Start MCP Server in HTTP/SSE mode — for remote Claude connections
# Use this when Claude Code is on a different machine than the platform
# Run from repo root: .\scripts\start-mcp-http.ps1
# ============================================================

if (Test-Path ".env") {
    Get-Content ".env" | Where-Object { $_ -match "^\s*[^#]" -and $_ -match "=" } | ForEach-Object {
        $parts = $_ -split "=", 2
        [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
    }
}

$port = if ($env:MCP_PORT) { $env:MCP_PORT } else { "3001" }

Write-Host "Building MCP HTTP server..." -ForegroundColor Cyan
Set-Location apps/mcp-server
pnpm build
Set-Location ../..

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host "  AI SDR MCP HTTP Server" -ForegroundColor White
Write-Host "  SSE endpoint: http://localhost:$port/sse" -ForegroundColor Cyan
Write-Host "  Health check: http://localhost:$port/health" -ForegroundColor Gray
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Claude Desktop config (remote SSE mode):" -ForegroundColor Yellow
Write-Host '  "type": "sse"' -ForegroundColor Gray
Write-Host "  `"url`": `"http://localhost:$port/sse`"" -ForegroundColor Gray
Write-Host "  `"headers`": { `"Authorization`": `"Bearer $env:MCP_AUTH_TOKEN`" }" -ForegroundColor Gray
Write-Host ""

node apps/mcp-server/dist/server-http.js
