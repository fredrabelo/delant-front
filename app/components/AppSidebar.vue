<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, useRuntimeConfig } from '#imports'
import { NuxtLink } from '#components'
import { useRoute } from '#app'
import {
  Building2,
  Database,
  FlaskConical,
  Home,
  Radio,
  Users,
  Cpu,
  Receipt,
  UsersRound,
} from 'lucide-vue-next'
import { useAuth } from '@/composables/useAuth'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

/**
 * Application sidebar for the dashboard shell. The nav data mirrors the links
 * that used to live in the top bar (same routes/i18n keys), now grouped into
 * "Workspace" and "Settings" with lucide icons. Pure presentation — no page
 * logic here.
 */
const { t } = useI18n()
const config = useRuntimeConfig()
const route = useRoute()
const { user } = useAuth()

const appName = computed(() => config.public.appName)

const groups = computed(() => {
  const base = [
    {
      label: t('nav.workspace'),
      items: [
        { to: '/', label: t('nav.home'), icon: Home },
        { to: '/researches', label: t('nav.researches'), icon: FlaskConical },
        { to: '/populations', label: t('nav.populations'), icon: Users },
        { to: '/data-sources', label: t('nav.dataSources'), icon: Database },
      ],
    },
    {
      label: t('nav.settings'),
      items: [
        { to: '/settings/channels', label: t('nav.channels'), icon: Radio },
        { to: '/settings/team', label: t('nav.team'), icon: UsersRound },
        { to: '/settings/llm', label: t('nav.llm'), icon: Cpu },
        { to: '/settings/usage', label: t('nav.usage'), icon: Receipt },
      ],
    },
  ]
  // Platform-staff-only administration.
  if (user.value?.isPlatformStaff) {
    base.push({
      label: t('nav.admin'),
      items: [
        { to: '/admin/clients', label: t('nav.adminClients'), icon: Building2 },
        { to: '/admin/data-sources', label: t('nav.adminDataSources'), icon: Database },
        { to: '/admin/channels', label: t('nav.adminChannels'), icon: Radio },
      ],
    })
  }
  return base
})

// A link is active when the current path is it, or (for section roots) starts
// with it — except '/', which must match exactly so it isn't always active.
function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <NuxtLink
        to="/"
        class="flex items-center gap-2.5 px-2 py-1.5 text-base font-semibold tracking-tight text-sidebar-foreground"
      >
        <span
          class="hidden h-7 w-7 shrink-0 place-items-center bg-primary text-sm font-semibold leading-none text-primary-foreground group-data-[collapsible=icon]:grid"
          aria-hidden="true"
        >{{ appName.slice(0, 1).toUpperCase() }}</span>
        <img
          src="/logo.png"
          :alt="appName"
          class="h-5 w-auto shrink-0 group-data-[collapsible=icon]:hidden"
        >
      </NuxtLink>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup v-for="group in groups" :key="group.label">
        <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in group.items" :key="item.to">
            <SidebarMenuButton as-child :is-active="isActive(item.to)" :tooltip="item.label">
              <NuxtLink :to="item.to">
                <component :is="item.icon" />
                <span>{{ item.label }}</span>
              </NuxtLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarRail />
  </Sidebar>
</template>
