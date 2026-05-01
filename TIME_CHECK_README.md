# Time-Check Helper

A tiny script that prints your local time, UTC, US ET equivalent, and copies a session header to your clipboard. Designed to be pasted into Claude conversations so the assistant knows what time and day you're actually in.

## Why it exists

Claude doesn't have a clock. The system tells it the date, but not the local time, not the day-of-week feel, not how long you've been awake. Without that context Claude can drift — assuming midday when you're at midnight, or losing track that "see you at 10:30" meant tonight, not tomorrow.

A four-second script fixes this.

## One-time setup

Make `tc` work as a global command from any PowerShell window:

```powershell
# Open your PowerShell profile (creates it if it doesn't exist)
if (!(Test-Path $PROFILE)) { New-Item -Type File -Path $PROFILE -Force }
notepad $PROFILE
```

Add this line to the profile and save:

```powershell
function tc { & "C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp\time-check.ps1" }
```

Reload your shell (close/reopen PowerShell, or run `. $PROFILE`).

## Usage

From any PowerShell window:

```
tc
```

You'll see something like:

```
═══════════════════════════════════════════
  Session header for Claude (paste this in)
═══════════════════════════════════════════

Local time: 2026-05-01 22:30 CAT (late night), Friday
UTC:        2026-05-01 20:30 UTC
ET (US):    ~16:30 ET
Week:       Week 18 of 2026

→ Copied to clipboard:  [2026-05-01 22:30 CAT, Friday late night]
```

The bracketed line is now in your clipboard. Paste it at the top of your next message to Claude:

```
[2026-05-01 22:30 CAT, Friday late night]

ok so about the apify rebuild...
```

Claude will see it, anchor on it, and reason about your day correctly.

## What it does NOT do

It doesn't talk to Claude or any API. It doesn't track your activity. It just reads `Get-Date`, formats it, prints it, copies a one-line summary to the clipboard. That's it. ~30 lines of PowerShell. You can read the whole script.

## Adjustments

- The "time of day" labels (morning / midday / late night) are tuned for ~Grootfontein day length. If you want different cutoffs, edit the `switch ($hour)` block in `time-check.ps1`.
- The ET conversion is approximate (assumes CAT - 6h, which is correct in US summer; in US winter it's CAT - 7h). Close enough for "is it still morning over there" reasoning.
