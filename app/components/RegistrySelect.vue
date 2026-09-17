<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#imports'
import { cn } from '@/lib/utils'
import type { RegistryOption } from '@/types/api'

/**
 * Native select bound to a registry option list. Renders each option's
 * i18n label via `$t(option.labelKey)`; v-model tracks `option.key`.
 */
const props = defineProps<{
  modelValue?: string | null
  options: RegistryOption[]
  id?: string
  placeholder?: string
  disabled?: boolean
  class?: string
  /** Show the selected option's `descriptionKey` text below the select. */
  showHelp?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { t } = useI18n()

const model = computed<string>({
  get: () => props.modelValue ?? '',
  set: value => emits('update:modelValue', value),
})

const selectedDescriptionKey = computed(
  () => props.options.find(o => o.key === model.value)?.descriptionKey,
)
</script>

<template>
  <div>
    <select
      :id="id"
      v-model="model"
      :disabled="disabled"
      :class="cn('field-select', props.class)"
    >
      <option v-if="placeholder" value="" disabled>
        {{ placeholder }}
      </option>
      <option
        v-for="opt in options"
        :key="opt.key"
        :value="opt.key"
      >
        {{ t(opt.labelKey) }}
      </option>
    </select>
    <p v-if="showHelp && selectedDescriptionKey" class="mt-1.5 text-xs text-muted-foreground">
      {{ t(selectedDescriptionKey) }}
    </p>
  </div>
</template>
