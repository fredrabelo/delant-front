<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from '#imports'
import { navigateTo } from '#app'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import AppSidebar from '@/components/AppSidebar.vue'
import { useAuth } from '@/composables/useAuth'
import { useActiveClient } from '@/composables/useActiveClient'

const { t, locale, locales, setLocale } = useI18n()
const { user, logout } = useAuth()
const { memberships, activeClientId, activeClient, setActiveClient, loadClients, hasClients } = useActiveClient()

const availableLocales = computed(() => locales.value)

onMounted(async () => {
  if (user.value && memberships.value.length === 0) {
    await loadClients()
  }
})

function onClientChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  setActiveClient(value || null)
}

async function onLogout() {
  logout()
  await navigateTo('/login')
}
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>
      <!-- Dashboard top bar: sidebar toggle + client/locale/logout controls -->
      <header
        class="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 supports-[backdrop-filter]:bg-background/80 backdrop-blur"
      >
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-2 h-4" />

        <div class="ml-auto flex items-center gap-3">
          <label class="sr-only" for="active-client">{{ t('clients.active') }}</label>
          <select
            v-if="hasClients"
            id="active-client"
            class="field-select field-select-sm w-auto min-w-[11rem]"
            :value="activeClientId ?? ''"
            :aria-label="t('clients.switcher')"
            @change="onClientChange"
          >
            <option
              v-for="m in memberships"
              :key="m.clientId"
              :value="m.clientId"
            >
              {{ m.client.name }}
            </option>
          </select>
          <span v-else class="text-sm text-muted-foreground">{{ t('clients.none') }}</span>

          <div
            class="flex items-center border border-input bg-background p-0.5"
            :aria-label="t('common.language')"
          >
            <button
              v-for="loc in availableLocales"
              :key="loc.code"
              type="button"
              class="px-2 py-1 text-xs font-medium uppercase transition-colors"
              :class="loc.code === locale
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'"
              :aria-current="loc.code === locale ? 'true' : undefined"
              @click="setLocale(loc.code)"
            >
              {{ loc.code }}
            </button>
          </div>

          <Button variant="outline" size="sm" @click="onLogout">
            {{ t('auth.logout') }}
          </Button>
        </div>
      </header>

      <div class="flex-1 p-4 lg:p-6">
        <p v-if="activeClient" class="sr-only">{{ activeClient.name }}</p>
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
