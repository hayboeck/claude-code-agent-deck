# claude-mods

[English](README.md) | **Deutsch**

Mods für [Claude Code](https://claude.com/claude-code) von Manuel Hayböck. Installiert werden sie mit einer Zeile im Eingabefeld von Claude Code; sie laufen im Terminal, in VS Code und in der Desktop-App.

| Mod | In einem Satz |
| --- | --- |
| [subagent-monitor](#subagent-monitor) | Ein Seitenpanel, das zeigt, was deine Subagents gerade tun, wie voll der Kontext ist, wie viel von deinen Nutzungslimits übrig ist, und das auf Wunsch den Prompt-Cache warmhält. |

---

## subagent-monitor

### Installieren

Im Eingabefeld von Claude Code:

```
/plugin install subagent-monitor --marketplace hayboeck/claude-mods
```

Mit `y` die Mod-Sammlung hinzufügen und mit Enter den Bereich „user“ wählen. Die Mod ist sofort aktiv und in jeder neuen Sitzung.

| | |
| --- | --- |
| Panel öffnen | `/subagents` (öffnet sich auch von selbst beim ersten Subagent) |
| Aktualisieren | `/plugin update subagent-monitor`, dann `/reload-plugins` |
| Entfernen | `/plugin uninstall subagent-monitor` |
| Stattdessen aus der Shell | `claude plugin install subagent-monitor --marketplace hayboeck/claude-mods` |

### Was das Panel zeigt

```
                                          DE | EN
Laufend (1)
◐ Repo nach Konfigdateien durchsuchen       0:42
  Explore · haiku · Read: settings.json · 31k Tokens
Beendet (2)  leeren
✔ Memory-Dateien zählen                     0:18
  Explore · haiku · 7 Schritte · 42k Tokens
──────────────────────────────────────────────────
Sitzung
Gestartet                    Mi., 4.11., 13:02
Kontext                  262k von 1,00 M (26 %)
████████░░░░░░░░░░░░░░░░░░░░░░
Tokenverbrauch                           4,12 M
──────────────────────────────────────────────────
Nutzungslimits
Session (5h)                               42 %
████████████░░░░░░░░░░░░░░░░░░
Reset in 3h 59min · 18:10
Woche (7 Tage)                             38 %
███████████░░░░░░░░░░░░░░░░░░░
Reset in 3d 22h · So., 8.11., 13:00
──────────────────────────────────────────────────
Cache warmhalten               ● an  [ umschalten ]
nächster Ping in 37min · 0/5
```

**Subagents.** Ein Eintrag pro Subagent, je zwei Zeilen: Aufgabe und Laufzeit (zählt live mit), darunter Typ, Modell, was er gerade tut (Werkzeug und Ziel: Datei, Befehl, Suchmuster) und seine verbrauchten Tokens. Ein sich drehender orangener Kreis heißt „arbeitet“, ein grünes ✔ „fertig“, ein rotes ✘ „vorzeitig abgebrochen“. `leeren` entfernt die fertigen.

**Sitzung.** Wann dieser Chat begonnen hat, wie voll sein Kontext ist und wie viele Tokens er insgesamt verbraucht hat.

**Nutzungslimits.** Das 5-Stunden- und das Wochenlimit deines Abos, wie Claude Code sie meldet, jeweils mit dem Zeitpunkt des Resets.

**Sprache.** `DE | EN` rechts oben schaltet alle Texte um; die Wahl bleibt für spätere Sitzungen gespeichert.

### Warum diese Farben

| Balken | Grün | Gelb | Orange | Rot |
| --- | --- | --- | --- | --- |
| Session (5h) und Woche | bis 40 % | bis 60 % | bis 80 % | über 80 % |
| Kontext, als Anteil am Fenster des Modells | bis 25 % | bis 50 % | bis 75 % | über 75 % |

- **Limits:** Die Farbe zeigt auf einen Blick, wie sparsam du sein solltest. Grün: frei arbeiten. Gelb und Orange: größere Aufgaben einplanen. Rot: Das Limit ist nah, und die nächste lange Aufgabe passt womöglich nicht mehr hinein.
- **Kontext:** Die Antworten eines Modells werden schlechter, je voller sein Kontext ist, und zwar lange bevor das Fenster voll ist. Es verliert Details vom Anfang des Chats und hält sich weniger verlässlich an frühere Anweisungen. Der Balken wird gelb, wenn das spürbar wird, und rot, wenn es Zeit für `/compact` oder einen neuen Chat ist. Die Mod liest die Fenstergröße des gerade verwendeten Modells aus Claude Code, so passen die Schwellen zu jedem Modell: Bei einem 1M-Fenster liegen sie bei 250k, 500k und 750k Tokens.

### Cache warmhalten

Claude Code hält deinen Chat 60 Minuten nach der letzten Anfrage im Prompt-Cache von Anthropic. Ist der Cache abgelaufen, muss die nächste Nachricht den ganzen Chat neu einlesen. Das kostet viel mehr von deinen Limits als eine Nachricht bei warmem Cache.

Steht der Schalter auf **an**, wartet die Mod 50 Minuten Ruhe ab und schickt dann einen unsichtbaren Ping: den Chat, wie Claude Code ihn zuletzt gesendet hat, plus die Zeile „Antworte nur mit: OK“, ohne Werkzeuge. Im Chat erscheint nichts. Weil der Chat dabei aus dem Cache gelesen wird, beginnen dessen 60 Minuten von vorn. Jede echte Nachricht setzt den Countdown ebenfalls zurück.

- **Höchstens 5 Pings in Folge** (etwa 4 Stunden Ruhe), dann schaltet es sich selbst aus, damit es nie über Nacht läuft.
- **Kosten, gemessen:** Bei einem Chat mit 258k Kontext haben 5 Pings das 5-Stunden-Limit um höchstens einen Prozentpunkt bewegt, das Wochenlimit gar nicht. Aus dem Cache lesen kostet etwa ein Zehntel davon, denselben Text neu zu lesen.
- Lohnt sich, wenn du nach einer Pause weitermachst. Bist du für heute fertig, schalte es aus.

### Was die Mod nicht tut

- Sie schickt nichts irgendwohin außer den Pings oben, und die gehen über Claude Code an dasselbe Modell.
- Sie speichert nur deine Sprachwahl. Alles andere lebt in der Sitzung und ist mit ihr weg.
- Sie ändert nichts an deinem Chat, deinen Dateien oder deinen Einstellungen.

### Voraussetzungen

Eine Claude-Code-Version mit Mod-Unterstützung (getestet mit 2.1.314). Die Nutzungslimits erscheinen nur mit einem Claude-Abo (Pro oder Max).

---

## Entwickeln

```
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
```

Zum Ausprobieren ohne Installation: `claude --plugin-dir mods/<mod>`.
