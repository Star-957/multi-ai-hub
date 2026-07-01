$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}
if (-not (Test-Path $node)) {
  throw "Node.js not found. Install Node.js 20+ or run this project inside Codex Desktop."
}
if (-not (Test-Path (Join-Path $project ".env"))) {
  Copy-Item (Join-Path $project ".env.example") (Join-Path $project ".env")
  Write-Host "Created .env. Add your API keys, then run .\start.ps1 again." -ForegroundColor Yellow
  exit 1
}
Set-Location $project
& $node "node_modules\tsx\dist\cli.mjs" "src\server.ts"
