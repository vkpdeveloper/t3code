# Notifications

T3 Code can notify you when an agent finishes, fails, needs approval, or is waiting for your reply in chat. Choose the events and sound under **Settings → Notifications**.

Banners, the alert chime, and the sidebar flash only fire while T3 Code is not focused. If Do Not Disturb hid the banner, the flash is still there when you come back so you can find the thread.

## Web Push

In a browser, sign in to T3 Connect and enable **Web Push**. Your browser will ask for notification permission. T3 Code then uses the browser's standard Web Push subscription, so notifications can arrive when the tab is in the background or closed. Firebase is not involved.

The browser must support Web Push and the page must use a secure connection. Background delivery also requires the environment to be linked to the same T3 Connect account.

When the page is running, T3 Code plays its alert chime. When the page is closed, the browser and operating system control the notification sound. Silent mode, Do Not Disturb, and browser notification settings can still suppress it.

Turning off **Web Push** unsubscribes that browser. Opening a notification returns you to the affected thread.

## Android agent status

On Android, **Settings → Notifications** has two device-local switches:

- **Agent Status** keeps one silent, ongoing notification that lists every agent currently working across all of your paired machines, with the machine name, project, thread, and an elapsed timer. T3 Code stays connected in the background while it is on. On Android 16 QPR1 and later the notification is promoted to a Live Update. Tapping it opens the task when one agent is running, or Home when several are.
- **Agent Alerts** posts a local notification when an agent finishes, fails, or needs approval or input. Alerts only fire while T3 Code is not on screen. Tapping one opens the thread.

Both work without any push service. Nothing leaves the phone and the machines it is paired with. Force-stopping the app ends the background connection until you open T3 Code again.
