<script setup lang="ts">
import type { Component } from 'vue'
import { Card, CardContent } from '@/components/ui/card'

/**
 * A single measured figure for dashboard/summary rows — a shadcn Card with the
 * "reading" treatment (ink top rule, tabular figures). Optional lucide icon and
 * a hint line. Consistent across every screen that shows counts/metrics.
 */
defineProps<{
  label: string
  value: string | number
  hint?: string
  icon?: Component
}>()
</script>

<template>
  <Card class="border-t-2 border-t-primary">
    <CardContent class="flex items-start justify-between gap-3 p-5">
      <div class="space-y-1">
        <p class="text-sm text-muted-foreground">{{ label }}</p>
        <p class="text-2xl font-semibold tracking-tight tabular-nums">{{ value }}</p>
        <p v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
      </div>
      <span
        v-if="icon"
        class="grid h-9 w-9 shrink-0 place-items-center bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <component :is="icon" class="h-5 w-5" />
      </span>
    </CardContent>
  </Card>
</template>
