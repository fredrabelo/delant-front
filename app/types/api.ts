/**
 * Shared API contract types for the delant backend.
 * Kept intentionally close to the documented endpoints; optional fields are
 * marked optional so partial payloads (list vs detail) both type-check.
 */

export interface User {
  id: string
  email: string
  name: string
  isPlatformStaff: boolean
  uiLocaleCode?: string | null
}

export interface AuthResponse {
  accessToken: string
  user: User
}

export interface Client {
  id: string
  name: string
  sectorKey: string
  legalName?: string | null
  countryId?: string | null
  plan?: string
  status?: string
  createdAt?: string
  /** Whether this client's researchers see calibrated diffusion-channel numbers (staff-only toggle). */
  diffusionCalibrationVisible?: boolean
  [key: string]: unknown
}

/** Staff-only access log row (login/register events). */
export interface AccessLogRow {
  id: string
  event: string
  createdAt: string
  userId: string
  user: { id: string, name: string, email: string } | null
}

export interface Department {
  id: string
  name: string
  clientId?: string
  [key: string]: unknown
}

export interface Membership {
  clientId: string
  userId: string
  role: string
  departmentId?: string | null
  client: Client
  department?: Department | null
}

export interface MembershipRow {
  userId: string
  role: string
  departmentId?: string | null
  user?: Pick<User, 'id' | 'email' | 'name'>
  department?: Department | null
}

/** Registry option shape: FE owns display text via labelKey. */
export interface RegistryOption {
  key: string
  labelKey: string
  descriptionKey?: string
  meta?: Record<string, unknown>
}

export interface Country {
  id: string
  isoCode: string
  name: string
  isDefault: boolean
}

export type ResearchStatus = 'draft' | 'active' | 'completed' | 'archived'

export interface Research {
  id: string
  name: string
  objective?: string | null
  status: ResearchStatus
  departmentId: string
  countryId?: string | null
  createdAt?: string
  department?: Department | null
  country?: Country | null
  /** Per-research override for AI-analysis defaults (all 3 levels); null uses the platform default. */
  defaultLlmProvider?: string | null
  defaultLlmModel?: string | null
}

export type StudyStatus = 'draft' | 'active' | 'completed' | 'archived'

export interface Study {
  id: string
  researchId: string
  name: string
  description?: string | null
  exposureMode?: string | null
  status?: StudyStatus
  createdAt?: string
}

export interface ResearchQuestion {
  id: string
  researchId: string
  questionKey: string | null
  questionText: string
  sortOrder: number
}

export type FidelityStatus = 'supported' | 'not_supported' | 'mixed' | 'insufficient_evidence'

export interface FidelityAxis {
  status: FidelityStatus
  note: string
}

export interface ResearchQuestionAnswer {
  questionId: number
  answer: string
  confidence: 'high' | 'medium' | 'low'
}

export interface AiAnalysisResult {
  summary: string
  keyFindings: string[]
  caveats: string[]
  fidelity: {
    calibration: FidelityAxis
    comparativeEffects: FidelityAxis
    rankingDecision: FidelityAxis
  }
  researchQuestionAnswers: ResearchQuestionAnswer[]
}

export type AiAnalysisStatus = 'pending' | 'running' | 'done' | 'error'

export interface AiAnalysis {
  id: string
  level: 'run' | 'study' | 'research'
  subjectId: string
  status: AiAnalysisStatus
  llmProvider: string | null
  llmModel: string | null
  resultJson: AiAnalysisResult | null
  errorMessage: string | null
  computedAt: string | null
}

export interface AiAnalysisCostEstimate {
  model: string
  estInputTokens: number
  estOutputTokens: number
  estCostUsd: number
}

export type PopulationStatus = 'draft' | 'generating' | 'ready' | 'error'

export interface Population {
  id: string
  name: string
  status: PopulationStatus
  countryId?: string | null
  geographyId?: string | null
  size?: number
  seed?: number | null
  synthesizerKey?: string | null
  agentCount?: number | null
  createdAt?: string
}

export interface PopulationStatusResponse {
  status: PopulationStatus
  progress: number
  errorMessage?: string | null
  agentCount?: number | null
}

export interface AxisPack {
  id: string
  name: string
  category?: string | null
  categoryKey?: string | null
  countryId?: string | null
  dataSourceId?: string | null
  [key: string]: unknown
}

