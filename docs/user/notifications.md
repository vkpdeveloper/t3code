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

- **Agent Status** keeps one silent, ongoing notification for active agents across your paired machines. Rows that need approval or input come first, followed by running agents from oldest to newest. Each row shows the thread title, machine, project, and elapsed time. The footer counts only machines that are online. T3 Code stays connected in the background while this setting is on. Tapping the notification opens the task when one agent is active, or Home when several are.
- **Agent Alerts** posts a local notification when an agent finishes, fails, or needs approval or input. A newer alert for the same thread replaces the older one, and starting work again clears it. Alerts only fire while T3 Code is not on screen. Tapping one opens the thread.

On Android 16 QPR1 and later, Agent Status uses the system Live Update design when Android allows promoted notifications for T3 Code. It shows phase-colored progress for the active agents. Other devices use a compact T3 layout colored from the selected mobile theme. Expand it to see up to six agent rows. Settings tells you when Live Updates are unavailable.

Both work without any push service. Nothing leaves the phone and the machines it is paired with. Force-stopping the app ends the background connection until you open T3 Code again.
