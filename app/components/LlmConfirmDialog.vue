<script setup lang="ts">
import { useI18n } from '#imports'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Transparency gate before ANY button that fires an LLM call — run execution
 * (sync or batch) and every AI-analysis level (run/study/research). Shows
 * execution mode, provider/model, call count and cost estimate; nothing is
 * sent to the LLM until the user confirms here. Generic across both callers
 * (AiAnalysisPanel and the run execution card) — no level-specific logic.
 */
const props = defineProps<{
  open: boolean
  mode: 'sync' | 'batch' | 'analysis'
  provider?: string | null
  model: string
  calls: number
  estCostUsd: number
  /** Optional extra breakdown line under "calls" (e.g. "1.971 agentes × 24 itens"). */
  callsDetail?: string | null
  confirming?: boolean
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  confirm: []
  cancel: []
}>()

const { t } = useI18n()

function onCancel() {
  emit('cancel')
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('llmConfirm.title') }}</DialogTitle>
        <DialogDescription>{{ t('llmConfirm.subtitle') }}</DialogDescription>
      </DialogHeader>

      <dl class="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-muted-foreground">{{ t('llmConfirm.mode') }}</dt>
          <dd class="font-medium">{{ t(`llmConfirm.modeValue.${mode}`) }}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('llmConfirm.model') }}</dt>
          <dd class="font-medium">
            <template v-if="provider">{{ t(`registry.llm_provider.${provider}`, provider) }} · </template>{{ model }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('llmConfirm.calls') }}</dt>
          <dd class="font-medium tabular-nums">{{ calls.toLocaleString() }}</dd>
          <dd v-if="callsDetail" class="text-xs text-muted-foreground">{{ callsDetail }}</dd>
        </div>
        <div>
          <dt class="text-muted-foreground">{{ t('llmConfirm.estCost') }}</dt>
          <dd class="text-lg font-semibold tabular-nums text-primary">${{ estCostUsd.toFixed(4) }}</dd>
        </div>
      </dl>

      <DialogFooter>
        <Button variant="outline" :disabled="confirming" @click="onCancel">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="confirming" @click="emit('confirm')">
          {{ confirming ? t('common.loading') : t('llmConfirm.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
