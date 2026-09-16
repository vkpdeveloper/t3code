# Automatic continuation after usage limits

When a Codex or Claude subscription limit stops a turn, T3 Code keeps the thread working and
continues it after the provider's usage window resets. This is enabled by default.

While the wait is scheduled, the thread shows a "usage limit reached" banner with the resume time
and a Cancel button. Messages you send during the wait stay queued on the thread instead of failing
into the same limit.

When the window resets, T3 Code clears the wait and continues the thread: queued messages send in
order, and if nothing was queued the agent gets a "continue" prompt so it picks the task back up.
The schedule survives restarts, so the wait still fires if the app is closed and reopened.

Cancelling the banner ends the wait immediately and any queued sends run right away. Switching
providers or models on the thread also spends the wait, since it belongs to the previous window.
Disabling "Automatically continue after usage limits reset" in Settings cancels all pending waits.

Automatic continuation applies only to recognized Codex and Claude subscription limits. Workspace
credit limits, spend controls, and ordinary provider errors are left stopped for you to handle.
