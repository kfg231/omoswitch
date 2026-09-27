import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import ja from "./ja.json";
import en from "./en.json";

export const LANG_STORAGE_KEY = "omoswitch.lang";
export const SUPPORTED_LANGS = ["ja", "en"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const resources = { ja: { translation: ja }, en: { translation: en } } as const;

function storedLang(): Lang {
  const raw = globalThis.localStorage?.getItem(LANG_STORAGE_KEY);
  return SUPPORTED_LANGS.find((lang) => lang === raw) ?? "ja";
}

export function setLanguage(lang: Lang): void {
  globalThis.localStorage?.setItem(LANG_STORAGE_KEY, lang);
  void i18next.changeLanguage(lang);
}

export function initI18n(): typeof i18next {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: storedLang(),
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  }
  return i18next;
}

export default i18next;
