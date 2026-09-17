// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Tailwind v4 is wired through its Vite plugin (CSS-first), not the Nuxt
  // module. The stylesheet is loaded directly via `css` below.
  css: ['~/assets/css/tailwind.css'],
  vite: {
    plugins: [tailwindcss()],
  },

  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          // IBM Plex Sans — institutional/scientific character with full
          // Latin-Extended coverage for pt-BR. Three weights only, to keep
          // the font payload small. Loaded via <link> rather than a Nuxt
          // font module so no new runtime dependency is introduced.
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap',
        },
      ],
    },
  },

  modules: [
    'shadcn-nuxt',
    '@nuxtjs/i18n',
  ],

  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:5000/api',
      appName: process.env.NUXT_PUBLIC_APP_NAME || 'delant',
    },
  },

  shadcn: {
    prefix: '',
    componentDir: '~/components/ui',
  },

  i18n: {
    // no_prefix: locale is a pure user preference persisted in a cookie, with
    // NO URL prefix. This is what makes the choice survive every navigation —
    // plain <NuxtLink to="/x"> links no longer snap back to the default locale
    // (the previous prefix_except_default strategy did, since unprefixed paths
    // always resolved to pt-BR). Right call for an internal dashboard (no SEO
    // need for per-locale URLs).
    strategy: 'no_prefix',
    defaultLocale: 'pt-BR',
    langDir: 'locales',
    locales: [
      { code: 'pt-BR', language: 'pt-BR', name: 'Português (Brasil)', file: 'pt-BR.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      fallbackLocale: 'pt-BR',
    },
  },
})
