<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '#imports'
import {
  Dialog,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type { AgentGrounding } from '@/types/api'

export interface AgentResponseContext {
  /** e.g. the event/question title, so multiple contexts (A vs B) are distinguishable. */
  label: string
  /** The question/stimulus text actually presented. */
  stimulusText: string
  /** The structured answer, as label/value pairs (sentiment, stance, valueJson, explanation, ...). */
  answer: Array<{ label: string, value: string }>
}

/**
 * "Which profile said this, and what exactly was asked and answered?" — one
 * agent's persona (recomputed on demand via GET /agents/:id/grounding, the
 * same pure function the LLM call itself used — see GroundingService.compile)
 * plus one or more question/answer pairs for that agent, for a survey
 * response, a diffusion opinion, or a side-by-side compare row (two contexts:
 * the same agent's answer in event A and event B).
 */
const props = defineProps<{
  open: boolean
  agentId: string | null
  agentName?: string | null
  /** The grounding compiler key used to generate the answer(s) shown. */
  compilerKey: string
  responses: AgentResponseContext[]
}>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const { t } = useI18n()
const api = useApi()

const loading = ref(false)
const error = ref<string | null>(null)
const grounding = ref<AgentGrounding | null>(null)

// Only these 4 sections are persona (stimulus-independent); currentStimulus
// just echoes back whatever stimulus was passed in, so it's rendered per
// response context below from data we already have, not from this fetch.
const personaSectionKeys = ['knownFacts', 'observedHistory', 'syntheticPriors', 'currentMentalState'] as const

watch(
  () => [props.open, props.agentId] as const,
  async ([isOpen, agentId]) => {
    if (!isOpen || !agentId) return
    loading.value = true
    error.value = null
    grounding.value = null
    try {
      grounding.value = await api.get<AgentGrounding>(`/agents/${agentId}/grounding`, {
        query: { compiler: props.compilerKey, stimulus: props.responses[0]?.stimulusText ?? '' },
      })
    }
    catch (err) {
      error.value = (err as ApiError)?.message ?? t('common.error')
    }
    finally {
      loading.value = false
    }
  },
)
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogScrollContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          {{ agentName || t('agentGrounding.agentFallback', { id: agentId }) }}
        </DialogTitle>
        <DialogDescription>{{ t('agentGrounding.subtitle') }}</DialogDescription>
      </DialogHeader>

      <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
      <p v-else-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

      <div v-else-if="grounding" class="space-y-5">
        <div v-for="ctx in responses" :key="ctx.label" class="space-y-2 rounded border p-3">
          <h3 class="text-sm font-semibold">{{ ctx.label }}</h3>
          <div class="space-y-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {{ t('agentGrounding.sections.currentStimulus') }}
            </h4>
            <p class="whitespace-pre-wrap rounded border bg-muted/30 p-3 text-sm">{{ ctx.stimulusText || '—' }}</p>
          </div>
          <div class="space-y-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {{ t('agentGrounding.answer') }}
            </h4>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              <div v-for="item in ctx.answer" :key="item.label">
                <dt class="text-xs text-muted-foreground">{{ item.label }}</dt>
                <dd class="font-medium">{{ item.value || '—' }}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div class="space-y-4">
          <h3 class="text-sm font-semibold">{{ t('agentGrounding.profile') }}</h3>
          <div v-for="key in personaSectionKeys" :key="key" class="space-y-1">
            <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {{ t(`agentGrounding.sections.${key}`) }}
            </h4>
            <p class="whitespace-pre-wrap rounded border bg-muted/30 p-3 text-sm">
              {{ grounding.sections[key] || '—' }}
            </p>
          </div>
        </div>

        <p class="font-mono text-xs text-muted-foreground">
          {{ t('agentGrounding.compiler') }}: {{ grounding.compilerKey }} · {{ t('agentGrounding.hash') }}: {{ grounding.groundingHash.slice(0, 12) }}…
        </p>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
