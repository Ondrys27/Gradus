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
# Zastávky (STOP) jsou jen připomínky k ručnímu otestování. Když chceš, aby
# noční běh jel přes ně dál a nechal ti je na ráno:
#   caffeinate -i bash scripts/noc.sh --bez-zastavek
# Přeskočené zastávky se zaškrtnou s poznámkou a sepíšou do .noc/zkontroluj.md.
# Položky RUČNĚ zastaví běh vždy.
#
# Potřebuje Claude Code 2.1.259 nebo novější (claude update).
# Oprávnění: režim auto — Claude Code se na nic neptá, riskantní kroky
# sám odmítne a pravidla deny z .claude/settings.json platí dál.
#
# Migrace databáze: Claude Code je v režimu auto spustit nesmí. Když se položka
# neposune a na větvi leží commitnutá migrace, která ve vzdálené databázi chybí,
# spustí ji tenhle skript sám (scripts/noc-migrace.py): jen když jen přidává
# (žádné drop, rename, změna typu, truncate, delete) a když projde bun run test.
# Pak vygeneruje typy a položku pustí znovu, aby ji Claude dokončil (e2e, merge,
# push). Cokoli jiného nechá na tobě jako dřív. Vypnutí: --bez-migraci
#
# Průběh: .noc/<datum>.log  (ráno stačí otevřít; složka se necommituje)

cd "$(dirname "$0")/.." || exit 1
SKIP_STOPS=0
AUTO_MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --bez-zastavek) SKIP_STOPS=1 ;;
    --bez-migraci) AUTO_MIGRATE=0 ;;
  esac
done
export PATH="$HOME/.bun/bin:$PATH"
mkdir -p .noc
grep -qx '.noc/' .gitignore || echo '.noc/' >> .gitignore
LOG=".noc/$(date +%F_%H%M).log"
MAX_ITEMS=20        # pojistka: víc položek za jednu noc nepustí
MAX_STUCK=3         # kolikrát po sobě smí běh skončit bez posunu
WAIT_STUCK=600      # po neúspěšném běhu počká 10 minut
MAX_LIMIT_WAITS=14  # vyčerpaný limit předplatného: čeká po 30 min, nejvýš 7 hodin v kuse (po hotové položce znovu od nuly)
WAIT_LIMIT=1800

# Claude Code má jet z předplatného Max, ne z API kreditů Gradyho.
unset ANTHROPIC_API_KEY

# claude -p po posledním tahu čeká na úlohy na pozadí jen 10 minut, pak je zabije
# a položka zůstane rozdělaná. Hodina stačí i na pomalý subagent.
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=3600000

PROMPT='Přečti soubor .claude/commands/pokracuj.md a proveď jeho kroky 1 až 8 přesně, ale jen pro JEDNU položku — první nezaškrtnutou v docs/progress.md. Krok 9 (pokračování další položkou) neprováděj. Když je první položka STOP nebo RUČNĚ, nic nedělej a skonči. Nikdy se uživatele na nic neptej, běží to bez dozoru: když něco nejde, položku nezaškrtávej, popiš proč a skonči. Běh končí s tvým posledním tahem: subagenty spouštěj vždy v popředí (run_in_background: false) a počkej na jejich výsledek, nikdy nekonči tah, dokud práce běží na pozadí. Dev server nespouštěj na pozadí přes nástroj Bash; pro e2e ho spustí Playwright sám, a když na :3000 už běží, použij ho. Když v pracovní složce najdeš nekomitnutou rozdělanou práci na téže položce, navaž na ni. Migraci databáze (bun run db:migrate, supabase db push) nikdy nespouštěj ani nezkoušej: když je položka hotová a čeká jen na migraci, nech všechno commitnuté na její větvi, nic nepushuj a hned skonči, bez lintu, testů, buildu a e2e (proběhnou po migraci); migraci spustí noční skript a položku pustí znovu. Když migrace položky už ve vzdálené databázi je (supabase migration list), spusť bun run db:types a dokonči položku (e2e, merge do main, zaškrtnutí, push). Na konci vypiš česky krátký přehled jako v pokracuj.md.'

log() { echo "$(date '+%F %T')  $*" | tee -a "$LOG"; }

first_open() { grep -m1 '^- \[ \]' docs/progress.md; }

