param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "MISTRAL_API_KEY",
    "OPENROUTER_API_KEY",
    "GLM_API_KEY",
    "NVIDIA_API_KEY"
  )]
  [string]$Name
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $root ".env"
$value = (Get-Clipboard -Raw).Trim()

if ($value.Length -lt 20 -or $value -match "[\r\n]") {
  throw "Clipboard does not contain a valid single-line API key."
}

$content = if (Test-Path $envPath) { Get-Content -Raw $envPath } else { "" }
$escapedName = [regex]::Escape($Name)
if ($content -match "(?m)^$escapedName=") {
  $content = [regex]::Replace($content, "(?m)^$escapedName=.*$", "$Name=$value")
} else {
  if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`r`n" }
  $content += "$Name=$value`r`n"
}

Set-Content -LiteralPath $envPath -Value $content -Encoding utf8 -NoNewline
Write-Host "$Name saved to .env (secret not displayed)." -ForegroundColor Green
