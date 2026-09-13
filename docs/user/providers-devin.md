# Devin

For first-time setup, see [Install T3 Code](./install.md). Install the
[Devin CLI](https://docs.devin.ai/cli), run `devin auth login` on the environment that hosts
T3 Code, then add a Devin instance in Settings → Providers. Set its binary path when `devin` is not
on the server's normal command path. The environment owns the Devin account, including when you
connect from another device.

## Models

T3 Code reads the model list from the Devin session itself during the provider status check, so
the picker only shows models your Devin plan can run. On the Free plan that is a single Cognition
model; Pro and above add the frontier models. Refresh provider status after changing plans or
signing in again to reload the list.

`Devin default` is the fallback shown when the list is unavailable. Selecting it keeps whatever
model the Devin session already runs on. Model changes take effect on the next turn without a new
thread.

## Permissions

Devin exposes its own permission modes, and T3 Code maps the thread setting onto them:

| T3 Code setting   | Devin mode         |
| ----------------- | ------------------ |
| Supervised        | Code               |
| Auto-accept edits | Code               |
| Auto              | Smart              |
| Full access       | Bypass Permissions |

Devin's Code mode applies workspace edits without asking and prompts before shell commands and
other tools. There is no Devin mode that asks before every edit, so Supervised and Auto-accept
edits behave the same. Full access answers Devin's remaining prompts automatically. Approval
choices apply to one request.

## Questions, Titles, And Usage

When Devin asks you a question, T3 Code shows it as a form with Devin's choices and, when Devin
allows it, a free-text answer. Devin's own thread title replaces the placeholder title, and the
context-window meter follows Devin's usage reports. Compaction uses Devin's `/compact` command.

Image attachments are sent to Devin directly. Other files reach Devin through their path in the
prompt. Conversation rollback is not available, and Devin skills are not listed in T3 Code yet.