export interface DataSource {
  id: string
  key: string
  name: string
  description?: string | null
  organization: string
  sourceType?: string | null
  referencePeriod?: string | null
  geographyScope?: string | null
  onDemandProvider?: string | null
  isOfficial?: boolean
  confidence?: number
  quality?: number
  countryId?: string | null
  [key: string]: unknown
}

export interface DataSourceAttribute {
  id: string
  attrKey: string
  label: string
  dataType?: string | null
  packId?: string | null
}

export interface AxisPackCategory {
  key: string
  labelKey: string
  meta?: Record<string, unknown>
}

export interface Attribute {
  id: string
  attrKey: string
  label: string
  domain?: string | null
  packId?: string | null
  dataType?: string | null
  populationBase?: string | null
  [key: string]: unknown
}

export interface AttributeLabels {
  attribute: { label: string }
  values: Record<string, string>
}

export interface AttributeTargetShare {
  attributeId: string
  valueId: string
  valueKey: string
  valueLabel: string
  share: number
}

export interface PopulationCompositionValue {
  valueId: string
  valueKey: string
  valueLabel: string
  count: number
  observedShare: number
  targetShare: number | null
  diff: number | null
  marginOfError95: number
  withinMargin: boolean | null
}

export interface PopulationCompositionAttribute {
  attributeId: string
  attributeKey: string
  attributeLabel: string
  total: number
  values: PopulationCompositionValue[]
  chiSquare: { statistic: number; df: number; pValue: number; distinguishable: boolean } | null
}

export interface PopulationComposition {
  totalAgents: number
  attributes: PopulationCompositionAttribute[]
}

export interface PopulationAgent {
  id: string
  externalKey: string | null
  fullName: string | null
  weight: number
  attributes: Record<string, string>
}

export interface PopulationAgentsPage {
  total: number
  agents: PopulationAgent[]
}

export interface Geography {
  id: string
  name: string
  level: string
  code?: string | null
  ibgeCode?: string | null
  countryId?: string | null
  parentId?: string | null
}

export interface Channel {
  id: string
  channelKey: string
  family?: string | null
  /** Fraction of reachable agents seeded on entry (0..1) — the algorithm's default. */
  defaultReach?: number | null
  /** Per-step peer-spread probability (0..1) — the algorithm's default. */
  defaultDiffusionRate?: number | null
  ageAffinity?: Record<string, unknown> | null
  /** Resolved for the requested locale server-side (never a client-side map lookup). */
  label?: string | null
  /** true = platform-curated catalog channel (staff-only to create/edit). */
  isOfficial?: boolean
  status?: string
  active?: boolean
  createdAt?: string
  [key: string]: unknown
}

export interface ChannelInput {
  channelKey: string
  family?: string
  defaultReach?: number
  defaultDiffusionRate?: number
  ageAffinity?: Record<string, unknown>
  labels: Record<string, string>
}

/* ------------------------------------------------------------------ */
/* Diffusion (SPEC 14)                                                 */
/* ------------------------------------------------------------------ */

export interface StudyEvent {
  id: string
  runId: string
  stimulusId: string
  channelId?: string | null
  title: string
  description?: string | null
  initialReach?: number | null
  diffusionRate?: number | null
  /** Opt-in continuation mode (diffusion timeline): carries a prior event's exposure state forward. */
  continuesFromEventId?: string | null
  /** idle | running | done | error — the LLM opinion-generation step, independent of the mechanical diffusion. */
  opinionStatus?: string
  /** Set when opinions were submitted via the provider Batches API (SPEC 8, the platform default). */
  batchId?: string | null
  batchStatus?: string | null
  createdAt?: string
}

export interface StudyEventInput {
  runId: string
  stimulusId: string
  channelId?: string
  title: string
  description?: string
  initialReach?: number
  diffusionRate?: number
}

export interface DiffuseResult {
  eventId: string
  totalAgents: number
  perStepExposed: number[]
}

export interface EventSummary {
  eventId: string
  exposed: number
  bySource: {
    seed?: number
    peer?: number
    channel?: number
    [key: string]: number | undefined
  }
}

export interface OpinionRow {
  id: string
  agentId: string
  agentName: string | null
  /** -100..100 */
  sentiment: number
  /** 0..100 */
  adoptionIntent: number
  stance: string | null
  willShare: boolean
  stepIndex: number
}

export interface OpinionsResponse {
  eventId: string
  total: number
  opinions: OpinionRow[]
}

