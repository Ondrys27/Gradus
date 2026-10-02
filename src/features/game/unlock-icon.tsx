import { createElement } from "react";
import {
  AwardIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  ChartLineIcon,
  CompassIcon,
  ContactRoundIcon,
  CrownIcon,
  FlagIcon,
  FlameIcon,
  FootprintsIcon,
  HammerIcon,
  HandshakeIcon,
  MedalIcon,
  MessageCircleIcon,
  MountainIcon,
  NetworkIcon,
  PaletteIcon,
  PhoneCallIcon,
  PresentationIcon,
  SparklesIcon,
  SquareKanbanIcon,
  SunriseIcon,
  TrendingUpIcon,
  TrophyIcon,
  UsersRoundIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Icons the database names (unlock_definitions, achievements, paths) by their
 * lucide name. Only these are bundled; an unknown name shows sparkles.
 */
const ICONS: Record<string, LucideIcon> = {
  award: AwardIcon,
  "book-open": BookOpenIcon,
  briefcase: BriefcaseIcon,
  calculator: CalculatorIcon,
  "calendar-days": CalendarDaysIcon,
  "chart-line": ChartLineIcon,
  compass: CompassIcon,
  "contact-round": ContactRoundIcon,
  crown: CrownIcon,
  flag: FlagIcon,
  flame: FlameIcon,
  footprints: FootprintsIcon,
  hammer: HammerIcon,
  handshake: HandshakeIcon,
  medal: MedalIcon,
  "message-circle": MessageCircleIcon,
  mountain: MountainIcon,
  network: NetworkIcon,
  palette: PaletteIcon,
  "phone-call": PhoneCallIcon,
  presentation: PresentationIcon,
  "square-kanban": SquareKanbanIcon,
  sunrise: SunriseIcon,
  "trending-up": TrendingUpIcon,
  trophy: TrophyIcon,
  "users-round": UsersRoundIcon,
  wallet: WalletIcon,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? SparklesIcon;
}

export function GameIcon({ name, className }: { name: string; className?: string }) {
  return createElement(iconFor(name), { "aria-hidden": true, className });
}
