<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  FlexRender,
  type ColumnDef,
  getCoreRowModel,
  useVueTable,
} from '@tanstack/vue-table'
import { useI18n } from '#imports'
import { useRoute, navigateTo } from '#app'
import { NuxtLink } from '#components'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import RegistrySelect from '@/components/RegistrySelect.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import AiAnalysisPanel from '@/components/AiAnalysisPanel.vue'
import PageHeader from '@/components/PageHeader.vue'
import RunAllButton from '@/components/RunAllButton.vue'
import CheckAllButton from '@/components/CheckAllButton.vue'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import type { RegistryOption, Research, ResearchQuestion, Study, StudyEvent, StudyRun } from '@/types/api'

const { t } = useI18n()
const route = useRoute()
const api = useApi()

const researchId = computed(() => String(route.params.id))

const research = ref<Research | null>(null)
const studies = ref<Study[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const exposureModes = ref<RegistryOption[]>([])
const dialogOpen = ref(false)
const creating = ref(false)
const createError = ref<string | null>(null)
const form = ref({ name: '', description: '', exposureMode: '' })

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [r, s] = await Promise.all([
      api.get<Research>(`/researches/${researchId.value}`),
      api.get<Study[]>('/studies', { query: { researchId: researchId.value } }),
      loadQuestions(),
      loadLlmProviders(),
    ])
    research.value = r
    studies.value = s ?? []
    resetLlmForm()
    await loadStudyProgress()
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    loading.value = false
  }
}

/* -------------------- per-research LLM override (SPEC ai-analysis) -------------------- */
// Overrides the platform-wide default (settings/llm.vue) for this research's
// AI analysis at all 3 levels — resolved by AiAnalysisService.resolveModel().
const llmProviders = ref<RegistryOption[]>([])
const llmForm = ref({ provider: '', model: '' })
const llmSaving = ref(false)
const llmError = ref<string | null>(null)
const llmSavedFlash = ref(false)

async function loadLlmProviders() {
  llmProviders.value = await api.get<RegistryOption[]>('/llm/providers/options') ?? []
}

function resetLlmForm() {
  llmForm.value = {
    provider: research.value?.defaultLlmProvider ?? '',
    model: research.value?.defaultLlmModel ?? '',
  }
}

const llmModelsForProvider = computed<string[]>(() => {
  const provider = llmProviders.value.find(p => p.key === llmForm.value.provider)
  const models = (provider?.meta?.models as Array<{ key: string }> | undefined) ?? []
  return models.map(m => m.key)
})

function onLlmProviderChange() {
  if (!llmModelsForProvider.value.includes(llmForm.value.model)) llmForm.value.model = ''
}

async function saveLlmOverride() {
  if (!llmForm.value.provider || !llmForm.value.model) return
  llmSaving.value = true
  llmError.value = null
  try {
    research.value = await api.patch<Research>(`/researches/${researchId.value}`, {
      defaultLlmProvider: llmForm.value.provider,
      defaultLlmModel: llmForm.value.model,
    })
    llmSavedFlash.value = true
    setTimeout(() => { llmSavedFlash.value = false }, 2000)
  }
  catch (err) {
    llmError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    llmSaving.value = false
  }
}

async function clearLlmOverride() {
  llmSaving.value = true
  llmError.value = null
  try {
    research.value = await api.patch<Research>(`/researches/${researchId.value}`, {
      defaultLlmProvider: null,
      defaultLlmModel: null,
    })
    resetLlmForm()
  }
  catch (err) {
    llmError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    llmSaving.value = false
  }
}

/* -------------------- research questions (SPEC ai-analysis) -------------------- */
const questions = ref<ResearchQuestion[]>([])
const newQuestionText = ref('')
const addingQuestion = ref(false)
const questionsError = ref<string | null>(null)

