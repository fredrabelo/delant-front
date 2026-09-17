// ALB target-group health check target (see docs/sprints/sprint-4-aws-infra.md)
// — a dedicated endpoint rather than relying on `/` redirecting unauthenticated
// visitors to /login, which happens to also return a healthy status code but
// isn't a deliberate contract.
export default defineEventHandler(() => ({ status: 'ok' }))
