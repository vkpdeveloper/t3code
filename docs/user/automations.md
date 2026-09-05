# Automations

Automations run an agent on a schedule owned by one T3 Code environment. The environment must be online at the scheduled time, and the selected provider must be available there.

Open **Automations** from the sidebar on web or desktop. Choose the machine, then create an automation with:

- a name and instructions
- a project, or the machine workspace when no project is needed
- a provider model and permission mode
- an hourly, daily, weekday, or weekly schedule

The schedule uses the time zone of the client that creates or edits it. Use **Run now** to test the automation without changing its next scheduled run. You can pause, resume, or delete it at any time.

Select an automation's name or **Run history** to see its runs, newest first. Each entry shows its date, status, and whether it was scheduled or started manually. Use **Show older runs** to browse the rest of its history and **Refresh** to check for new runs. If a run failed to start, its error appears in the list.

Choose **Open run** to see that run's full thread, including its instructions, replies, tool activity, and file changes. You can reply to the agent, handle approvals, or watch a run that is still working. Use **Run history** above the thread to return to the same automation.

If a run's thread was archived, choose **Restore thread**, then open it. Deleted threads cannot be restored.

Automation threads stay out of project thread lists, search, and the archived-thread view. They are reachable only from the owning automation, which keeps scheduled work separate from interactive work.

On mobile, open **Settings > Automations** to view every connected environment and run or pause an automation. Tap **Run history**, then select any run to open its thread. Go back to return to the list. Create and delete actions are available on web and desktop.
