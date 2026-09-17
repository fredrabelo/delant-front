<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, useRuntimeConfig } from '#imports'

const { locale, locales, setLocale, t } = useI18n()
const config = useRuntimeConfig()

const appName = computed(() => config.public.appName)
const availableLocales = computed(() => locales.value)
</script>

<template>
  <div class="min-h-screen flex flex-col bg-muted/40">
    <header class="border-b bg-card">
      <div class="container flex items-center justify-between py-3">
        <span class="flex items-center gap-2.5 text-base font-semibold tracking-tight">
          <img src="/logo.png" :alt="appName" class="h-6 w-auto">
        </span>
        <div
          class="flex items-center border border-input bg-background p-0.5"
          :aria-label="t('common.language')"
        >
          <button
            v-for="loc in availableLocales"
            :key="loc.code"
            type="button"
            class="px-2 py-1 text-xs font-medium uppercase transition-colors"
            :class="loc.code === locale
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'"
            :aria-current="loc.code === locale ? 'true' : undefined"
            @click="setLocale(loc.code)"
          >
            {{ loc.code }}
          </button>
        </div>
      </div>
    </header>
    <main class="flex-1 flex items-center justify-center p-4">
      <slot />
    </main>
  </div>
</template>
