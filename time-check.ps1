# time-check.ps1 — Print a session header for Claude conversations
# Usage: ./time-check.ps1
# Then paste the output at the start of your message to Claude.

$now = Get-Date
$utc = $now.ToUniversalTime()
$dayOfWeek = $now.DayOfWeek
$weekNumber = (Get-Culture).Calendar.GetWeekOfYear($now, [System.Globalization.CalendarWeekRule]::FirstFourDayWeek, [DayOfWeek]::Monday)

# Sun position approximation for Grootfontein (-19.57°, 18.12°)
# Simple model: sunrise ~6:00, sunset ~18:30 (varies seasonally, close enough for vibes)
$hour = $now.Hour
$timeOfDay = switch ($hour) {
    {$_ -lt 5}  { "deep night" }
    {$_ -lt 7}  { "before dawn" }
    {$_ -lt 9}  { "early morning" }
    {$_ -lt 12} { "morning" }
    {$_ -lt 14} { "midday" }
    {$_ -lt 17} { "afternoon" }
    {$_ -lt 19} { "early evening" }
    {$_ -lt 22} { "evening" }
    default     { "late night" }
}

# US East Coast equivalent (CAT is UTC+2, ET is UTC-4 or UTC-5 depending on DST)
# Simple approximation: CAT - 6h ≈ ET in summer, CAT - 7h ≈ ET in winter
$etHour = ($hour - 6 + 24) % 24
$etTime = "{0:D2}:{1:D2} ET" -f $etHour, $now.Minute

# Output
Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Session header for Claude (paste this in)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Local time: $($now.ToString('yyyy-MM-dd HH:mm')) CAT ($timeOfDay), $dayOfWeek" -ForegroundColor Green
Write-Host "UTC:        $($utc.ToString('yyyy-MM-dd HH:mm')) UTC" -ForegroundColor Gray
Write-Host "ET (US):    ~$etTime" -ForegroundColor Gray
Write-Host "Week:       Week $weekNumber of $($now.Year)" -ForegroundColor Gray
Write-Host ""

# Also copy to clipboard so you don't have to retype it
$header = "[$($now.ToString('yyyy-MM-dd HH:mm')) CAT, $dayOfWeek $timeOfDay]"
$header | Set-Clipboard
Write-Host "→ Copied to clipboard:  $header" -ForegroundColor Yellow
Write-Host ""
