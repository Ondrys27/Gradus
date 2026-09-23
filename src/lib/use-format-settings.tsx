"use client";

import { createContext, useContext } from "react";
import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from "./format";

export const FormatSettingsContext = createContext<FormatSettings>(DEFAULT_FORMAT_SETTINGS);

/** The signed-in user's formats from `user_settings`; defaults outside the app. */
export function useFormatSettings(): FormatSettings {
  return useContext(FormatSettingsContext);
}
