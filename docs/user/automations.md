# Automations

Automations run an agent on a schedule owned by one T3 Code environment. The environment must be online at the scheduled time, and the selected provider must be available there.

Open **Automations** from the sidebar on web or desktop. Choose the machine, then create an automation with:

- a name and instructions
- a project, or the machine workspace when no project is needed
- a provider model and permission mode
- an hourly, daily, weekday, or weekly schedule

The schedule uses the time zone of the client that creates or edits it. Use **Run now** to test the automation without changing its next scheduled run. You can pause, resume, or delete it at any time.

Each run has a full T3 Code thread. Open the latest run from Automations to watch its console, reply to the agent, handle approvals, or inspect its output from any client connected to that environment.

Automation threads stay out of project thread lists, search, and the archived-thread view. They are reachable only from the owning automation, which keeps scheduled work separate from interactive work.

On mobile, open **Settings > Automations** to view every connected environment, run or pause an automation, and open its latest run. Create and delete actions are available on web and desktop.
