# Usage and limits

## Understand your usage

**Usage** combines Codex, Claude Code, and Grok Build session history from your connected
environments. It shows token use, cache savings, model breakdowns, and estimated API-equivalent
cost. These estimates are not your subscription bill.

Totals depend on the history available on each server. Grok turns without a saved completed-turn
record are missing from the totals.

On web and desktop, use the environment dropdown to filter costs, tokens, and limits. All
environments are selected by default. The dropdown shows which environments are still scanning;
results appear as each one responds.

If recent work is missing or a new model shows no cost, refresh to rescan session history and
update model pricing.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Reply speed in chat

After a turn finishes, the final reply shows an estimated delivery rate such as **≈42.5 tok/s**
beside its timestamp on web, desktop, and mobile. Hover over the rate on web or desktop, or tap it
on mobile, to see how it is calculated.

The estimate uses the final reply's text and the time from its first recorded text to completion.
It applies the same rough four-characters-per-token estimate across providers and models. It does
not count earlier reasoning, tool calls, or other replies in the turn, and provider buffering or
connection delays affect the result. It is not a model benchmark or a billing token count.

Replies with less than one second of recorded delivery time, or missing timing, show
**Speed unavailable**. Empty replies have no speed label. Saved timestamps keep the value available
when you reopen the conversation or connect from another device.

## Track subscription limits

**Usage → Limits** shows quota use and reset times for Codex and Claude subscriptions. It also
compares quota consumed with time elapsed in each window, so you can judge your pace before the
next reset.

If a window looks stale, refresh Limits to re-check every provider and hub.

API-key accounts may not report subscription limits. This also applies to Claude connections
using a proxy through `ANTHROPIC_AUTH_TOKEN`.

## Connect a CLIProxyAPI hub

To see pooled accounts, open **Settings → Providers → Usage providers → Add hub**. Choose the
environment that will connect to the hub and enter its URL and management key.

The accounts appear under **Usage → Limits**. This connection supplies usage information; configure
the provider separately to send agent requests through the hub. Remove the hub from the same
settings section when you no longer need it.

## Connect Vibe-Proxy

Open **Settings → Usage** on web or mobile to connect a Vibe-Proxy management API. Enable the
integration, enter the server's base URL, and save its management key. The connected T3 Code server
stores the key and never returns it to the client.

The page refreshes account limits whenever you open it. The last successful result remains visible
while a refresh runs or when Vibe-Proxy is temporarily unreachable. Each account shows its provider,
status, quota windows, reset times, and recent request health when available. The account selected
for routing is marked **In use**.
