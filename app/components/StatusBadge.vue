<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#imports'
import { cn } from '@/lib/utils'

/**
 * Small status pill for research / study / population statuses.
 * Label comes from i18n key `status.<status>`; color is derived from a map.
 */
const props = defineProps<{
  status: string
  class?: string
}>()

const { t } = useI18n()

const label = computed(() => t(`status.${props.status}`))

/*
 * Tonal statuses on a shared tint + hairline recipe, so a column of them reads
 * as one set. Work-in-progress states use the teal `data` tone to separate
 * "running" from "finished" at a glance.
 */
const toneClass = computed(() => {
  switch (props.status) {
    // Finished and healthy.
    case 'ready':
    case 'active':
    case 'completed':
    case 'done':
      return 'border-success/25 bg-success/10 text-success'
    // Work in flight — teal separates "running" from "finished" at a glance.
    case 'generating':
    case 'running':
      return 'border-data/25 bg-data/10 text-data'
    // Committed and immutable: marked in the brand ink, not as a warning.
    case 'frozen':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'error':
      return 'border-destructive/25 bg-destructive/10 text-destructive'
    // Inert states stay quiet.
    case 'draft':
    case 'archived':
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
})
</script>

<template>
  <span
    :class="cn(
      'inline-flex items-center border px-2 py-0.5 text-xs font-medium',
      toneClass,
      props.class,
    )"
  >
    {{ label }}
  </span>
</template>
