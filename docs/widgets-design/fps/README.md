# Snímková frekvence plochy widgetů (28.6)

`bun scripts/widgets-design-shots.ts fps`: plocha s 20 widgety v režimu úprav na 1440 px (Chromium, headless), počet rAF snímků za 3 s vlnění a za 2 s tažení jednoho widgetu přes plochu, bez škrcení a se škrcením CPU 4× (zhruba telefon střední třídy).

| CPU | Vlnění | Tažení |
|---|---|---|
| ×1 | 60 fps | 60 fps |
| ×4 | 60 fps | 45 fps |

Měřeno 23. 11. 2026 na vývojovém serveru (`bun run dev`, bez minifikace). Vlnění je čistě CSS (`animate-wiggle` na transformu, `will-change: transform`), tažení přes `DragOverlay` s memoizovaným obsahem widgetů (commit 30e495f).
