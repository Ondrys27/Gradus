# Snímková frekvence přehledu administrace (29.3)

`bun scripts/admin-widgets-shots.ts fps`: plocha s 25 widgety administrace v režimu úprav na 1440 px (Chromium, headless), počet rAF snímků za 3 s vlnění a za 2 s tažení jednoho widgetu přes plochu, bez škrcení a se škrcením CPU 4× (zhruba telefon střední třídy).

| CPU | Vlnění | Tažení |
|---|---|---|
| ×1 | 60 fps | 59 fps |
| ×4 | 60 fps | 47 fps |

Měřeno 25. 11. 2026 na vývojovém serveru (`bun run dev`, bez minifikace). Plocha je sdílená s aplikací (`src/features/widgets`): vlnění je čistě CSS, tažení přes `DragOverlay` s memoizovaným obsahem widgetů; obsah widgetů administrace (sloupce, sparkline, měřidla) se při tažení nepřekresluje.
