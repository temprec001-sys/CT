param(
    [Parameter(Mandatory = $true)]
    [string]$RemoteUrl,

    [string]$CommitMessage = "Initial upload"
)

$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is not installed or not on PATH."
}

if (-not (Test-Path -LiteralPath ".git")) {
    git init | Out-Host
}

git branch -M main | Out-Host

$userName = & git config --get user.name 2>$null
$userEmail = & git config --get user.email 2>$null
if (-not $userName -or -not $userEmail) {
    throw "Set git user.name and user.email first, for example: git config --global user.name 'Your Name' and git config --global user.email 'you@example.com'."
}

$originUrl = & git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0 -and $originUrl) {
    git remote set-url origin $RemoteUrl | Out-Host
} else {
    git remote add origin $RemoteUrl | Out-Host
}

git add -A | Out-Host

$status = & git status --porcelain
if (-not $status) {
    Write-Host "No changes to commit."
    exit 0
}

git commit -m $CommitMessage | Out-Host
git push -u origin main | Out-Host
