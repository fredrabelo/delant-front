<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n, useRuntimeConfig } from '#imports'
import { NuxtLink } from '#components'
import { FlaskConical, Users, LayoutGrid, ArrowRight, CircleHelp, Users2, SplitSquareHorizontal, Workflow } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogTrigger,
  DialogScrollContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import RegistrySelect from '@/components/RegistrySelect.vue'
import { useApi } from '@/composables/useApi'
import type { ApiError } from '@/composables/useApi'
import { useActiveClient } from '@/composables/useActiveClient'
import { useAuth } from '@/composables/useAuth'
import type { Client, Country, LlmCredentialStatus, Population, RegistryOption, Research } from '@/types/api'

const { t } = useI18n()
const config = useRuntimeConfig()
const api = useApi()
const { user } = useAuth()
const {
  memberships,
  activeClient,
  activeClientId,
  hasClients,
  setActiveClient,
  loadClients,
} = useActiveClient()

const appName = computed(() => config.public.appName)

const quickLinks = computed(() => [
  { to: '/researches', label: t('nav.researches'), description: t('dashboard.links.researches'), icon: FlaskConical },
  { to: '/populations', label: t('nav.populations'), description: t('dashboard.links.populations'), icon: Users },
  { to: '/builder', label: t('nav.newExperiment'), description: t('dashboard.links.builder'), icon: LayoutGrid },
])

/* -------------------- summary counts (existing endpoints) -------------------- */
const researchCount = ref<number | null>(null)
const populationCount = ref<number | null>(null)

async function loadCounts() {
  try {
    const [rs, pops] = await Promise.all([
      api.get<Research[]>('/researches'),
      api.get<Population[]>('/populations'),
    ])
    researchCount.value = (rs ?? []).length
    populationCount.value = (pops ?? []).length
  }
  catch {
    // Counts are non-critical; leave as null (rendered as em dash).
  }
}

// Onboarding nudge: a run can't execute for this client until at least one
// LLM key is configured (BYO key — see settings/llm.vue). Failing silently
// here just means the banner doesn't show, not a broken dashboard.
const llmCredentials = ref<LlmCredentialStatus[] | null>(null)
const showLlmKeyBanner = computed(() =>
  llmCredentials.value !== null && !llmCredentials.value.some(c => c.configured),
)

async function loadLlmCredentialStatus() {
  try {
    llmCredentials.value = await api.get<LlmCredentialStatus[]>('/llm/credentials')
  }
  catch {
    llmCredentials.value = null
  }
}

const stats = computed(() => [
  {
    label: t('nav.researches'),
    value: researchCount.value ?? '—',
    icon: FlaskConical,
    hint: t('dashboard.links.researches'),
  },
  {
    label: t('nav.populations'),
    value: populationCount.value ?? '—',
    icon: Users,
    hint: t('dashboard.links.populations'),
  },
])

// Create-client form state (shown when the user has no clients).
const sectorOptions = ref<RegistryOption[]>([])
const countries = ref<Country[]>([])
const form = ref({ name: '', sectorKey: '', legalName: '', countryId: '' })
const creating = ref(false)
const error = ref<string | null>(null)

async function loadRefData() {
  error.value = null
  try {
    const [sectors, cs] = await Promise.all([
      api.get<RegistryOption[]>('/clients/sectors/options'),
      api.get<Country[]>('/countries'),
    ])
    sectorOptions.value = sectors ?? []
    countries.value = cs ?? []
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
}

async function onCreateClient() {
  error.value = null
  creating.value = true
  try {
    const client = await api.post<Client>('/clients', {
      name: form.value.name,
      sectorKey: form.value.sectorKey,
      legalName: form.value.legalName || undefined,
      countryId: form.value.countryId || undefined,
    })
    await loadClients()
    setActiveClient(client.id)
    form.value = { name: '', sectorKey: '', legalName: '', countryId: '' }
  }
  catch (err) {
    error.value = (err as ApiError)?.message ?? t('common.error')
  }
  finally {
    creating.value = false
  }
}

function onClientChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  setActiveClient(value || null)
}

/* -------------------- "how it works" explainer modal -------------------- */
const howItWorksOpen = ref(false)
const howItWorksSections = [
  { key: 'population', icon: Users2 },
  { key: 'direction', icon: SplitSquareHorizontal },
  { key: 'flow', icon: Workflow },
]

