# Amp

Install [Amp](https://ampcode.com/manual), run `amp login` on the environment that hosts T3 Code,
then add an Amp instance in Settings → Providers. Set its binary path if `amp` is not on PATH.
The environment owns the Amp account, including when you connect from another device.

Choose Low, Medium, High, or Ultra in the model picker. These are Amp modes: Amp chooses the
underlying models. Add a custom model entry using your custom Amp mode's name to use it in T3.
Fast, Pro, thinking output, and thread visibility are available in the mode options. Fast and Pro
are subject to your Amp account's access and billing rules.

Settings → Providers → Amp → Model routing manages personal and workspace connections through
Amp's CLI. You can test, enable, disable, rename, or remove a connection and add an API router.
Keys come from environment variables configured on the provider instance. New routers start
inactive. Editing a model mapping replaces the mapping; leaving it unchanged preserves it.
Use **Link a subscription** for Amp's account connection flow and **Tune modes in Amp** for its
native dial editor, including per-role model and reasoning-effort pins.

Supervised turns ask before tools run. Auto-accept edits allows file edits while asking for other
tools; Auto currently asks for tools as well. Full access allows tools without prompts. Approval
choices apply to one request. T3 uses a temporary permission configuration and preserves your
Amp settings file.

Amp sends complete message blocks rather than individual tokens. T3 displays tool activity,
reasoning when available, approvals, and file diffs as they arrive. Follow-ups resume the same
native Amp thread, including after a T3 server restart. Stop interrupts the current CLI process;
the next turn resumes the thread. Images and environment-local skills are supported. Conversation
rollback and interactive question forms are unavailable in Amp's stream-json protocol.
