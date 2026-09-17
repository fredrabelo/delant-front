<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <tr
    :class="cn('border-b transition-colors last:border-0 hover:bg-accent/60 data-[state=selected]:bg-accent', props.class)"
  >
    <slot />
  </tr>
</template>
