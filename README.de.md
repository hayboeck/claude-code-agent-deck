# claude-mods

[English](README.md) | **Deutsch**

Eigene Mods für Claude Code (Terminal, VS Code, Desktop).

## Mods

| Mod | Was sie tut |
| --- | --- |
| [subagent-monitor](mods/subagent-monitor) | Seitenpanel mit einem Eintrag pro Subagent: Aufgabe, Typ und Modell, Laufzeit (tickt live) und das Werkzeug, das er gerade aufruft, samt Ziel (Datei, Befehl, Suchmuster), dazu seine Tokens. Unten Sitzung (Start, Kontextgröße, Tokenverbrauch) und Balken für Session- (5h) und Wochenlimit mit Reset-Zeit (grün bis 40 %, gelb bis 60 %, orange bis 80 %, darüber rot; Kontextbalken nach Größe: 250k / 500k / 750k). Knopf „Cache warmhalten“: nach 50min Ruhe ein unsichtbarer Ping über den Chatverlauf (höchstens 5 in Folge). Deutsch oder Englisch, im Panel umschaltbar (DE \| EN). Öffnet sich beim ersten Subagent von selbst, sonst mit `/subagents`. |

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
