# Mobile Dock mode

Dock mode turns your phone into a bedside or desk display. It shows the time, the date, your next alarm, and up to four running agents, and keeps the screen on while it is open. An agent that needs approval or input stays on the list until you answer it. Finished and failed agents are marked, play a short chime, and leave the list after a few seconds. Use the speaker button in Dock mode to turn the chime on or off. The chime follows the silent switch.

Open it from **Settings → Dock Mode → Open Dock Mode**. On iPhone, turn on **Open when charging sideways** to open Dock mode whenever the phone is charging and you turn it sideways. It closes when you unplug the phone or turn it upright. If you close Dock mode yourself, it will not reopen until the phone has been unplugged. Tap an agent to open its thread.

## Show your next alarm

iOS does not let apps read Clock alarms, so a Shortcuts automation hands them to T3 Code when you plug in:

1. In the Shortcuts app, create a personal automation for **Charger → Is Connected**, set to run immediately.
2. Add **Get All Alarms**, then **Get Details of Alarms** for **Time**, and **Format Date** with the date format set to **None** so only the time remains.
3. Add **Combine Text** with a comma separator, then **URL Encode**.
4. Add **Open URLs** with `t3code://dock?alarms=` followed by the encoded text.

Dock mode shows the soonest of those times. It keeps the list until the next time the automation runs.
