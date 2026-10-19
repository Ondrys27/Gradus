#!/bin/bash
# Noční běh plánu přestavby Gradusu.
# Pouští položky z docs/progress.md jednu po druhé, každou v čisté relaci
# Claude Code (jako /clear + /pokracuj), a zastaví se na první zastávce
# (STOP nebo RUČNĚ), když už nic nezbývá, nebo když se třikrát po sobě
# nic nepohne.
#
# Spuštění z kořene projektu (Mac zapojený do nabíječky, víko otevřené):
#   caffeinate -i bash scripts/noc.sh
#
# Potřebuje Claude Code 2.1.259 nebo novější (claude update).
# Oprávnění: režim auto — Claude Code se na nic neptá, riskantní kroky
# sám odmítne a pravidla deny z .claude/settings.json platí dál.
#
# Průběh: .noc/<datum>.log  (ráno stačí otevřít; složka se necommituje)

cd "$(dirname "$0")/.." || exit 1
mkdir -p .noc
grep -qx '.noc/' .gitignore || echo '.noc/' >> .gitignore
LOG=".noc/$(date +%F_%H%M).log"
MAX_ITEMS=20        # pojistka: víc položek za jednu noc nepustí
MAX_STUCK=3         # kolikrát po sobě smí běh skončit bez posunu
WAIT_STUCK=600      # po neúspěšném běhu počká 10 minut
MAX_LIMIT_WAITS=14  # vyčerpaný limit předplatného: čeká po 30 min, nejvýš 7 hodin
WAIT_LIMIT=1800

# Claude Code má jet z předplatného Max, ne z API kreditů Jarvise.
unset ANTHROPIC_API_KEY

PROMPT='Přečti soubor .claude/commands/pokracuj.md a proveď jeho kroky 1 až 8 přesně, ale jen pro JEDNU položku — první nezaškrtnutou v docs/progress.md. Krok 9 (pokračování další položkou) neprováděj. Když je první položka STOP nebo RUČNĚ, nic nedělej a skonči. Nikdy se uživatele na nic neptej, běží to bez dozoru: když něco nejde, položku nezaškrtávej, popiš proč a skonči. Na konci vypiš česky krátký přehled jako v pokracuj.md.'

log() { echo "$(date '+%F %T')  $*" | tee -a "$LOG"; }

first_open() { grep -m1 '^- \[ \]' docs/progress.md; }

log "Začátek nočního běhu."
stuck=0
limit_waits=0
done_items=0
RUN_OUT=".noc/posledni-beh.txt"

while [ "$done_items" -lt "$MAX_ITEMS" ]; do
  next="$(first_open)"
  if [ -z "$next" ]; then log "Hotovo, v plánu nic nezbývá."; break; fi
  case "$next" in
    "- [ ] STOP"*|*"| RUČNĚ |"*)
      log "Zastávka, dál jen s tebou:"; log "$next"; break ;;
  esac

  log "Spouštím: $next"
  claude -p "$PROMPT" --permission-mode auto --permission-prompts none >"$RUN_OUT" 2>&1
  code=$?
  cat "$RUN_OUT" >>"$LOG"

  if [ "$(first_open)" = "$next" ] && grep -qiE "hit your .*limit|usage limit|session limit|rate limit" "$RUN_OUT"; then
    limit_waits=$((limit_waits + 1))
    if [ "$limit_waits" -gt "$MAX_LIMIT_WAITS" ]; then
      log "Limit předplatného se neobnovil ani po 7 hodinách, končím."; break
    fi
    log "Vyčerpaný limit předplatného, čekám 30 minut ($limit_waits/$MAX_LIMIT_WAITS)."
    sleep "$WAIT_LIMIT"
    continue
  fi

  if [ "$(first_open)" = "$next" ]; then
    stuck=$((stuck + 1))
    log "Položka se neposunula (kód $code), pokus $stuck z $MAX_STUCK."
    if [ "$stuck" -ge "$MAX_STUCK" ]; then
      log "Končím, něco potřebuje tebe. Podívej se do logu výš."
      break
    fi
    sleep "$WAIT_STUCK"
  else
    stuck=0
    done_items=$((done_items + 1))
    log "Hotovo: $next"
  fi
done

log "Konec nočního běhu. Hotových položek: $done_items."