/* ------------------------------------------------------------------ */
/* Stimuli                                                             */
/* ------------------------------------------------------------------ */

export interface StimulusAttributeValue {
  attributeId: string
  attributeValueId: string
}

export interface Stimulus {
  id: string
  studyId: string
  title: string
  body?: string | null
  payload?: Record<string, unknown> | null
  sortOrder?: number | null
  createdAt?: string
}

export interface StimulusInput {
  studyId: string
  title: string
  body?: string
  payload?: Record<string, unknown>
  sortOrder?: number
  attributeValues?: StimulusAttributeValue[]
}

/** Result of `POST /stimuli/media` — drop straight into `StimulusInput.payload`. */
export interface StimulusImageMedia {
  kind: 'image'
  mediaType: string
  dataBase64: string
  sha256: string
  sizeBytes: number
}

/* ------------------------------------------------------------------ */
/* Instruments                                                         */
/* ------------------------------------------------------------------ */

export type InstrumentItemType =
  | 'scale_0_10'
  | 'single_choice'
  | 'multiple_choice'
  | 'open'
  | 'conjoint_profile_choice'

export interface InstrumentItem {
  id: string
  instrumentId?: string
  itemType: string
  itemKey: string
  promptText: string
  config?: Record<string, unknown> | null
  required?: boolean
  sortOrder?: number | null
}

export interface InstrumentItemInput {
  itemType: string
  itemKey: string
  promptText: string
  config?: Record<string, unknown>
  required?: boolean
  sortOrder?: number
}

export interface Instrument {
  id: string
  studyId: string
  name: string
  description?: string | null
  createdAt?: string
  items?: InstrumentItem[]
}

export interface InstrumentInput {
  studyId: string
  name: string
  description?: string
  items?: InstrumentItemInput[]
}

export interface Benchmark {
  id: string
  name: string
  metricKey: string
  value?: number | null
  valueJson?: Record<string, unknown> | null
  source?: string | null
  referenceYear?: number | null
  geographyId?: string | null
}

export interface BenchmarkInput {
  name: string
  metricKey: string
  value?: number
  valueJson?: Record<string, unknown>
  source?: string
  referenceYear?: number
  geographyId?: string
}

/* ------------------------------------------------------------------ */
/* Study runs                                                          */
/* ------------------------------------------------------------------ */

export type StudyRunStatus = 'draft' | 'frozen' | 'running' | 'done' | 'error'

export interface StudyRunManifest {
  populationIds?: string[]
  stimulusIds?: string[]
  instrumentId?: string | null
  groundingCompilerKey?: string | null
  llmProvider?: string | null
  llmModel?: string | null
  seed?: number | null
  exposureMode?: string | null
  frozenAt?: string | null
  [key: string]: unknown
}

export interface StudyRun {
  id: string
  studyId: string
  name: string
  status: StudyRunStatus
  groundingCompilerKey?: string | null
  llmProvider?: string | null
  llmModel?: string | null
  instrumentId?: string | null
  seed?: number | null
  manifestJson?: StudyRunManifest | null
  frozenAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  errorMessage?: string | null
  progress?: number | null
  batchId?: string | null
  batchStatus?: string | null
  createdBy?: string | null
  createdAt?: string
  /** Days from the study's t0, for the diffusion timeline (SPEC 14). Null = unplaced. */
  timelineOffsetDays?: number | null
  /** Excludes this run from the study's "all runs finished" AI-synthesis gate, without deleting it. */
  excluded?: boolean
}

/* ------------------------------------------------------------------ */
/* Run responses                                                       */
/* ------------------------------------------------------------------ */

export interface RunResponse {
  id: string
  runId: string
  agentId: string
  questionKey: string
  drawIndex: number
  valueJson: unknown
  groundingHash?: string | null
  explanation?: string | null
}

/* ------------------------------------------------------------------ */
/* Agent grounding (SPEC 8) — the compiled persona/prompt behind a       */
/* response or opinion. Nothing is stored at generation time (see       */
/* GroundingService.compile): it's a pure function of the agent's       */
/* evidence + compiler + stimulus, so it's re-derived on demand here    */
/* purely to let a researcher see "what prompt produced this answer".   */
/* ------------------------------------------------------------------ */

export interface PromptSections {
  knownFacts: string
  observedHistory: string
  syntheticPriors: string
  currentMentalState: string
  currentStimulus: string
}

