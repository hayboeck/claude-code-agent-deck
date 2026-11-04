# claude-mods

**English** | [Deutsch](README.de.md)

Mods for [Claude Code](https://claude.com/claude-code) by Manuel Hayböck. Install them with one line at the Claude Code prompt; they work in the terminal, in VS Code and in the desktop app.

| Mod | In one line |
| --- | --- |
| [subagent-monitor](#subagent-monitor) | A side pane that shows what your subagents are doing, how full your context is, how much of your usage limits is left, and keeps the prompt cache warm on request. |

---

## subagent-monitor

### Install

At the Claude Code prompt:

```
/plugin install subagent-monitor --marketplace hayboeck/claude-mods
```

Answer `y` to add the marketplace, press Enter for the user scope, then pick the **language** of the pane: `en` (English, the default) or `de` (Deutsch). The mod is active at once and in every new session.

| | |
| --- | --- |
| Open the pane | `/subagents` (it also opens by itself when the first subagent starts) |
| Update | `/plugin update subagent-monitor`, then `/reload-plugins` |
| Change the language | `/config`, row *subagent-monitor › Language*, or ask Claude: "set the subagent-monitor language to de" |
| Remove | `/plugin uninstall subagent-monitor` |
| From a shell instead | `claude plugin install subagent-monitor --marketplace hayboeck/claude-mods` |

### What the pane shows

```
Running (1)
◐ Search the repo for config files          0:42
  Explore · haiku · Read: settings.json · 31k tokens
Finished (2)  clear
✔ Count the memory files                    0:18
  Explore · haiku · 7 steps · 42k tokens
──────────────────────────────────────────────────
Session
Started                       Wed 4 Nov, 13:02
Context                   262k of 1.00 M (26 %)
████████░░░░░░░░░░░░░░░░░░░░░░
Tokens used                              4.12 M
──────────────────────────────────────────────────
Usage limits
Session (5h)                               42 %
████████████░░░░░░░░░░░░░░░░░░
Resets in 3h 59min · 18:10
Week (7 days)                              38 %
███████████░░░░░░░░░░░░░░░░░░░
Resets in 3d 22h · Sun 8 Nov, 13:00
──────────────────────────────────────────────────
Keep cache warm                           [ On ]
next ping in 37min · 0/5
```

**Subagents.** One entry per subagent, two lines each: its task and run time (ticking live), then its type, model, what it is doing right now (the tool and its target: file, command, search pattern) and the tokens it has used. A turning orange circle means it is working, a green ✔ that it finished, a red ✘ that it stopped early. `clear` removes the finished ones.

**Session.** When this chat started, how full its context is and how many tokens it has used in total.

**Usage limits.** Your subscription's 5-hour and weekly limits as Claude Code reports them, with the time each one resets.

**Language.** English or German, set when you install the mod; a change reloads the pane at once.

### Why the colours

| Bar | Green | Yellow | Orange | Red |
| --- | --- | --- | --- | --- |
| Session (5h) and week | up to 40 % | up to 60 % | up to 80 % | above 80 % |
| Context, as a share of the model's window | up to 25 % | up to 50 % | up to 75 % | above 75 % |

- **Limits:** the colour tells you at a glance how careful to be. Green: work freely. Yellow and orange: plan the larger tasks. Red: the limit is close and the next long task may not fit.
- **Context:** a model's answers get worse as its context fills, well before the window is full. It loses track of details from early in the chat and follows earlier instructions less reliably. The bar turns yellow when that starts to matter and red when it is time for `/compact` or a fresh chat. The mod reads the window size of the model you are using from Claude Code, so the thresholds fit every model: on a 1M window they are 250k, 500k and 750k tokens.

### Keep cache warm

Claude Code keeps your chat in Anthropic's prompt cache for 60 minutes after the last request. When the cache has expired, the next message has to read the whole chat in again, which costs far more of your limits than a message on a warm cache.

With the button on **On** (green background; red **Off** means switched off), the mod waits for 50 minutes of quiet and then sends one invisible ping: the chat as Claude Code last sent it plus the line "Reply only with: OK", with no tools. It does not appear in your chat. Reading the chat from the cache restarts the cache's 60 minutes. Every real message resets the countdown too.

- **At most 5 pings in a row** (about 4 hours of quiet), then it switches itself off, so it never runs all night.
- **Cost, measured:** on a chat with a 258k context, 5 pings moved the 5-hour limit by at most one percentage point, and the weekly limit not at all. A cache read costs about a tenth of reading the same text fresh.
- Worth it when you come back after a break. If you are done for the day, switch it off.

### What it does not do

- It sends nothing anywhere except the pings above, and those go through Claude Code to the same model.
- It stores only your language choice. Everything else lives in the session and is gone when it ends.
- It changes nothing in your chat, your files or your settings.

### Requirements

A Claude Code version with mod support (tested with 2.1.314). The limits section shows only with a Claude subscription (Pro or Max).

---

## Develop

```
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
```

To try a mod without installing it: `claude --plugin-dir mods/<mod>`.