onMounted(async () => {
  if (memberships.value.length === 0) {
    await loadClients()
  }
  if (!hasClients.value) {
    await loadRefData()
  }
  else {
    await loadCounts()
    await loadLlmCredentialStatus()
  }
})
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      :title="t('dashboard.title', { name: appName })"
      :description="t('dashboard.welcome', { name: user?.name ?? '' })"
    >
      <template #actions>
        <Dialog v-model:open="howItWorksOpen">
          <DialogTrigger as-child>
            <Button variant="outline" size="sm">
              <CircleHelp class="h-4 w-4" />
              {{ t('dashboard.howItWorks.trigger') }}
            </Button>
          </DialogTrigger>
          <DialogScrollContent class="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{{ t('dashboard.howItWorks.title', { name: appName }) }}</DialogTitle>
            </DialogHeader>
            <div class="space-y-5">
              <p class="text-sm text-muted-foreground">
                {{ t('dashboard.howItWorks.intro', { name: appName }) }}
              </p>
              <div
                v-for="section in howItWorksSections"
                :key="section.key"
                class="flex gap-3"
              >
                <span
                  class="grid h-9 w-9 shrink-0 place-items-center bg-primary/10 text-primary"
                  aria-hidden="true"
                >
                  <component :is="section.icon" class="h-4 w-4" />
                </span>
                <div class="space-y-1">
                  <p class="font-medium">{{ t(`dashboard.howItWorks.sections.${section.key}.title`) }}</p>
                  <p class="text-sm text-muted-foreground">
                    {{ t(`dashboard.howItWorks.sections.${section.key}.body`) }}
                  </p>
                </div>
              </div>
            </div>
          </DialogScrollContent>
        </Dialog>
      </template>
    </PageHeader>

    <p class="-mt-4 text-lg font-medium italic text-muted-foreground">
      {{ t('dashboard.slogan') }}
    </p>

    <!-- No client: prompt to create one. -->
    <Card v-if="!hasClients" class="max-w-md">
      <CardHeader>
        <CardTitle class="text-lg">{{ t('clients.create.title') }}</CardTitle>
        <CardDescription>{{ t('clients.create.subtitle') }}</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="space-y-4" @submit.prevent="onCreateClient">
          <div class="space-y-1.5">
            <label class="text-sm font-medium" for="client-name">{{ t('clients.fields.name') }}</label>
            <Input id="client-name" v-model="form.name" required />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium" for="client-sector">{{ t('clients.fields.sector') }}</label>
            <RegistrySelect
              id="client-sector"
              v-model="form.sectorKey"
              :options="sectorOptions"
              :placeholder="t('common.select')"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium" for="client-legal">{{ t('clients.fields.legalName') }}</label>
            <Input id="client-legal" v-model="form.legalName" />
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium" for="client-country">{{ t('clients.fields.country') }}</label>
            <select
              id="client-country"
              v-model="form.countryId"
              class="field-select"
            >
              <option value="">{{ t('common.select') }}</option>
              <option v-for="c in countries" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

          <Button type="submit" :disabled="creating || !form.sectorKey">
            {{ creating ? t('common.loading') : t('clients.create.submit') }}
          </Button>
        </form>
      </CardContent>
    </Card>

    <!-- Has client(s): active client, stats, quick links. -->
    <template v-else>
      <!-- Active client + switcher -->
      <Card>
        <CardContent class="flex flex-wrap items-end justify-between gap-4 p-5">
          <div class="space-y-1">
            <p class="text-sm text-muted-foreground">{{ t('clients.active') }}</p>
            <p class="text-xl font-semibold tracking-tight">{{ activeClient?.name ?? '—' }}</p>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-medium" for="home-client">{{ t('clients.switcher') }}</label>
            <select
              id="home-client"
              class="field-select min-w-[16rem]"
              :value="activeClientId ?? ''"
              @change="onClientChange"
            >
              <option v-for="m in memberships" :key="m.clientId" :value="m.clientId">
                {{ m.client.name }}
              </option>
            </select>
          </div>
        </CardContent>
      </Card>

      <!-- Onboarding nudge: no LLM key configured yet for this client. -->
      <Card v-if="showLlmKeyBanner" class="border-primary/40 bg-primary/5">
        <CardContent class="flex flex-wrap items-center justify-between gap-4 p-5">
          <div class="space-y-1">
            <p class="font-medium">{{ t('dashboard.llmKeyBanner.title') }}</p>
            <p class="text-sm text-muted-foreground">{{ t('dashboard.llmKeyBanner.body') }}</p>
          </div>
          <NuxtLink to="/settings/llm">
            <Button size="sm">{{ t('dashboard.llmKeyBanner.action') }}</Button>
          </NuxtLink>
        </CardContent>
      </Card>

      <!-- Summary stats -->
      <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          v-for="s in stats"
          :key="s.label"
          :label="s.label"
          :value="s.value"
          :hint="s.hint"
          :icon="s.icon"
        />
      </section>

      <!-- Quick links (bento) -->
      <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="link in quickLinks"
          :key="link.to"
          :to="link.to"
          class="group"
        >
          <Card class="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
            <CardContent class="flex h-full items-start gap-4 p-5">
              <span
                class="grid h-10 w-10 shrink-0 place-items-center bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <component :is="link.icon" class="h-5 w-5" />
              </span>
              <div class="space-y-1">
                <p class="flex items-center gap-1 font-medium transition-colors group-hover:text-primary">
                  {{ link.label }}
                  <ArrowRight class="h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </p>
                <p class="text-sm text-muted-foreground">{{ link.description }}</p>
              </div>
            </CardContent>
          </Card>
        </NuxtLink>
      </section>
    </template>
  </div>
</template>
