# ============================================================
# Start MCP Server locally for Claude Code / Claude Desktop
# Run from repo root: .\scripts\start-mcp-local.ps1
# ============================================================

# Load .env
if (Test-Path ".env") {
    Get-Content ".env" | Where-Object { $_ -match "^\s*[^#]" -and $_ -match "=" } | ForEach-Object {
        $parts = $_ -split "=", 2
        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
    Write-Host "✓ Loaded .env" -ForegroundColor Green
} else {
    Write-Host "⚠ No .env file found — using existing environment variables" -ForegroundColor Yellow
}

# Build MCP server
Write-Host "Building MCP server..." -ForegroundColor Cyan
Set-Location apps/mcp-server
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}
Set-Location ../..

Write-Host "✓ MCP server built" -ForegroundColor Green
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host "  AI SDR MCP Server ready for Claude Code" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Claude Code picks up the MCP server automatically" -ForegroundColor Gray
Write-Host "from .claude/settings.json when you open this project." -ForegroundColor Gray
Write-Host ""
Write-Host "For Claude Desktop, copy the config from:" -ForegroundColor Gray
Write-Host "  apps/mcp-server/claude-config/claude_desktop_config.json" -ForegroundColor Yellow
Write-Host "  to: $env:APPDATA\Claude\claude_desktop_config.json" -ForegroundColor Yellow
Write-Host ""
Write-Host "Running MCP server (stdio mode)..." -ForegroundColor Cyan
node apps/mcp-server/dist/server.js
