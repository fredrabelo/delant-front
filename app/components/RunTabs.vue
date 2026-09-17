<script setup lang="ts">
import { NuxtLink } from '#components'
import { useRoute } from '#app'

/**
 * Per-run tab navigation (SPEC 8): Overview / Statistics / Visualizations /
 * Diffusion as separate screens for one run. The active tab is derived from the
 * current route path so it works on every sub-page without extra state.
 */
defineProps<{ tabs: Array<{ to: string; label: string }> }>()
const route = useRoute()
</script>

<template>
  <nav class="flex flex-wrap gap-1 border-b" aria-label="run sections">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors"
      :class="route.path === tab.to
        ? 'border-primary font-medium text-primary'
        : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'"
      :aria-current="route.path === tab.to ? 'page' : undefined"
    >
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>
