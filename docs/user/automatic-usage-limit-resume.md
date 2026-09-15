# Automatic continuation after usage limits

When a Codex or Claude subscription limit stops a turn, T3 Code keeps the thread working and
continues it after the provider's usage window resets. This is enabled by default.

The wait happens inside the provider session itself: the agent stays in its working state and the
turn resumes on its own once the limit clears. If the provider reports an exact reset time, that
time is used; another limit response schedules the next attempt instead of abandoning the task.

Messages sent during the wait stay queued on the thread. When the limit resets, T3 Code sends them
to the agent in order, including image attachments, as part of the continued turn.

Interrupting the thread stops the wait along with the rest of the turn. Switching to another agent
ends the current session and starts the new turn immediately.

Automatic continuation applies only to recognized Codex and Claude subscription limits. Workspace
credit limits, spend controls, and ordinary provider errors are left stopped for you to handle.
