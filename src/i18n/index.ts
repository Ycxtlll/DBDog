import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './en/common.json';
import enConnections from './en/connections.json';
import enEditor from './en/editor.json';
import enQuery from './en/query.json';
import enSettings from './en/settings.json';
import zhCommon from './zh/common.json';
import zhConnections from './zh/connections.json';
import zhEditor from './zh/editor.json';
import zhQuery from './zh/query.json';
import zhSettings from './zh/settings.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        connections: enConnections,
        editor: enEditor,
        query: enQuery,
        settings: enSettings,
      },
      zh: {
        common: zhCommon,
        connections: zhConnections,
        editor: zhEditor,
        query: zhQuery,
        settings: zhSettings,
      },
    },
    fallbackLng: 'en',
    ns: ['common', 'connections', 'editor', 'query', 'settings'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  });

export default i18n;