async function loadQuestions() {
  try {
    questions.value = await api.get<ResearchQuestion[]>(`/researches/${researchId.value}/questions`) ?? []
  }
  catch (err) {
    questionsError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function onAddQuestion() {
  if (!newQuestionText.value.trim()) return
  addingQuestion.value = true
  questionsError.value = null
  try {
    const created = await api.post<ResearchQuestion>(`/researches/${researchId.value}/questions`, {
      questionText: newQuestionText.value.trim(),
    })
    questions.value = [...questions.value, created]
    newQuestionText.value = ''
  }
  catch (err) {
    questionsError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    addingQuestion.value = false
  }
}

async function onRemoveQuestion(id: string) {
  try {
    await api.delete(`/researches/${researchId.value}/questions/${id}`)
    questions.value = questions.value.filter(q => q.id !== id)
  }
  catch (err) {
    questionsError.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function openDialog() {
  createError.value = null
  form.value = { name: '', description: '', exposureMode: '' }
  if (exposureModes.value.length === 0) {
    try {
      exposureModes.value = await api.get<RegistryOption[]>('/studies/exposure-modes/options') ?? []
    }
    catch (err) {
      createError.value = (err as ApiError)?.message ?? t('common.error')
    }
  }
  dialogOpen.value = true
}

async function onCreate() {
  creating.value = true
  createError.value = null
  try {
    const study = await api.post<Study>('/studies', {
      researchId: Number(researchId.value),
      name: form.value.name,
      description: form.value.description || undefined,
      exposureMode: form.value.exposureMode || undefined,
    })
    dialogOpen.value = false
    studies.value = [study, ...studies.value]
  }
  catch (err) {
    createError.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creating.value = false
  }
}

function goToStudy(id: string) {
  void navigateTo(`/studies/${id}`)
}

/** Every run across every study in this research (SPEC 9/14 "Executar tudo"). */
async function getResearchRuns(): Promise<StudyRun[]> {
  const perStudy = await Promise.all(
    studies.value.map(s =>
      api.get<StudyRun[]>('/study-runs', { query: { studyId: s.id } }).catch(() => [] as StudyRun[]),
    ),
  )
  return perStudy.flat()
}

/**
 * A study's own `status` is essentially a static label set at creation —
 * nothing transitions it as its runs execute, and for channel_diffusion
 * studies a RUN's status also never leaves 'frozen' (progress lives per
 * diffusion event, not on the run). So the studies table showed "Rascunho"
 * forever regardless of how much actually ran inside. This computes a real
 * "X/Y done" per study — runs done/total for direct_assignment, opinions
 * done/total across every event for channel_diffusion — visible without
 * opening the study.
 */
interface StudyProgress { done: number, total: number, unit: 'runs' | 'events' }
const studyProgress = ref<Record<string, StudyProgress>>({})
// SPEC 9/11 gate for the research's final synthesis: every study needs its
// OWN AI analysis already computed first — this is that per-study check,
// fetched alongside the progress summary above (same round of requests).
const studySynthesisDone = ref<Record<string, boolean>>({})

async function loadStudyProgress() {
  const entries = await Promise.all(studies.value.map(async (s) => {
    const [studyRuns, studyAnalysis] = await Promise.all([
      api.get<StudyRun[]>('/study-runs', { query: { studyId: s.id } }).catch(() => [] as StudyRun[]),
      api.get<{ status: string }>(`/studies/${s.id}/ai-analysis`).catch(() => null),
    ])
    studySynthesisDone.value = { ...studySynthesisDone.value, [s.id]: studyAnalysis?.status === 'done' }
    if (s.exposureMode === 'channel_diffusion') {
      const perRun = await Promise.all(
        studyRuns.map(r =>
          api.get<StudyEvent[]>('/diffusion/events', { query: { runId: r.id } }).catch(() => [] as StudyEvent[]),
        ),
      )
      const events = perRun.flat()
      return [s.id, {
        done: events.filter(e => e.opinionStatus === 'done').length,
        total: events.length,
        unit: 'events' as const,
      }] as const
    }
    return [s.id, {
      done: studyRuns.filter(r => r.status === 'done').length,
      total: studyRuns.length,
      unit: 'runs' as const,
    }] as const
  }))
  studyProgress.value = Object.fromEntries(entries)
}

const researchNotReadyReason = computed(() => {
  if (studies.value.length === 0) return t('aiAnalysis.gate.noStudies')
  const missing = studies.value.filter(s => !studySynthesisDone.value[s.id])
  if (missing.length === 0) return null
  return t('aiAnalysis.gate.studiesUnsynthesized', { list: missing.map(s => s.name).join(', ') })
})

const columns = computed<ColumnDef<Study>[]>(() => [
  {
    accessorKey: 'name',
    header: () => t('studies.columns.name'),
    cell: ({ row }) => row.original.name,
  },
  {
    accessorKey: 'exposureMode',
    header: () => t('studies.columns.exposureMode'),
    cell: ({ row }) => row.original.exposureMode
      ? t(`registry.exposure_mode.${row.original.exposureMode}`)
      : '—',
  },
  {
    id: 'progress',
    header: () => t('studies.columns.progress'),
    cell: ({ row }) => {
      const p = studyProgress.value[row.original.id]
      if (!p || p.total === 0) return '—'
      const unit = p.unit === 'events' ? t('studies.progress.events') : t('studies.progress.runs')
      return `${p.done}/${p.total} ${unit}`
    },
  },
  {
    accessorKey: 'status',
    header: () => t('studies.columns.status'),
    cell: ({ row }) => row.original.status
      ? h(StatusBadge, { status: row.original.status })
      : '—',
  },
])

const table = useVueTable({
  get data() {
    return studies.value
  },
  get columns() {
    return columns.value
  },
  getCoreRowModel: getCoreRowModel(),
})

onMounted(loadData)
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-if="research">
      <PageHeader
        :title="research.name"
        :description="research.objective ?? undefined"
        back-to="/researches"
        :back-label="t('researches.title')"
      >
        <template #actions>
          <StatusBadge :status="research.status" />
          <RunAllButton :get-runs="getResearchRuns" @done="loadData" />
          <CheckAllButton :get-runs="getResearchRuns" @done="loadData" />
          <Dialog v-model:open="dialogOpen">
            <DialogTrigger as-child>
              <Button @click="openDialog">{{ t('studies.new') }}</Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{{ t('studies.new') }}</DialogTitle>
            </DialogHeader>
            <form class="space-y-4" @submit.prevent="onCreate">
              <div class="space-y-1">
                <label class="text-sm font-medium" for="s-name">{{ t('studies.fields.name') }}</label>
                <Input id="s-name" v-model="form.name" required />
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="s-desc">{{ t('studies.fields.description') }}</label>
                <Input id="s-desc" v-model="form.description" />
              </div>
              <div class="space-y-1">
                <label class="text-sm font-medium" for="s-mode">{{ t('studies.fields.exposureMode') }}</label>
                <RegistrySelect
                  id="s-mode"
                  v-model="form.exposureMode"
                  :options="exposureModes"
                  :placeholder="t('common.select')"
                  show-help
                />
              </div>

              <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>

                <Button type="submit" :disabled="creating">
                  {{ creating ? t('common.loading') : t('common.create') }}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </template>
      </PageHeader>

      <!-- Final cross-cutting AI synthesis (SPEC 7): shown first — it's the -->
      <!-- headline read of the whole research, cached until re-run. -->
      <AiAnalysisPanel
        :base-path="`researches/${researchId}`"
        level-label="research"
        :questions="questions"
        :not-ready-reason="researchNotReadyReason"
      />

      <!-- Per-research LLM override (SPEC ai-analysis): applies to all 3 -->
      <!-- AI-analysis levels for this research; falls back to the platform -->
      <!-- default (settings/llm.vue) when unset. -->
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('researches.llmOverride.title') }}</CardTitle>
          <CardDescription>{{ t('researches.llmOverride.subtitle') }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          <p v-if="llmError" class="text-sm text-destructive" role="alert">{{ llmError }}</p>
          <div class="flex flex-wrap items-end gap-3">
            <div class="space-y-1">
              <label class="text-sm font-medium" for="research-llm-provider">
                {{ t('researches.llmOverride.provider') }}
              </label>
              <RegistrySelect
                id="research-llm-provider"
                v-model="llmForm.provider"
                :options="llmProviders"
                :placeholder="t('researches.llmOverride.usePlatformDefault')"
                class="min-w-[10rem]"
                @update:model-value="onLlmProviderChange"
              />
            </div>
            <div class="space-y-1">
              <label class="text-sm font-medium" for="research-llm-model">
                {{ t('researches.llmOverride.model') }}
              </label>
              <select
                id="research-llm-model"
                v-model="llmForm.model"
                :disabled="llmModelsForProvider.length === 0"
                class="field-select min-w-[12rem]"
              >
                <option value="">{{ t('common.select') }}</option>
                <option v-for="m in llmModelsForProvider" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>
            <Button
              size="sm"
              :disabled="!llmForm.provider || !llmForm.model || llmSaving"
              @click="saveLlmOverride"
            >
              {{ llmSaving ? t('common.saving') : t('common.save') }}
            </Button>
            <Button
              v-if="research.defaultLlmProvider"
              variant="outline"
              size="sm"
              :disabled="llmSaving"
              @click="clearLlmOverride"
            >
              {{ t('researches.llmOverride.clear') }}
            </Button>
            <span v-if="llmSavedFlash" class="text-xs text-primary">{{ t('common.saved') }}</span>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ research.defaultLlmProvider
              ? t('researches.llmOverride.currentlyUsing', { provider: t(`registry.llm_provider.${research.defaultLlmProvider}`), model: research.defaultLlmModel })
              : t('researches.llmOverride.currentlyUsingPlatformDefault') }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('studies.title') }}</CardTitle>
        </CardHeader>
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow v-for="hg in table.getHeaderGroups()" :key="hg.id">
                <TableHead v-for="header in hg.headers" :key="header.id">
                  <FlexRender
                    v-if="!header.isPlaceholder"
                    :render="header.column.columnDef.header"
                    :props="header.getContext()"
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="row in table.getRowModel().rows"
                :key="row.id"
                class="cursor-pointer"
                @click="goToStudy(row.original.id)"
              >
                <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                  <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
                </TableCell>
              </TableRow>
              <TableRow v-if="table.getRowModel().rows.length === 0">
                <TableCell :colspan="columns.length" class="py-10 text-center text-muted-foreground">
                  {{ t('studies.empty') }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <!-- Research questions (SPEC ai-analysis): set at research level, the -->
      <!-- final cross-cutting AI synthesis below tries to answer each one. -->
      <Card>
        <CardHeader>
          <CardTitle class="text-lg">{{ t('researchQuestions.title') }}</CardTitle>
          <CardDescription>{{ t('researchQuestions.subtitle') }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          <p v-if="questionsError" class="text-sm text-destructive" role="alert">{{ questionsError }}</p>

          <div class="space-y-2">
            <div
              v-for="q in questions"
              :key="q.id"
              class="flex items-start justify-between gap-3 border bg-muted/30 p-3"
            >
              <p class="text-sm">{{ q.questionText }}</p>
              <Button variant="outline" size="sm" @click="onRemoveQuestion(q.id)">
                {{ t('common.delete') }}
              </Button>
            </div>
            <p v-if="questions.length === 0" class="text-sm text-muted-foreground">
              {{ t('researchQuestions.empty') }}
            </p>
          </div>

          <form class="flex gap-2 max-w-2xl" @submit.prevent="onAddQuestion">
            <Input v-model="newQuestionText" :placeholder="t('researchQuestions.placeholder')" />
            <Button type="submit" :disabled="addingQuestion || !newQuestionText.trim()">
              {{ addingQuestion ? t('common.loading') : t('researchQuestions.add') }}
            </Button>
          </form>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
