---
description: Zapracuje soubor s novým kolem úprav do plánu, postupu a CLAUDE.md
argument-hint: název souboru ve složce docs
---
Přečti soubor `docs/$ARGUMENTS` a proveď přesně a doslova instrukce v něm. Prompty z něj sám neprováděj — jen je zapracuj do `docs/plan.md` a `docs/progress.md` a uprav `CLAUDE.md`, jak soubor říká.

Nakonec ověř `git check-ignore -v .env.local`, commitni změny, pushni a napiš uživateli česky, kolik položek přibylo do postupu a že má napsat `/clear` a pak `/pokracuj`.
