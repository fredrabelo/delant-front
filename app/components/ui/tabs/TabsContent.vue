<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { TabsContent, type TabsContentProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsContentProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <TabsContent v-bind="props" :class="cn('mt-3 focus-visible:outline-none', props.class)">
    <slot />
  </TabsContent>
</template>
