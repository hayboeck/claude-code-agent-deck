# claude-mods

**English** | [Deutsch](README.de.md)

Mods for Claude Code (terminal, VS Code, desktop).

## Mods

| Mod | What it does |
| --- | --- |
| [subagent-monitor](mods/subagent-monitor) | Side pane with one entry per subagent: task, type and model, run time (ticks live) and the tool it is calling right now with its target (file, command, search pattern), plus its tokens. At the bottom: the session (start, context size, tokens used) and bars for the session (5h) and weekly limits with their reset time (green to 40 %, yellow to 60 %, orange to 80 %, red above; context bar by size: 250k / 500k / 750k). A "Keep cache warm" switch: after 50min of quiet an invisible ping over the chat keeps the prompt cache alive (at most 5 in a row). German or English, switchable in the pane (DE \| EN). Opens by itself with the first subagent, otherwise with `/subagents`. |

## Install

In a Claude Code session in the terminal:

```
/plugin install subagent-monitor --marketplace hayboeck/claude-mods
```

From a shell:

```
claude plugin install subagent-monitor --marketplace hayboeck/claude-mods
```

## Develop

```
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
```

To try a mod without installing it: `claude --plugin-dir mods/<mod>`.