export interface AgentGrounding {
  compilerKey: string
  compilerVersion: string
  sections: PromptSections
  groundingHash: string
  freshness: {
    oldestEmpiricalDate: string | null
    newestEmpiricalDate: string | null
    asOfDate: string
  } | null
}

/* ------------------------------------------------------------------ */
/* Usage / cost                                                        */
/* ------------------------------------------------------------------ */

export interface RunUsageTotals {
  inputTokens: number
  outputTokens: number
  costUsd: number
  calls: number
}

export interface RunUsageByModel {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  calls: number
}

export interface RunUsageByPurpose {
  purpose: string
  costUsd: number
  calls: number
}

export interface RunUsage {
  runId: string
  totals: RunUsageTotals
  byModel: RunUsageByModel[]
  byPurpose: RunUsageByPurpose[]
}

export interface ClientUsageTotals {
  costUsd: number
  inputTokens: number
  outputTokens: number
  calls: number
}

export interface ClientUsageByModel {
  provider: string
  model: string
  costUsd: number
  calls: number
}

export interface ClientUsageByPurpose {
  purpose: string
  costUsd: number
  calls: number
}

export interface ClientUsageByDay {
  day: string
  costUsd: number
  calls: number
}

export interface ClientUsage {
  totals: ClientUsageTotals
  byModel: ClientUsageByModel[]
  byPurpose: ClientUsageByPurpose[]
  byDay: ClientUsageByDay[]
  providers: string[]
}

export interface StudyRunInput {
  studyId: string
  name: string
  groundingCompilerKey?: string
  llmProvider?: string
  llmModel?: string
  instrumentId?: string
  seed?: number
}

export interface StudyRunFreezeInput {
  groundingCompilerKey?: string
  llmProvider?: string
  llmModel?: string
  instrumentId?: string
  seed?: number
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export interface ChiSquare {
  statistic: number
  df: number
  pValue: number
  distinguishable: boolean
}

export interface RepresentativenessValue {
  valueKey: string
  observedShare: number
  targetShare: number
  diff: number
  marginOfError95: number
  withinMargin: boolean
}

export interface RepresentativenessAttribute {
  attributeKey: string
  total: number
  chiSquare: ChiSquare | null
  values: RepresentativenessValue[]
}

export interface RepresentativenessResult {
  totalAgents: number
  attributes: RepresentativenessAttribute[]
}

export interface DistributionValue {
  valueKey: string
  count: number
  share: number
}

export interface DistributionAttribute {
  attributeKey: string
  total: number
  values: DistributionValue[]
}

export interface DistributionResult {
  totalAgents: number
  attributes: DistributionAttribute[]
}

export interface AnalysisResult {
  resultJson: RepresentativenessResult | DistributionResult | Record<string, unknown>
  [key: string]: unknown
}

export interface AnalysisApplicability {
  exposureMode: string | null
  hasBenchmark: boolean
  hasAttributes: boolean
}

/* ------------------------------------------------------------------ */
/* Visualizations                                                      */
/* ------------------------------------------------------------------ */

export interface Visualization {
  id: string
  runId: string
  title: string
  analysisModuleKey: string
  chartTypeKey: string
  config?: { attributeKey?: string } | Record<string, unknown> | null
  createdAt?: string
}

export interface VisualizationInput {
  runId: string
  title: string
  analysisModuleKey: string
  chartTypeKey: string
  config?: { attributeKey?: string }
}

export interface VisualizationSeries {
  name: string
  values: number[]
}

export interface VisualizationData {
  chartType: string
  title: string
  labels: string[]
  series: VisualizationSeries[]
  rows?: Array<Record<string, unknown>>
}

/* ------------------------------------------------------------------ */
/* LLM                                                                 */
/* ------------------------------------------------------------------ */

export interface LlmStatus {
  enabled: boolean
  providers: {
    anthropic: boolean
    gemini: boolean
    openai: boolean
    [key: string]: boolean
  }
}

export interface LlmModel {
  key: string
  pricing?: unknown
  unconfirmedPricing?: boolean
}

export interface LlmDefault {
  id: number
  purposeKey: string
  provider: string
  model: string
  updatedBy: number | null
  createdAt: string
  updatedAt: string
}

/** Status of a client's own (BYO) API key for one provider — never the key itself. */
export interface LlmCredentialStatus {
  providerKey: string
  configured: boolean
  lastFour?: string
  updatedAt?: string
}
