# claude-mods

Eigene Mods für Claude Code (Terminal, VS Code, Desktop).

## Mods

| Mod | Was sie tut |
| --- | --- |
| [subagent-monitor](mods/subagent-monitor) | Seitenpanel mit einer Zeile pro Subagent: Aufgabe, Typ und Modell, Laufzeit (tickt live) und das Werkzeug, das er gerade aufruft, samt Ziel (Datei, Befehl, Suchmuster). Tokens je Subagent (Kontext, Ausgabe). Unten Sitzung (Start, Kontextgröße, Tokens gesamt) und Balken für Session- (5h) und Wochenlimit mit Reset-Zeit. Öffnet sich beim ersten Subagent von selbst, sonst mit `/subagents`. |

## Installieren

In einer Claude-Code-Sitzung im Terminal:

```
/plugin install subagent-monitor --marketplace hayboeck/claude-mods
```

Aus der Shell:

```
claude plugin install subagent-monitor --marketplace hayboeck/claude-mods
```

## Entwickeln

```
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
```

Zum Ausprobieren ohne Installation: `claude --plugin-dir mods/<mod>`.
