import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "../locales/en/common.json";
import zhCommon from "../locales/zh/common.json";
import enConnections from "../locales/en/connections.json";
import zhConnections from "../locales/zh/connections.json";
import enEditor from "../locales/en/editor.json";
import zhEditor from "../locales/zh/editor.json";
import enQuery from "../locales/en/query.json";
import zhQuery from "../locales/zh/query.json";
import enSchema from "../locales/en/schema.json";
import zhSchema from "../locales/zh/schema.json";
import enSettings from "../locales/en/settings.json";
import zhSettings from "../locales/zh/settings.json";
import enMemcached from "../locales/en/memcached.json";
import zhMemcached from "../locales/zh/memcached.json";
import enZookeeper from "../locales/en/zookeeper.json";
import zhZookeeper from "../locales/zh/zookeeper.json";
import enExport from "../locales/en/export.json";
import zhExport from "../locales/zh/export.json";
const resources = {
  en: {
    common: enCommon,
    connections: enConnections,
    editor: enEditor,
    query: enQuery,
    schema: enSchema,
    settings: enSettings,
    memcached: enMemcached,
    zookeeper: enZookeeper,
    export: enExport,
  },
  zh: {
    common: zhCommon,
    connections: zhConnections,
    editor: zhEditor,
    query: zhQuery,
    schema: zhSchema,
    settings: zhSettings,
    memcached: zhMemcached,
    zookeeper: zhZookeeper,
    export: zhExport,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "zh",
    fallbackNS: "common",
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
