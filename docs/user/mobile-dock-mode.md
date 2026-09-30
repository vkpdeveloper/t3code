# Mobile Dock mode

Dock mode turns your phone into a landscape bedside or desk display. It shows the time in 24-hour format, the date, your next alarm, any paired machine that is offline, and up to four running agents, and keeps the screen on while it is open. Connected machines are not listed. Agents on a machine that goes offline are marked **Machine offline** instead of showing stale progress. Settled threads never appear, even if work is still running in them. An agent that needs approval or input stays on the list until you answer it. Finished and failed agents are marked, play a short chime, and leave the list after a minute. Use the speaker button in Dock mode to turn the chime on or off. The chime follows the silent switch.

Swipe any agent off the dock to hide it. A hidden agent never appears in Dock mode again, even when it runs again. To bring hidden agents back, use **Settings → Dock Mode → Show hidden agents again**. Dock mode is display-only: tapping an agent does nothing.

Open it from **Settings → Dock Mode → Open Dock Mode**. On iPhone, turn on **Open when charging sideways** to open Dock mode whenever the phone is charging and you turn it sideways. It closes when you unplug the phone or turn it upright. If you close Dock mode yourself, it will not reopen until the phone has been unplugged.

## Show your next alarm

iOS does not let apps read Clock alarms, so a Shortcuts automation hands them to T3 Code when you plug in:

1. In the Shortcuts app, create a personal automation for **Charger → Is Connected**, set to run immediately.
2. Add **Get All Alarms**, then **Get Details of Alarms** for **Time**, and **Format Date** with the date format set to **None** so only the time remains.
3. Add **Combine Text** with a comma separator, then **URL Encode**.
4. Add **Open URLs** with `t3code://dock?alarms=` followed by the encoded text.

Dock mode shows the soonest of those times. It keeps the list until the next time the automation runs.
