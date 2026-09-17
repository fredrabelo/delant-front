<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/PageHeader.vue'
import RegistrySelect from '@/components/RegistrySelect.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useActiveClient } from '@/composables/useActiveClient'
import type { LlmCredentialStatus, LlmDefault, LlmModel, LlmStatus, RegistryOption } from '@/types/api'

const { t } = useI18n()
const api = useApi()
const { activeMembership } = useActiveClient()

const status = ref<LlmStatus | null>(null)
const providers = ref<RegistryOption[]>([])
const defaults = ref<LlmDefault[]>([])
const credentials = ref<LlmCredentialStatus[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// Purposes a researcher can pin a default model to. `ai_analysis_*` feed
// AiAnalysisService.resolveModel(); `study_run` feeds StudyRunsService.freeze()
// when a run is created without an explicit provider/model.
const PURPOSE_KEYS = ['ai_analysis_run', 'ai_analysis_study', 'ai_analysis_research', 'study_run'] as const

const canEdit = computed(() => {
  const role = activeMembership.value?.role
  return role === 'owner' || role === 'admin'
})

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [st, provs, defs, creds] = await Promise.all([
      api.get<LlmStatus>('/llm/status'),
      api.get<RegistryOption[]>('/llm/providers/options'),
      api.get<LlmDefault[]>('/llm/defaults'),
      api.get<LlmCredentialStatus[]>('/llm/credentials'),
    ])
    status.value = st
    providers.value = provs ?? []
    defaults.value = defs ?? []
    credentials.value = creds ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

function providerModels(provider: RegistryOption): LlmModel[] {
  return (provider.meta?.models as LlmModel[] | undefined) ?? []
}

function providerAvailable(providerKey: string): boolean {
  return Boolean(status.value?.providers?.[providerKey])
}

function pricingText(pricing: unknown, unconfirmed?: boolean): string {
  if (pricing === null || pricing === undefined) {
    return '—'
  }
  const text = typeof pricing === 'string' || typeof pricing === 'number'
    ? String(pricing)
    : JSON.stringify(pricing)
  return unconfirmed ? `${text} ${t('llm.unconfirmedPricingSuffix')}` : text
}

const enabled = computed(() => Boolean(status.value?.enabled))

/* -------------------- credentials (BYO key) -------------------- */
const credentialInput = ref<Record<string, string>>({})
const credentialSaving = ref<Record<string, boolean>>({})
const credentialError = ref<Record<string, string | null>>({})
const credentialSavedFlash = ref<Record<string, boolean>>({})

function credentialFor(providerKey: string): LlmCredentialStatus | undefined {
  return credentials.value.find(c => c.providerKey === providerKey)
}

function formatDate(value?: string): string {
  if (!value) return ''
  return new Date(value).toLocaleDateString()
}

async function saveCredential(providerKey: string) {
  const apiKey = credentialInput.value[providerKey]?.trim()
  if (!apiKey) return
  credentialSaving.value[providerKey] = true
  credentialError.value[providerKey] = null
  try {
    const updated = await api.put<LlmCredentialStatus>(`/llm/credentials/${providerKey}`, { apiKey })
    const idx = credentials.value.findIndex(c => c.providerKey === providerKey)
    if (idx >= 0) credentials.value[idx] = updated
    else credentials.value.push(updated)
    credentialInput.value[providerKey] = ''
    credentialSavedFlash.value[providerKey] = true
    setTimeout(() => { credentialSavedFlash.value[providerKey] = false }, 2000)
  }
  catch (err) {
    credentialError.value[providerKey] = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    credentialSaving.value[providerKey] = false
  }
}

async function removeCredential(providerKey: string) {
  if (!confirm(t('llm.credentials.removeConfirm'))) return
  credentialSaving.value[providerKey] = true
  credentialError.value[providerKey] = null
  try {
    await api.delete(`/llm/credentials/${providerKey}`)
    const idx = credentials.value.findIndex(c => c.providerKey === providerKey)
    if (idx >= 0) credentials.value[idx] = { providerKey, configured: false }
  }
  catch (err) {
    credentialError.value[providerKey] = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    credentialSaving.value[providerKey] = false
  }
}

/* -------------------- defaults form -------------------- */
const form = ref<Record<string, { provider: string, model: string }>>({})
const saving = ref<Record<string, boolean>>({})
const saveError = ref<Record<string, string | null>>({})
const savedFlash = ref<Record<string, boolean>>({})

function resetForm() {
  const next: Record<string, { provider: string, model: string }> = {}
  for (const key of PURPOSE_KEYS) {
    const existing = defaults.value.find(d => d.purposeKey === key)
    next[key] = { provider: existing?.provider ?? '', model: existing?.model ?? '' }
  }
  form.value = next
}

function defaultFor(purposeKey: string): LlmDefault | undefined {
  return defaults.value.find(d => d.purposeKey === purposeKey)
}

function modelsFor(providerKey: string): string[] {
  const provider = providers.value.find(p => p.key === providerKey)
  return providerModels(provider ?? { key: '', labelKey: '' }).map(m => m.key)
}

function onProviderChange(purposeKey: string) {
  const entry = form.value[purposeKey]
  if (!entry) return
  const models = modelsFor(entry.provider)
  if (!models.includes(entry.model)) entry.model = ''
}

async function saveDefault(purposeKey: string) {
  const entry = form.value[purposeKey]
  if (!entry?.provider || !entry.model) return
  saving.value[purposeKey] = true
  saveError.value[purposeKey] = null
  try {
    const updated = await api.put<LlmDefault>(`/llm/defaults/${purposeKey}`, {
      provider: entry.provider,
      model: entry.model,
    })
    const idx = defaults.value.findIndex(d => d.purposeKey === purposeKey)
    if (idx >= 0) defaults.value[idx] = updated
    else defaults.value.push(updated)
    savedFlash.value[purposeKey] = true
    setTimeout(() => { savedFlash.value[purposeKey] = false }, 2000)
  }
  catch (err) {
    saveError.value[purposeKey] = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    saving.value[purposeKey] = false
  }
}

onMounted(async () => {
  await loadData()
  resetForm()
})
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <PageHeader
      :title="t('llm.title')"
      :description="t('llm.subtitle')"
    />

    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="status">
      <!-- Global status -->
      <Card>
        <CardHeader class="flex-row items-start justify-between gap-4 space-y-0">
          <div class="space-y-1.5">
            <CardTitle class="text-lg">{{ t('llm.statusTitle') }}</CardTitle>
            <CardDescription>{{ t('llm.statusSubtitle') }}</CardDescription>
          </div>
          <span
            class="inline-flex items-center px-2 py-0.5 text-xs font-medium"
            :class="enabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
          >
            {{ enabled ? t('llm.enabled') : t('llm.disabled') }}
          </span>
        </CardHeader>
        <CardContent class="space-y-3">
        <div class="border-l-2 border-muted-foreground/30 pl-3 text-sm text-muted-foreground">
          {{ t('llm.disabledNote') }}
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium">{{ t('llm.providers') }}</p>
          <ul class="grid gap-2 sm:grid-cols-3">
            <li
              v-for="provider in providers"
              :key="provider.key"
              class="flex items-center justify-between gap-2 border p-3"
            >
              <span class="text-sm">{{ t(provider.labelKey) }}</span>
              <span
                class="inline-flex items-center px-2 py-0.5 text-xs font-medium"
                :class="providerAvailable(provider.key)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-destructive text-destructive-foreground'"
              >
                {{ providerAvailable(provider.key) ? t('llm.available') : t('llm.unavailable') }}
              </span>
            </li>
          </ul>
        </div>
        </CardContent>
      </Card>

      <!-- API keys (BYO key) -->
      <section class="space-y-4">
        <div class="space-y-1.5">
          <h2 class="text-lg font-medium">{{ t('llm.credentials.title') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('llm.credentials.subtitle') }}</p>
        </div>
        <Card>
          <CardContent class="divide-y pt-6">
            <div
              v-for="cred in credentials"
              :key="cred.providerKey"
              class="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div class="min-w-[8rem]">
                <p class="font-medium">{{ t(`registry.llm_provider.${cred.providerKey}`) }}</p>
                <p class="text-xs text-muted-foreground">
                  <template v-if="cred.configured">
                    {{ t('llm.credentials.lastFour', { lastFour: cred.lastFour }) }}
                    <template v-if="cred.updatedAt"> · {{ t('llm.credentials.updatedAt', { date: formatDate(cred.updatedAt) }) }}</template>
                  </template>
                  <template v-else>{{ t('llm.credentials.notConfigured') }}</template>
                </p>
              </div>

              <template v-if="canEdit">
                <div class="flex flex-1 min-w-[16rem] items-center gap-2">
                  <Input
                    v-model="credentialInput[cred.providerKey]"
                    type="password"
                    autocomplete="off"
                    :placeholder="t('llm.credentials.placeholder')"
                    class="flex-1"
                  />
                  <Button
                    size="sm"
                    :disabled="!credentialInput[cred.providerKey]?.trim() || credentialSaving[cred.providerKey]"
                    @click="saveCredential(cred.providerKey)"
                  >
                    {{ credentialSaving[cred.providerKey] ? t('common.saving') : t('llm.credentials.save') }}
                  </Button>
                  <Button
                    v-if="cred.configured"
                    size="sm"
                    variant="outline"
                    :disabled="credentialSaving[cred.providerKey]"
                    @click="removeCredential(cred.providerKey)"
                  >
                    {{ t('llm.credentials.remove') }}
                  </Button>
                  <span v-if="credentialSavedFlash[cred.providerKey]" class="text-xs text-primary">{{ t('llm.credentials.saved') }}</span>
                </div>
                <p v-if="credentialError[cred.providerKey]" class="w-full text-xs text-destructive">
                  {{ credentialError[cred.providerKey] }}
                </p>
              </template>
              <span
                v-else
                class="inline-flex items-center px-2 py-0.5 text-xs font-medium"
                :class="cred.configured ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
              >
                {{ cred.configured ? t('llm.credentials.configured') : t('llm.credentials.notConfigured') }}
              </span>
            </div>
            <p v-if="!canEdit" class="pt-3 text-xs text-muted-foreground">{{ t('llm.credentials.editRequiresAdmin') }}</p>
          </CardContent>
        </Card>
      </section>

      <!-- Defaults per purpose -->
      <section class="space-y-4">
        <div class="space-y-1.5">
          <h2 class="text-lg font-medium">{{ t('llm.defaultsTitle') }}</h2>
          <p class="text-sm text-muted-foreground">{{ t('llm.defaultsSubtitle') }}</p>
        </div>
        <Card>
          <CardContent class="pt-6">
            <div class="overflow-x-auto border">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                    <th class="px-3 py-2 font-medium">{{ t('llm.columns.purpose') }}</th>
                    <th class="px-3 py-2 font-medium">{{ t('llm.columns.provider') }}</th>
                    <th class="px-3 py-2 font-medium">{{ t('llm.columns.model') }}</th>
                    <th v-if="canEdit" class="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="key in PURPOSE_KEYS"
                    :key="key"
                    class="border-b last:border-b-0 align-top"
                  >
                    <td class="px-3 py-3">
                      <p class="font-medium">{{ t(`llm.purposes.${key}.label`) }}</p>
                      <p class="text-xs text-muted-foreground">{{ t(`llm.purposes.${key}.hint`) }}</p>
                    </td>
                    <template v-if="canEdit && form[key]">
                      <td class="px-3 py-3">
                        <RegistrySelect
                          v-model="form[key]!.provider"
                          :options="providers"
                          :placeholder="t('common.select')"
                          class="min-w-[10rem]"
                          @update:model-value="onProviderChange(key)"
                        />
                      </td>
                      <td class="px-3 py-3">
                        <select
                          v-model="form[key]!.model"
                          :disabled="modelsFor(form[key]!.provider).length === 0"
                          class="field-select min-w-[12rem]"
                        >
                          <option value="">{{ t('common.select') }}</option>
                          <option v-for="m in modelsFor(form[key]!.provider)" :key="m" :value="m">{{ m }}</option>
                        </select>
                      </td>
                      <td class="px-3 py-3">
                        <div class="flex items-center gap-2">
                          <Button
                            size="sm"
                            :disabled="!form[key]!.provider || !form[key]!.model || saving[key]"
                            @click="saveDefault(key)"
                          >
                            {{ saving[key] ? t('common.saving') : t('common.save') }}
                          </Button>
                          <span v-if="savedFlash[key]" class="text-xs text-primary">{{ t('common.saved') }}</span>
                        </div>
                        <p v-if="saveError[key]" class="mt-1 text-xs text-destructive">{{ saveError[key] }}</p>
                      </td>
                    </template>
                    <template v-else>
                      <td class="px-3 py-3">
                        {{ defaultFor(key)?.provider ? t(`registry.llm_provider.${defaultFor(key)!.provider}`) : '—' }}
                      </td>
                      <td class="px-3 py-3">{{ defaultFor(key)?.model ?? '—' }}</td>
                    </template>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="!canEdit" class="mt-3 text-xs text-muted-foreground">{{ t('llm.editRequiresAdmin') }}</p>
          </CardContent>
        </Card>
      </section>

      <!-- Providers + models -->
      <section class="space-y-4">
        <h2 class="text-lg font-medium">{{ t('llm.modelsTitle') }}</h2>
        <Card
          v-for="provider in providers"
          :key="`models-${provider.key}`"
        >
          <CardContent class="space-y-3 pt-6">
          <div class="flex items-center justify-between gap-2">
            <p class="font-medium">{{ t(provider.labelKey) }}</p>
            <span
              class="inline-flex items-center px-2 py-0.5 text-xs font-medium"
              :class="providerAvailable(provider.key)
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'"
            >
              {{ providerAvailable(provider.key) ? t('llm.available') : t('llm.unavailable') }}
            </span>
          </div>

          <div class="overflow-x-auto border">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/60 text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-xs [&>th]:font-semibold [&>th]:text-ink-600">
                  <th class="px-3 py-2 font-medium">{{ t('llm.columns.model') }}</th>
                  <th class="px-3 py-2 font-medium">{{ t('llm.columns.pricing') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="model in providerModels(provider)"
                  :key="model.key"
                  class="border-b last:border-b-0"
                >
                  <td class="px-3 py-2">{{ model.key }}</td>
                  <td class="px-3 py-2">{{ pricingText(model.pricing, model.unconfirmedPricing) }}</td>
                </tr>
                <tr v-if="providerModels(provider).length === 0">
                  <td colspan="2" class="px-3 py-6 text-center text-muted-foreground">
                    {{ t('llm.noModels') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </CardContent>
        </Card>
      </section>
    </template>
  </div>
</template>
