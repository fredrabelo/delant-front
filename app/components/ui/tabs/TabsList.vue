<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TabsList, type TabsListProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsListProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <TabsList
    v-bind="props"
    :class="cn('inline-flex h-9 items-center gap-1 border bg-muted/40 p-1 text-muted-foreground', props.class)"
  >
    <slot />
  </TabsList>
</template>