# Spustí čekající migrace, když jen přidávají a projdou testy. 0 = spuštěno.
migrated_for=""
try_migrate() {
  [ "$AUTO_MIGRATE" = 1 ] || return 1
  [ "$migrated_for" = "$next" ] && return 1
  local pending files v f
  pending="$(python3 scripts/noc-migrace.py pending 2>>"$LOG")" || {
    log "Stav migrací nejde zjistit (supabase migration list), migraci nechávám tobě."; return 1; }
  [ -z "$pending" ] && return 1
  if [ -n "$(git status --porcelain -- supabase/migrations)" ]; then
    log "Migrace nejsou commitnuté, nechávám je tobě."; return 1
  fi
  files=""
  for v in $pending; do
    f="$(ls supabase/migrations/"$v"_*.sql 2>/dev/null | head -1)"
    [ -z "$f" ] && { log "Migrace $v je ve výpisu, ale ne v souboru, nechávám ji tobě."; return 1; }
    files="$files $f"
  done
  log "Čekající migrace na větvi $(git branch --show-current):$files"
  if ! python3 scripts/noc-migrace.py check $files >>"$LOG" 2>&1; then
    log "Migrace jen nepřidává (důvod v logu výš), spusť ji sám po kontrole."; return 1
  fi
  log "Migrace jen přidává, pouštím bun run test."
  if ! bun run test >>"$LOG" 2>&1; then
    log "Testy neprošly, migraci nespouštím."; return 1
  fi
  log "Spouštím migraci (supabase db push)."
  if ! perl -e 'alarm shift; exec @ARGV' 600 bunx supabase db push --yes </dev/null >>"$LOG" 2>&1; then
    log "supabase db push selhal (výstup v logu výš), nechávám to tobě."; return 1
  fi
  bun run db:types >>"$LOG" 2>&1 || log "bun run db:types selhal, položka si typy vygeneruje sama."
  if ! git diff --quiet -- src/types/database.ts; then
    git add src/types/database.ts && git commit -qm "Regenerate database types after migration" && log "Typy commitnuté."
  fi
  migrated_for="$next"
  log "Migrace spuštěná:$files"
  return 0
}

log "Začátek nočního běhu."
stuck=0
limit_waits=0
done_items=0
RUN_OUT=".noc/posledni-beh.txt"

while [ "$done_items" -lt "$MAX_ITEMS" ]; do
  next="$(first_open)"
  if [ -z "$next" ]; then log "Hotovo, v plánu nic nezbývá."; break; fi
  case "$next" in
    "- [ ] STOP"*)
      if [ "$SKIP_STOPS" = 1 ]; then
        log "Přeskakuji zastávku, nechávám ti ji na ráno."
        printf -- '- [ ] %s\n' "${next#- \[ \] STOP | }" >> .noc/zkontroluj.md
        python3 - "$next" <<'PYEOF'
import sys, io, datetime
line = sys.argv[1]
p = "docs/progress.md"
s = io.open(p, encoding="utf-8").read()
new = line.replace("- [ ] STOP", "- [x] STOP", 1) + " · přeskočeno nočním během " + datetime.date.today().isoformat() + ", zkontroluj ručně (.noc/zkontroluj.md)"
io.open(p, "w", encoding="utf-8").write(s.replace(line, new, 1))
PYEOF
        git add docs/progress.md && git commit -qm "Skip manual stop in overnight run" && git push -q
        continue
      fi
      log "Zastávka, dál jen s tebou:"; log "$next"; break ;;
    *"| RUČNĚ |"*)
      log "Ruční krok, dál jen s tebou:"; log "$next"; break ;;
  esac

  # Migrace, která už na větvi čeká (třeba po restartu), jde hned, ať Claude
  # položku rovnou dokončí a neprojde ji jednou zbytečně.
  if try_migrate; then log "Migrace spuštěná předem, Claude položku rovnou dokončí."; fi

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

  if [ "$(first_open)" = "$next" ] && try_migrate; then
    log "Pouštím položku znovu, ať ji Claude dokončí."
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
    limit_waits=0
    done_items=$((done_items + 1))
    log "Hotovo: $next"
  fi
done

log "Konec nočního běhu. Hotových položek: $done_items."
[ -s .noc/zkontroluj.md ] && log "Přeskočené zastávky k ruční kontrole jsou v .noc/zkontroluj.md."
