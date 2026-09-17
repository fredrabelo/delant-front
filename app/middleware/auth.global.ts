import { defineNuxtRouteMiddleware, navigateTo } from '#app'
import { useAuthToken } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'

// Self-registration is closed (only a superadmin-created account can log
// in) — `login` is the only page reachable without a session.
/** Route names (unprefixed) that are reachable without authentication. */
const PUBLIC_ROUTES = ['login']

function baseRouteName(name: string | null | undefined): string {
  if (!name) {
    return ''
  }
  // Strip the i18n locale suffix, e.g. 'login___en' -> 'login'.
  return name.split('___')[0] ?? ''
}

export default defineNuxtRouteMiddleware(async (to) => {
  const { token } = useAuthToken()
  const routeName = baseRouteName(to.name as string | undefined)
  const isPublic = PUBLIC_ROUTES.includes(routeName)

  if (!token.value) {
    if (isPublic) {
      return
    }
    return navigateTo('/login')
  }

  // Authenticated: ensure the user is loaded (client-side only to avoid
  // hitting the API during SSR/build prerender).
  if (import.meta.client) {
    const { user, fetchMe } = useAuth()
    if (!user.value) {
      await fetchMe()
    }
  }

  // Keep authenticated users out of the auth pages.
  if (isPublic) {
    return navigateTo('/')
  }
})
