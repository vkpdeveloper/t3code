# Automations

Automations run an agent on a schedule owned by one T3 Code environment. The environment must be online at the scheduled time, and the selected provider must be available there.

Open **Automations** from the sidebar on web or desktop. Choose the machine, then create an automation with:

- a name and instructions
- a project, or the machine workspace when no project is needed
- a provider model, supported reasoning and speed options, and permission mode
- an hourly, daily, weekday, weekly, or advanced cron schedule

The schedule defaults to the time zone of the client that creates it. Search the time zone picker by region or UTC offset to change it. Offsets reflect the current date; schedules follow the selected zone through daylight saving changes.

Choose **Advanced** to enter a five-field cron expression: minute, hour, day of month, month, and weekday. For example, `0 9 * * 1-5` runs at 09:00 on weekdays in the selected time zone. Use **Run now** to test the automation without changing its next scheduled run. You can pause, resume, or delete it at any time.

On web and desktop, click the pencil beside an automation or choose **Edit** from its actions menu. Change its instructions, project, model, permissions, schedule, time zone, or enabled state, then choose **Save changes**. For unrestricted runs, set **Permissions** to **Full access**. Edits apply to future runs. Runs already started keep their original settings and history.

Select an automation's name or **Run history** to see its runs, newest first. Each entry shows its date, status, and whether it was scheduled or started manually. Use **Show older runs** to browse the rest of its history and **Refresh** to check for new runs. If a run failed to start, its error appears in the list.

Choose **Open run** to see that run's full thread, including its instructions, replies, tool activity, and file changes. You can reply to the agent, handle approvals, or watch a run that is still working. Use **Run history** above the thread to return to the same automation.

Successful automation runs settle automatically once work finishes and no approval, input, or plan needs attention. Their threads and run history remain available. Failed or interrupted runs stay active.

If a run's thread was archived, choose **Restore thread**, then open it. Deleted threads cannot be restored.

Automation threads stay out of project thread lists, search, and the archived-thread view. They are reachable only from the owning automation, which keeps scheduled work separate from interactive work.

On mobile, open **Settings > Automations** to view every connected environment and run or pause an automation. Tap **Run history**, then select any run to open its thread. Go back to return to the list. Create and delete actions are available on web and desktop.
