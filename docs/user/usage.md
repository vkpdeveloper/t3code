# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart. Refreshing rescans every connected environment and refetches model pricing on
each of them, so a newly released model that showed $0.00 gets a price without waiting for the daily
pricing update.

## Reply speed in chat

After a turn finishes, the final reply shows an estimated delivery rate such as **≈42.5 tok/s**
beside its timestamp on web, desktop, and mobile. Hover over the rate on web or desktop, or tap it
on mobile, to see how it is calculated.

The estimate uses the final reply's text and the time from its first recorded text to completion.
It applies the same rough four-characters-per-token estimate across all providers and models.
This is an [English text rule of thumb](https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens);
actual token counts vary by model, language, and content. It does not count earlier reasoning,
tool calls, or other replies in the turn. Provider buffering and connection delays affect the
observed rate, so this is not a model benchmark or a billing token count.

Replies with less than one second of recorded delivery time, or missing timing, show
**Speed unavailable**. Empty replies have no speed label. The value uses saved timestamps, so it
remains available when you reopen the conversation or connect from another device.

## Review subscription limits with Vibe-Proxy

Open **Settings > Usages** on web or mobile to connect a Vibe-Proxy
management API. Enable the integration, enter the server's base URL, and save its management key.
The key is stored by the connected T3 Code server and is never returned to the client.

The page refreshes account limits whenever you open it. The last successful result stays available
while a refresh runs and remains visible if Vibe-Proxy is temporarily unreachable. Each account
shows its provider, status, quota windows, reset times, and recent request health when Vibe-Proxy
reports those fields. The account currently selected for routing is marked **In use**.
