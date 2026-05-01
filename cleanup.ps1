# cleanup.ps1 — One-time repo cleanup for freshcontext-mcp
# Run from the repo root: powershell -ExecutionPolicy Bypass -File cleanup.ps1
# Safe: only moves files into _archive/ subfolders. No deletions.

$ErrorActionPreference = "Stop"
$repo = "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp"
Set-Location $repo

Write-Host "=== FreshContext repo cleanup ===" -ForegroundColor Cyan
Write-Host "Repo: $repo" -ForegroundColor Gray
Write-Host ""

# Helper: move with git mv if tracked, plain move otherwise
function Move-RepoFile {
    param([string]$From, [string]$ToDir)
    if (-not (Test-Path $From)) {
        Write-Host "  SKIP (not found): $From" -ForegroundColor DarkGray
        return
    }
    $filename = Split-Path $From -Leaf
    $to = Join-Path $ToDir $filename

    # Check if file is tracked by git
    $tracked = git ls-files --error-unmatch $From 2>$null
    if ($LASTEXITCODE -eq 0) {
        git mv $From $to | Out-Null
        Write-Host "  git mv $filename -> $ToDir/" -ForegroundColor Green
    } else {
        Move-Item -Path $From -Destination $to -Force
        Write-Host "  move    $filename -> $ToDir/" -ForegroundColor Yellow
    }
}

# --- Session saves -> _archive/sessions/ ---
Write-Host "Moving session saves..." -ForegroundColor Cyan
$sessions = @(
    "SESSION_SAVE_V3.md",
    "SESSION_SAVE_V4.md",
    "SESSION_SAVE_V5.md",
    "SESSION_SAVE_V5b.md",
    "SESSION_SAVE_V6.md",
    "SESSION_SAVE_V7.md",
    "SESSION_SAVE_V8.md",
    "SESSION_SAVE_V9.md",
    "SESSION_SAVE_V9b.md",
    "SESSION_SAVE_ARCHITECTURE_V1.md",
    "SESSION_SAVE_ARCHITECTURE_V2.md",
    "CONTEXT_SKILL.md"
)
foreach ($f in $sessions) {
    Move-RepoFile -From $f -ToDir "_archive\sessions"
}

# --- Superseded architecture plans -> _archive/architecture/ ---
Write-Host ""
Write-Host "Moving superseded architecture plans..." -ForegroundColor Cyan
$architecture = @(
    "ARCHITECTURE_UPGRADE_CHECKLIST.md",
    "ARCHITECTURE_UPGRADE_ROADMAP_V1.md"
)
foreach ($f in $architecture) {
    Move-RepoFile -From $f -ToDir "_archive\architecture"
}

# --- Launch drafts -> _archive/launch-drafts/ ---
Write-Host ""
Write-Host "Moving launch drafts..." -ForegroundColor Cyan
$drafts = @(
    "LAUNCH_POSTS_V9.md",
    "LAUNCH_POSTS_TODAY.md",
    "HN_THROWAWAY_FRIDAY.md"
)
foreach ($f in $drafts) {
    Move-RepoFile -From $f -ToDir "_archive\launch-drafts"
}

# --- Untracked junk: keep locally but make sure git ignores them ---
Write-Host ""
Write-Host "Cleaning git index of newly-ignored files..." -ForegroundColor Cyan
$ignoredButTracked = @("backup.sql", "mcp-publisher.exe")
foreach ($f in $ignoredButTracked) {
    if (Test-Path $f) {
        $tracked = git ls-files --error-unmatch $f 2>$null
        if ($LASTEXITCODE -eq 0) {
            git rm --cached $f | Out-Null
            Write-Host "  git rm --cached $f  (file kept locally)" -ForegroundColor Yellow
        } else {
            Write-Host "  $f already untracked" -ForegroundColor DarkGray
        }
    }
}

Write-Host ""
Write-Host "=== Cleanup complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Review changes:  git status" -ForegroundColor Gray
Write-Host "  2. Commit:          git commit -m 'chore: archive session saves + tighten gitignore + clean repo root'" -ForegroundColor Gray
Write-Host "  3. Push:            git push origin main" -ForegroundColor Gray
