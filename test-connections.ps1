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
  throw ".env not found. Configure the provider API keys first."
}

$env:MAX_OUTPUT_TOKENS = "128"
Set-Location $project
& $node "node_modules\tsx\dist\cli.mjs" "scripts\smoke-test.ts"
exit $LASTEXITCODE
