import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Users
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  plan: text("plan").default("free").notNull(),
  // Fin d'abonnement (null = sans date de fin). Passée cette date, le compte
  // repasse en Free automatiquement.
  planExpiresAt: integer("plan_expires_at", { mode: "timestamp" }),
  role: text("role").default("user").notNull(), // 'user' | 'admin'
  tokens: integer("tokens").default(5000).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  // ── Stripe Connect (Express) — compte vendeur de l'utilisateur ──
  stripeAccountId: text("stripe_account_id"), // acct_xxx, null tant que non créé
  stripeOnboardingCompleted: integer("stripe_onboarding_completed", { mode: "boolean" }).default(false),
  stripePayoutsEnabled: integer("stripe_payouts_enabled", { mode: "boolean" }).default(false),
});

// ─── Paiements Stripe Connect (marketplace : acheteur → vendeur) ─────────────
// Distincte de `orders` (dropshipping). Trace chaque session Checkout Connect :
// acheteur, vendeur (compte Connect cible), montant, commission plateforme,
// et statut (mis à jour via webhook).
export const stripeConnectOrders = sqliteTable("stripe_connect_orders", {
  id: text("id").primaryKey(),
  buyerUserId: text("buyer_user_id"),            // acheteur connecté (nullable = invité)
  sellerUserId: text("seller_user_id"),          // vendeur (propriétaire du compte Connect)
  sellerAccountId: text("seller_account_id").notNull(), // acct_xxx destinataire
  productId: text("product_id"),
  amount: integer("amount").notNull(),           // montant total en centimes
  currency: text("currency").notNull().default("eur"),
  applicationFeeAmount: integer("application_fee_amount").notNull().default(0), // commission plateforme (centimes)
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  status: text("status").notNull().default("pending"), // pending | paid | failed | expired
  metadata: text("metadata"),                    // JSON libre
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (t) => ({
  sessionIdx: uniqueIndex("sco_session_idx").on(t.stripeSessionId),
  sellerIdx: index("sco_seller_idx").on(t.sellerUserId),
  buyerIdx: index("sco_buyer_idx").on(t.buyerUserId),
}));

// ─── Persistent Job Queue (durabilité: survit au restart/crash) ──────────────
export const jobQueue = sqliteTable("job_queue", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("running"), // queued|running|completed|failed|interrupted
  resumable: integer("resumable", { mode: "boolean" }).default(false),
  payload: text("payload"), // JSON: args nécessaires pour reprendre le job
  error: text("error"),
  attempts: integer("attempts").default(0),
  startedAt: integer("started_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Persistent Error Logs ───────────────────────────────────────────────────
export const errorLogs = sqliteTable("error_logs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(), // 'runtime', 'agent', 'job', 'api', 'build'
  level: text("level").notNull().default("error"), // 'error', 'warn', 'fatal'
  message: text("message").notNull(),
  stack: text("stack"),
  companyId: text("company_id"),
  companyName: text("company_name"),
  agentRole: text("agent_role"),
  jobType: text("job_type"),
  jobId: text("job_id"),
  userId: text("user_id"),
  metadata: text("metadata"), // JSON extras
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Sessions
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Password reset tokens — jeton à usage unique envoyé par email pour
// réinitialiser un mot de passe oublié. Expire après 1h.
export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Collaborateurs de projet ────────────────────────────────────────────────
// Un utilisateur (owner) invite un ami par email à co-éditer un projet (company).
// Tant que l'invité n'a pas accepté, status='pending' et userId=null. Une fois le
// lien accepté (connecté à un compte Velbaz), userId est renseigné et status='accepted'.
// RÈGLE FACTURATION : quand un collaborateur travaille sur le projet, ce sont les
// tokens du PROPRIÉTAIRE (companies.userId) qui sont consommés, pas les siens.
export const projectCollaborators = sqliteTable("project_collaborators", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  email: text("email").notNull(),                 // email invité (toujours en minuscules)
  userId: text("user_id"),                         // null tant que l'invitation n'est pas acceptée
  role: text("role").default("editor").notNull(),  // 'editor'
  status: text("status").default("pending").notNull(), // 'pending' | 'accepted'
  inviteToken: text("invite_token").notNull(),     // jeton unique du lien d'invitation
  invitedByUserId: text("invited_by_user_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  acceptedAt: integer("accepted_at", { mode: "timestamp" }),
});

// Companies
export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  idea: text("idea").notNull(),
  // Courte description générée par l'IA (1-2 phrases), affichée sur le dashboard
  // du projet à la place du transcript brut du chat. Null tant que non générée.
  description: text("description"),
  status: text("status").default("active").notNull(),
  arr: real("arr").default(0),
  mrr: real("mrr").default(0),
  totalRevenue: real("total_revenue").default(0),
  tasksCompleted: integer("tasks_completed").default(0),
  emailsSent: integer("emails_sent").default(0),
  adsSpent: real("ads_spent").default(0),
  industry: text("industry"),
  website: text("website"),
  // Type de projet : 'web' (site), 'mobile' (vraie app Expo/React Native), 'both' (les deux).
  projectType: text("project_type").default("web"),
  // Origine du projet : 'user' (créé par l'utilisateur, visible dans Projects) ou
  // 'money_maker' (créé/géré par le boss Money Maker, ISOLÉ du dashboard perso).
  origin: text("origin").default("user").notNull(),
  // Dernière URL exp:// du tunnel Expo (QR code Expo Go). Null tant que l'app mobile n'a pas tourné.
  expoUrl: text("expo_url"),
  languages: text("languages").default('["en"]'), // JSON array of lang codes, first = default. e.g. ["fr","nl","en"]
  country: text("country"), // ISO country code e.g. "BE", "FR", "NL"
  soulMd: text("soul_md"),
  agentsMd: text("agents_md"),
  heartbeatMd: text("heartbeat_md"),
  missionMd: text("mission_md"),
  lastHeartbeat: integer("last_heartbeat", { mode: "timestamp" }),
  heartbeatCount: integer("heartbeat_count").default(0),
  autoHeartbeat: integer("auto_heartbeat").default(0),
  websiteLinks: text("website_links"), // JSON: {"discord":"https://...","instagram":"https://...","email":"..."}
  selectedPages: text("selected_pages"), // JSON array of pages chosen via the page-selection questionnaire (overrides AI planning at build time)
  // "Made with Velbaz" badge: shown by default on every generated site. Can only
  // be hidden when the project OWNER has a PAID plan. If set true then the owner
  // downgrades to free, the badge REAPPEARS automatically (serve-time live check).
  badgeHidden: integer("badge_hidden", { mode: "boolean" }).default(false),
  // JSON array of specialist IDs chosen for this company's AI team (finance, marketing, sales, strategy, hr, legal, operations, product, or 'all'/'web').
  // Null/empty or containing 'all' => no gating (every domain allowed). Otherwise a chat request outside these specialities is gated with an "add this specialist" button.
  enabledSpecialists: text("enabled_specialists"),
  // ── Publication du site ("Publish your website") ──
  // Sous-domaine public choisi/généré (ex. "neon-dreams"). Sert d'identité stable
  // pour l'URL publique servie via /s/:subdomain. Unique par site.
  subdomain: text("subdomain"),
  // Site publié et accessible publiquement (true) ou brouillon (false/null).
  published: integer("published", { mode: "boolean" }).default(false),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  // Disponibilité : 'wake' (dort entre les visites, 500 crédits/mois) ou 'always'
  // (toujours en ligne, chargement instantané, 5000 crédits/mois).
  availabilityMode: text("availability_mode").default("wake"),
  // Visibilité : 'public' (indexé, accessible par lien) ou 'private'.
  visibility: text("visibility").default("public"),
  // Domaine personnalisé connecté (ex. "coffeeroasters.com"). Null si aucun.
  customDomain: text("custom_domain"),
  // Dernier débit de crédits d'hébergement (Availability) et mode facturé.
  // Sert à ne débiter qu'une fois par période de 30 jours pour un même mode.
  hostingBilledAt: integer("hosting_billed_at", { mode: "timestamp" }),
  hostingBilledMode: text("hosting_billed_mode"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Dynamic Specialists ─────────────────────────────────────────────────────
// Spécialistes IA créés À LA DEMANDE par Velbaz quand un besoin n'est couvert par
// aucun expert prédéfini. Synthétisés par un LLM (persona + méthodologie + outils
// + garde-fous), persistés par company pour être réutilisés et affichés dans
// l'équipe. slug = identifiant stable dérivé du domaine (ex. "dyn_nutrition_sportive").
export const dynamicSpecialists = sqliteTable("dynamic_specialists", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  slug: text("slug").notNull(),          // ex: dyn_nutrition_sportive
  label: text("label").notNull(),         // FR: "Expert en nutrition sportive"
  labelEn: text("label_en"),
  desc: text("descr"),                    // 1 phrase de description
  emoji: text("emoji"),                   // ex: "🥗"
  color: text("color"),                   // ex: "#22c55e"
  domain: text("domain"),                 // tag court de domaine
  brief: text("brief"),                   // brief court réutilisable (mode Continuer)
  systemPrompt: text("system_prompt").notNull(), // persona expert complète
  keywords: text("keywords"),             // JSON array de mots-clés pour détection/réutilisation
  useCount: integer("use_count").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (t) => ({
  byCompany: index("dyn_spec_company_idx").on(t.companyId),
  uniqSlug: uniqueIndex("dyn_spec_company_slug_idx").on(t.companyId, t.slug),
}));

// Agent Instances
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  role: text("role").notNull(),
  name: text("name").notNull(),
  status: text("status").default("active").notNull(),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt"),
  lastRun: integer("last_run", { mode: "timestamp" }),
  tasksCompleted: integer("tasks_completed").default(0),
  dailyBudget: real("daily_budget").default(0),
  budgetSpent: real("budget_spent").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Agent Skills
export const agentSkills = sqliteTable("agent_skills", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  agentRole: text("agent_role").notNull(),
  skillMd: text("skill_md").notNull(),
  version: integer("version").default(1),
  lastUpdated: integer("last_updated", { mode: "timestamp" }).default(sql`(unixepoch())`),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Tasks
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").references(() => agents.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("running").notNull(),
  aiModel: text("ai_model"),
  result: text("result"),
  verifiedBy: text("verified_by"),
  verificationStatus: text("verification_status"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// Agent Memory
export const agentMemory = sqliteTable("agent_memory", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").references(() => agents.id),
  key: text("key").notNull(),
  value: text("value").notNull(),
  category: text("category").default("general"),
  importance: integer("importance").default(5),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Agent Activity Log
export const agentActivity = sqliteTable("agent_activity", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").references(() => agents.id),
  agentRole: text("agent_role").notNull(),
  action: text("action").notNull(),
  message: text("message").notNull(),
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Agent-to-agent Team Messages (bus de communication inter-agents)
export const agentMessages = sqliteTable("agent_messages", {
  id: text("id").primaryKey(),
  companyId: text("company_id").references(() => companies.id),
  taskId: text("task_id").notNull(),
  fromRole: text("from_role").notNull(),
  toRole: text("to_role").notNull(),
  type: text("type").notNull(), // demande | reponse | remise | critique | validation | info | synthese
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Daily Reports
export const dailyReports = sqliteTable("daily_reports", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  dayNumber: integer("day_number").notNull(),
  summary: text("summary").notNull(),
  tasksCompleted: integer("tasks_completed").default(0),
  revenue: real("revenue").default(0),
  keyDecisions: text("key_decisions"),
  nextActions: text("next_actions"),
  agentReports: text("agent_reports"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Documents
export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").references(() => agents.id),
  title: text("title").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull(),
  generatedBy: text("generated_by"),
  verifiedBy: text("verified_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Chat messages
export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  model: text("model"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Emails
export const emails = sqliteTable("emails", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").references(() => agents.id),
  type: text("type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  status: text("status").default("draft").notNull(),
  // Raison saisie par l'owner lors d'un refus (pop-up "pourquoi ?"). Optionnel.
  discardReason: text("discard_reason"),
  // Ligne d'aperçu (preheader) affichée par Gmail à côté de l'objet. Optionnel.
  preheader: text("preheader"),
  // CTA principal du mail, rendu en bouton brandé à l'envoi. JSON {label,url}. Optionnel.
  cta: text("cta"),
  openedAt: integer("opened_at", { mode: "timestamp" }),
  repliedAt: integer("replied_at", { mode: "timestamp" }),
  generatedBy: text("generated_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Growth Engine: leads + autonomous multi-channel outreach
export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(), // company / prospect account
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  source: text("source").notNull().default("demo_ai"),
  sourceDetail: text("source_detail"), // consent/source log, search terms, campaign brief
  status: text("status").default("new").notNull(), // new|contacted|replied|qualified|won|lost|opted_out
  score: integer("score").default(50),
  notes: text("notes"),
  lastContactedAt: integer("last_contacted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (table) => ({
  companyIdx: index("leads_company_idx").on(table.companyId),
  emailIdx: index("leads_email_idx").on(table.email),
}));

export const outreach = sqliteTable("outreach", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  leadId: text("lead_id").references(() => leads.id),
  campaignId: text("campaign_id"),
  channel: text("channel").notNull(), // email|sms|call|video|ad
  status: text("status").default("queued").notNull(), // demo|queued|sent|completed|failed|skipped
  subject: text("subject"),
  body: text("body"),
  transcript: text("transcript"),
  mediaUrl: text("media_url"),
  provider: text("provider"),
  requestId: text("request_id"),
  error: text("error"),
  openedAt: integer("opened_at", { mode: "timestamp" }),
  repliedAt: integer("replied_at", { mode: "timestamp" }),
  followUpOf: text("follow_up_of"),
  scheduledFor: integer("scheduled_for", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (table) => ({
  companyIdx: index("outreach_company_idx").on(table.companyId),
  leadIdx: index("outreach_lead_idx").on(table.leadId),
  campaignIdx: index("outreach_campaign_idx").on(table.campaignId),
}));

export const growthConfig = sqliteTable("growth_config", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id).unique(),
  autonomy: text("autonomy").default("full").notNull(), // full|semi
  voice: text("voice"), // Bland voice name assigned to THIS company's calling agent (e.g. anna-french). Auto-assigned per company so each agent has its own distinct voice.
  channelsEnabled: text("channels_enabled").default('{"email":true,"sms":true,"call":true,"video":true,"ads":true}'),
  dailyCap: integer("daily_cap").default(25).notNull(),
  optOutList: text("opt_out_list").default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Ads
export const ads = sqliteTable("ads", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").references(() => agents.id),
  platform: text("platform").notNull(),
  type: text("type").notNull(),
  headline: text("headline").notNull(),
  primaryText: text("primary_text").notNull(),
  callToAction: text("call_to_action"),
  targetAudience: text("target_audience"),
  dailyBudget: real("daily_budget").default(0),
  spend: real("spend").default(0),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  conversions: integer("conversions").default(0),
  ctr: real("ctr").default(0),
  cpc: real("cpc").default(0),
  roas: real("roas").default(0),
  status: text("status").default("draft").notNull(),
  generatedBy: text("generated_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Higgsfield AI generation jobs (images / videos / avatars).
// Replaces the old motion-engine ad pipeline. One row per generation request.
export const higgsfieldJobs = sqliteTable("higgsfield_jobs", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  sessionId: text("session_id"), // chat session that triggered it (surfaces inline in chat)
  chatMessageId: text("chat_message_id"), // linked chat message id, if any
  kind: text("kind").notNull(), // image | image_to_video | text_to_video | speak | soul_id
  endpoint: text("endpoint").notNull(), // Higgsfield endpoint used
  prompt: text("prompt"),
  input: text("input"), // JSON of the full input payload
  requestId: text("request_id"), // Higgsfield request/jobSet id
  status: text("status").default("queued").notNull(), // queued|in_progress|completed|failed|nsfw|canceled|skipped
  outputUrls: text("output_urls"), // JSON array of result media URLs
  outputUrl: text("output_url"), // first result (convenience)
  thumbnailUrl: text("thumbnail_url"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// Revenue Events
export const revenueEvents = sqliteTable("revenue_events", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  type: text("type").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").default("USD"),
  source: text("source"),
  customerEmail: text("customer_email"),
  description: text("description"),
  recurring: integer("recurring").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Browser Tasks
export const browserTasks = sqliteTable("browser_tasks", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").references(() => agents.id),
  type: text("type").notNull(),
  url: text("url"),
  query: text("query"),
  status: text("status").default("pending").notNull(),
  result: text("result"),
  findings: text("findings"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// SEO Content
export const seoContent = sqliteTable("seo_content", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentId: text("agent_id").references(() => agents.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  slug: text("slug"),
  content: text("content").notNull(),
  keywords: text("keywords"),
  metaDescription: text("meta_description"),
  status: text("status").default("draft").notNull(),
  generatedBy: text("generated_by"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Email Config per Company
export const emailConfig = sqliteTable("email_config", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id).unique(),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name").notNull(),
  domain: text("domain"),
  replyTo: text("reply_to"),
  signature: text("signature"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Inbound Emails
export const emailsInbox = sqliteTable("emails_inbox", {
  id: text("id").primaryKey(),
  companyId: text("company_id").references(() => companies.id),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  bodyHtml: text("body_html"),
  intent: text("intent"),
  sentiment: text("sentiment"),
  priority: text("priority").default("normal"),
  status: text("status").default("new").notNull(),
  assignedAgent: text("assigned_agent"),
  agentResponse: text("agent_response"),
  agentAction: text("agent_action"),
  repliedWith: text("replied_with"),
  metadata: text("metadata"),
  receivedAt: integer("received_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  processedAt: integer("processed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Agent Actions Log
export const agentActions = sqliteTable("agent_actions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  agentRole: text("agent_role").notNull(),
  actionType: text("action_type").notNull(),
  reasoning: text("reasoning").notNull(),
  inputData: text("input_data"),
  outputData: text("output_data"),
  status: text("status").default("completed").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Suppliers
export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  url: text("url"),
  contactEmail: text("contact_email"),
  contactName: text("contact_name"),
  products: text("products"),
  moq: integer("moq"),
  leadTime: integer("lead_time"),
  priceRange: text("price_range"),
  rating: real("rating"),
  verified: integer("verified").default(0),
  status: text("status").default("discovered").notNull(),
  negotiationLog: text("negotiation_log"),
  lastContact: integer("last_contact", { mode: "timestamp" }),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Products
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  supplierId: text("supplier_id").references(() => suppliers.id),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  sku: text("sku"),
  costPrice: real("cost_price"),
  shippingCost: real("shipping_cost"),
  landedCost: real("landed_cost"),
  retailPrice: real("retail_price"),
  margin: real("margin"),
  variants: text("variants"),
  materials: text("materials"),
  printifyProductId: text("printify_product_id"),
  printifyBlueprintId: integer("printify_blueprint_id"),
  printifyProviderId: integer("printify_provider_id"),
  printifyImageId: text("printify_image_id"),
  dimensions: text("dimensions"),
  weight: real("weight"),
  status: text("status").default("concept").notNull(),
  stockQuantity: integer("stock_quantity").default(0),
  reorderPoint: integer("reorder_point").default(10),
  tags: text("tags"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Product Images
export const productImages = sqliteTable("product_images", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  productId: text("product_id").references(() => products.id),
  type: text("type").notNull(),
  imageData: text("image_data"),
  prompt: text("prompt"),
  status: text("status").default("pending").notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Product Drafts (AI product visualizer - preview before catalog)
export const productDrafts = sqliteTable("product_drafts", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  description: text("description"),
  prompt: text("prompt"),
  imageData: text("image_data"),
  status: text("status").default("draft").notNull(),
  productId: text("product_id").references(() => products.id),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Shipping Config
export const shippingConfig = sqliteTable("shipping_config", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  provider: text("provider").notNull(),
  providerName: text("provider_name"),
  zones: text("zones"),
  freeShippingThreshold: real("free_shipping_threshold"),
  flatRate: real("flat_rate"),
  trackingEnabled: integer("tracking_enabled").default(1),
  fulfillmentType: text("fulfillment_type").default("bulk"),
  warehouseLocation: text("warehouse_location"),
  returnPolicy: text("return_policy"),
  isActive: integer("is_active").default(1),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Design Assets
export const designAssets = sqliteTable("design_assets", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  type: text("type").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  format: text("format"),
  version: integer("version").default(1),
  status: text("status").default("active").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Execution State / Checkpoints
export const executionState = sqliteTable("execution_state", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  processType: text("process_type").notNull(),
  processId: text("process_id").notNull(),
  status: text("status").notNull().default("running"),
  currentPhase: text("current_phase"),
  currentStep: integer("current_step").default(0),
  totalSteps: integer("total_steps").default(0),
  completedSteps: text("completed_steps"),
  pendingSteps: text("pending_steps"),
  checkpoint: text("checkpoint"),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// Token Transactions
export const tokenTransactions = sqliteTable("token_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  action: text("action"),
  balance: integer("balance").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Website Pages
export const websitePages = sqliteTable("website_pages", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  htmlContent: text("html_content").notNull(),
  pageType: text("page_type").default("static").notNull(),
  lang: text("lang").default("").notNull(), // language code: "fr", "nl", "en", "" = default/legacy
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
}, (table) => ({
  companySlugLangIdx: uniqueIndex("website_pages_company_slug_lang").on(table.companyId, table.slug, table.lang),
}));

// Admin Notifications
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").default("info").notNull(),
  read: integer("read").default(0).notNull(),
  fromAdmin: integer("from_admin").default(1).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Website Templates (marketplace)
export const websiteTemplates = sqliteTable("website_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  category: text("category").notNull(), // restaurant, saas, ecommerce, portfolio, agency, blog, startup, local-business
  industry: text("industry"),
  previewHtml: text("preview_html"), // full HTML for preview
  thumbnail: text("thumbnail"), // data URI or URL
  designSystem: text("design_system").notNull(), // JSON
  pages: text("pages").notNull(), // JSON array of page definitions
  features: text("features"), // JSON array of features
  popularity: integer("popularity").default(0),
  isPremium: integer("is_premium").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// CRM Customers
export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("customer_company"),
  source: text("source").default("manual").notNull(), // manual, email, website, ad, referral
  tags: text("tags"), // JSON array
  notes: text("notes"),
  totalValue: real("total_value").default(0),
  dealsCount: integer("deals_count").default(0),
  lastContactAt: integer("last_contact_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// CRM Deals
export const deals = sqliteTable("deals", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  customerId: text("customer_id").references(() => customers.id),
  title: text("title").notNull(),
  value: real("value").default(0),
  currency: text("currency").default("EUR"),
  stage: text("stage").default("lead").notNull(), // lead, prospect, negotiation, proposal, won, lost
  priority: text("priority").default("medium"), // low, medium, high, urgent
  probability: integer("probability").default(10), // 0-100%
  assignedAgent: text("assigned_agent"),
  source: text("source"), // inbound_email, website, manual, ad, referral
  notes: text("notes"),
  expectedCloseDate: text("expected_close_date"),
  closedAt: integer("closed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Global stats snapshot
export const statsSnapshots = sqliteTable("stats_snapshots", {
  id: text("id").primaryKey(),
  totalArr: real("total_arr").default(0),
  activeCompanies: integer("active_companies").default(0),
  tasksCompleted: integer("tasks_completed").default(0),
  emailsSent: integer("emails_sent").default(0),
  humanMessages: integer("human_messages").default(0),
  docsCreated: integer("docs_created").default(0),
  snapshotAt: integer("snapshot_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Community & Social AI System ─────────────────────────────────────────────

// Social Platform Connections (OAuth tokens)
export const socialConnections = sqliteTable("social_connections", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  platform: text("platform").notNull(), // twitter, discord, reddit, instagram
  platformUserId: text("platform_user_id"),
  platformUsername: text("platform_username"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: integer("token_expires_at", { mode: "timestamp" }),
  scopes: text("scopes"),
  metadata: text("metadata"), // JSON — extra platform data (Discord guild_id, etc.)
  isActive: integer("is_active").default(1),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Social Posts (AI-generated content)
export const socialPosts = sqliteTable("social_posts", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  platform: text("platform").notNull(),
  contentType: text("content_type").notNull(), // post, reply, thread, story, reel_script, discussion
  content: text("content").notNull(),
  mediaUrls: text("media_urls"), // JSON array
  hashtags: text("hashtags"), // JSON array
  strategy: text("strategy"), // JSON - strategist brain output
  status: text("status").default("draft").notNull(), // draft, approved, rejected, published, scheduled, failed
  finalScore: real("final_score").default(0),
  aiPipelineLog: text("ai_pipeline_log"), // JSON - full brain chain audit
  platformPostId: text("platform_post_id"),
  platformPostUrl: text("platform_post_url"),
  scheduledFor: integer("scheduled_for", { mode: "timestamp" }),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  impressions: integer("impressions").default(0),
  engagements: integer("engagements").default(0),
  clicks: integer("clicks").default(0),
  replies: integer("replies_count").default(0),
  replyToPostId: text("reply_to_post_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Social Interactions (tracked engagement)
export const socialInteractions = sqliteTable("social_interactions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  postId: text("post_id").references(() => socialPosts.id),
  platform: text("platform").notNull(),
  type: text("type").notNull(), // mention, reply, dm, comment, like, retweet, follow
  authorId: text("author_id"),
  authorUsername: text("author_username"),
  content: text("content"),
  aiResponse: text("ai_response"),
  aiResponseStatus: text("ai_response_status"), // pending, sent, skipped, escalated
  sentiment: text("sentiment"), // positive, neutral, negative
  priority: text("priority").default("medium"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// AI Pipeline Logs (brain chain audit trail)
export const aiPipelineLogs = sqliteTable("ai_pipeline_logs", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  postId: text("post_id"),
  brainName: text("brain_name").notNull(), // strategist, writer, tone_checker, fact_checker, anti_spam, approver, engagement, community_builder
  input: text("input").notNull(),
  output: text("output").notNull(),
  score: real("score").default(0),
  durationMs: integer("duration_ms").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Community Channels (Discord servers, subreddits, etc)
export const communityChannels = sqliteTable("community_channels", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  platform: text("platform").notNull(),
  channelType: text("channel_type").notNull(), // server, channel, subreddit, group
  name: text("name").notNull(),
  platformId: text("platform_id"),
  parentId: text("parent_id"), // for Discord channels under a server
  memberCount: integer("member_count").default(0),
  isActive: integer("is_active").default(1),
  metadata: text("metadata"), // JSON
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Content Calendar
export const contentCalendar = sqliteTable("content_calendar", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  postId: text("post_id").references(() => socialPosts.id),
  platform: text("platform").notNull(),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
  contentPreview: text("content_preview"),
  status: text("status").default("scheduled").notNull(), // scheduled, published, cancelled
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Marketplace Listings
export const marketplaceListings = sqliteTable("marketplace_listings", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // product, service, template, course, ebook, consulting
  price: real("price").notNull(),
  currency: text("currency").default("EUR"),
  images: text("images"), // JSON array of URLs
  tags: text("tags"), // JSON array
  status: text("status").default("active").notNull(), // active, sold, paused, draft
  views: integer("views").default(0),
  inquiries: integer("inquiries").default(0),
  sales: integer("sales").default(0),
  sellerName: text("seller_name"),
  contactEmail: text("contact_email"),
  externalUrl: text("external_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Marketplace Orders
export const marketplaceOrders = sqliteTable("marketplace_orders", {
  id: text("id").primaryKey(),
  listingId: text("listing_id").notNull().references(() => marketplaceListings.id),
  buyerCompanyId: text("buyer_company_id").references(() => companies.id),
  buyerEmail: text("buyer_email"),
  buyerName: text("buyer_name"),
  amount: real("amount").notNull(),
  currency: text("currency").default("EUR"),
  status: text("status").default("pending").notNull(), // pending, paid, delivered, refunded
  paymentRef: text("payment_ref"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ==========================================
// AUTOPILOT SYSTEM — AI Agents Running 24/7
// ==========================================

// Per-company autopilot configuration
export const autopilotConfig = sqliteTable("autopilot_config", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id).unique(),
  enabled: integer("enabled", { mode: "boolean" }).default(false).notNull(),
  approvalMode: integer("approval_mode", { mode: "boolean" }).default(false).notNull(),
  // Work schedule (UTC hours)
  workStartHour: integer("work_start_hour").default(7).notNull(), // 7am UTC (~8-9am EU)
  workEndHour: integer("work_end_hour").default(22).notNull(), // 10pm UTC
  // Agent preferences (JSON: which agents are active, custom instructions per agent)
  agentConfig: text("agent_config"), // JSON
  // Limits
  maxPostsPerDay: integer("max_posts_per_day").default(3).notNull(),
  maxWebsiteEditsPerDay: integer("max_website_edits_per_day").default(2).notNull(),
  // State tracking
  lastTickAt: integer("last_tick_at", { mode: "timestamp" }),
  lastMorningPlanAt: integer("last_morning_plan_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Daily plans created by Strategist each morning
export const autopilotPlans = sqliteTable("autopilot_plans", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  date: text("date").notNull(), // YYYY-MM-DD
  // The plan itself
  summary: text("summary").notNull(), // Human-readable daily summary
  goals: text("goals").notNull(), // JSON array of goals for the day
  strategy: text("strategy"), // JSON: reasoning, focus areas, priorities
  // Revenue analysis
  revenueAnalysis: text("revenue_analysis"), // JSON: traffic, conversion, blockers
  // Status
  status: text("status").default("active").notNull(), // active, completed, abandoned
  completedTasks: integer("completed_tasks").default(0).notNull(),
  totalTasks: integer("total_tasks").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Individual tasks the AI creates and executes
export const autopilotTasks = sqliteTable("autopilot_tasks", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  planId: text("plan_id").references(() => autopilotPlans.id),
  // Which agent owns this task
  agent: text("agent").notNull(), // strategist, content, marketing, analytics
  // Task details
  type: text("type").notNull(), // create_post, edit_website, analyze_metrics, engage_comment, create_article, adjust_strategy, etc.
  title: text("title").notNull(),
  description: text("description"), // What the AI plans to do
  input: text("input"), // JSON: data the agent needs
  output: text("output"), // JSON: what the agent produced
  // Scheduling
  priority: integer("priority").default(5).notNull(), // 1=urgent, 10=low
  scheduledFor: integer("scheduled_for", { mode: "timestamp" }), // When to execute (null = ASAP)
  // Time slot for the build-page task scheduler UI (matin/midi/soir)
  timeSlot: text("time_slot"), // 'morning' | 'noon' | 'evening' — derived from scheduledFor or set by drag/edit
  slotOrder: integer("slot_order").default(0).notNull(), // ordre dans le créneau (plus petit = plus haut/plus tôt)
  hasExactTime: integer("has_exact_time", { mode: "boolean" }).default(false).notNull(), // date avec heure vs date seule
  // Approval workflow
  requiresApproval: integer("requires_approval", { mode: "boolean" }).default(false).notNull(),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
  approvedBy: text("approved_by"), // user ID
  rejectedAt: integer("rejected_at", { mode: "timestamp" }),
  rejectionReason: text("rejection_reason"),
  // Status
  status: text("status").default("pending").notNull(), // pending, waiting_approval, running, completed, failed, rejected, cancelled
  error: text("error"),
  // Dependencies: wait for another task before running
  dependsOn: text("depends_on"), // task ID
  // Timing
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Audit log of everything the AI did
export const autopilotLogs = sqliteTable("autopilot_logs", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  taskId: text("task_id").references(() => autopilotTasks.id),
  agent: text("agent").notNull(), // strategist, content, marketing, analytics, system
  // What happened
  action: text("action").notNull(), // e.g. "created_plan", "posted_twitter", "edited_homepage", "analyzed_metrics"
  message: text("message").notNull(), // Human-readable description
  details: text("details"), // JSON: full context
  // Tokens used
  tokensUsed: integer("tokens_used").default(0),
  // Severity
  level: text("level").default("info").notNull(), // info, warning, error, success
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Project Files (Lovable-style project file system) ──────────────────────
export const projectFiles = sqliteTable("project_files", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  filePath: text("file_path").notNull(),     // e.g. "src/components/Header.tsx"
  content: text("content").notNull(),
  fileType: text("file_type").notNull(),      // component, page, style, config, asset, layout, lib, route
  version: integer("version").default(1),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
}, (table) => ({
  companyFileIdx: uniqueIndex("project_files_company_filepath").on(table.companyId, table.filePath),
}));

// Project file version history (for undo/redo)
export const projectFileVersions = sqliteTable("project_file_versions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  filePath: text("file_path").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull(),
  changeDescription: text("change_description"), // AI-generated description of what changed
  createdAt: text("created_at"),
});

// ─── Snapshots complets d'un projet à chaque travail fini (build/édition) ────
// Chaque ligne = un point de restauration ("checkpoint") capturé quand un build
// ou une édition se termine. On y stocke un SNAPSHOT COMPLET du projet (tous les
// project_files ET toutes les website_pages) sous forme de JSON. Sert à :
//  - le bouton "Rollback" (remettre le projet exactement à cet état),
//  - garder l'historique en mémoire pour un redo ("remets comme avant").
// On n'efface jamais un checkpoint lors d'un rollback → l'historique reste intact.
export const projectCheckpoints = sqliteTable("project_checkpoints", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  label: text("label").notNull(),                 // ex: "Site généré", "Édition: header noir"
  kind: text("kind").notNull().default("build"),  // 'build' | 'edit'
  projectType: text("project_type").default("web"), // web | mobile | both (au moment du snapshot)
  filesJson: text("files_json").notNull(),        // JSON { files: [...], pages: [...] }
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Calendrier interne de l'IA (Velbaz) — INVISIBLE pour l'utilisateur ───────
// Chaque projet a SON calendrier privé. L'IA y note tout ce qui est prévu :
// campagnes marketing / emails programmés, tâches à faire, rappels/relances
// (follow-up), dates de mise à jour du site, deadlines/échéances, et rendez-vous
// ou actions avec des clients. Ce calendrier n'est JAMAIS affiché dans l'UI
// utilisateur : seule l'IA l'utilise en interne, et elle peut en parler dans le
// chat UNIQUEMENT si l'utilisateur le lui demande. Il est aussi visible côté
// développeur via l'admin panel. Quand la date d'un événement arrive, l'IA en
// fait AUTOMATIQUEMENT une tâche (autopilot_tasks) — voir ai-calendar.ts.
export const aiCalendarEvents = sqliteTable("ai_calendar_events", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  // marketing | task | reminder | update | deadline | client_meeting
  category: text("category").notNull().default("task"),
  title: text("title").notNull(),
  description: text("description"),
  // Jour prévu de l'événement (00:00 si pas d'heure précise).
  eventDate: integer("event_date", { mode: "timestamp" }).notNull(),
  hasExactTime: integer("has_exact_time", { mode: "boolean" }).default(false).notNull(),
  // Optionnel : client/lead concerné (rendez-vous, relance…).
  clientName: text("client_name"),
  leadId: text("lead_id"),
  // Qui a créé l'entrée : 'ai' (chat), 'autopilot', 'system', 'admin'.
  source: text("source").notNull().default("ai"),
  // planned = prévu ; materialized = tâche créée ; done ; cancelled ; conflict = décalé pour conflit
  status: text("status").notNull().default("planned"),
  // Tâche autopilot créée quand la date est arrivée (matérialisation).
  relatedTaskId: text("related_task_id"),
  // Journal des conflits/décalages détectés (JSON).
  conflictNote: text("conflict_note"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (table) => ({
  companyIdx: index("ai_calendar_company_idx").on(table.companyId),
  dateIdx: index("ai_calendar_date_idx").on(table.eventDate),
}));

// AI-discovered insights about the business
// ─── Mémoire d'apprentissage globale du Builder (Velbaz) ──────────────────────
// Table de "leçons" apprises automatiquement à partir du score QA de CHAQUE
// génération de page (avant/après), partagées entre TOUS les utilisateurs et
// entreprises. Chaque ligne = un pattern de code fautif détecté + la
// correction qui a fait remonter le score, avec un compteur de fréquence.
// Le builder relit les leçons les plus fréquentes/fiables et les injecte dans
// le prompt système AVANT de générer, pour éviter de refaire la même erreur.
export const builderLessons = sqliteTable("builder_lessons", {
  id: text("id").primaryKey(),
  // Code du problème détecté par qa.ts (ex: DEAD_HANDLER, INERT_BUTTONS, CORE_NO_DATA…)
  issueCode: text("issue_code").notNull(),
  // Résumé court, réutilisable en prompt, de la règle apprise (1-2 phrases,
  // générique — pas de détails propres à une entreprise/un business précis).
  lesson: text("lesson").notNull(),
  // Combien de fois ce pattern a été observé (recréé/renforcé au lieu de dupliqué).
  occurrences: integer("occurrences").default(1).notNull(),
  // Score QA moyen AVANT correction et APRÈS, pour ne garder que les leçons
  // qui ont un impact réel et mesurable.
  avgScoreBefore: real("avg_score_before").notNull(),
  avgScoreAfter: real("avg_score_after").notNull(),
  // Fiabilité 0-1: proportion des occurrences où la correction a bien amélioré
  // le score (utilisé pour prioriser/élaguer les leçons peu fiables).
  reliability: real("reliability").default(1).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Journal de bord partagé de TOUTES les IA (Velbaz) ────────────────────────
// Mémoire DURABLE, par projet, de tout ce que les IA font: le builder (plan,
// design, chaque page, QA), le chat (édition, réponse), les sous-agents
// (juridique, marketing). Survit au rechargement de page ET au redémarrage du
// serveur. Sert à ce que l'IA soit VRAIMENT « au courant de ce qu'elle a fait »:
//   - à la reprise, elle relit ce journal et récapitule où elle en est,
//   - un BUG enregistré (kind='issue', resolved=0) est re-corrigé AUTOMATIQUEMENT,
//   - une OCCASION d'amélioration (kind='opportunity') est seulement PROPOSÉE.
// On n'efface jamais une entrée: c'est l'historique de conscience du projet.
export const buildJournal = sqliteTable("build_journal", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  // Quelle IA a écrit l'entrée: 'builder' | 'chat' | 'qa' | 'legal' | 'marketing' | 'system'
  actor: text("actor").notNull(),
  // Nature: 'action' (a fait qqch) | 'decision' | 'issue' (bug) | 'fix' (bug corrigé)
  //         | 'opportunity' (amélioration possible, non appliquée) | 'resume' (reprise)
  kind: text("kind").notNull(),
  // Phase du build/édition: 'plan' | 'design' | 'pages' | 'done' | 'edit' | 'chat' | ...
  phase: text("phase"),
  // Ligne lisible par un humain (fr) — c'est ce qui est récapitulé à la reprise.
  summary: text("summary").notNull(),
  // Détail optionnel (ex: fichier concerné, message d'erreur, JSON).
  detail: text("detail"),
  // Pour 'issue'/'opportunity': 0 = ouvert (à corriger/proposer), 1 = traité.
  resolved: integer("resolved").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (table) => ({
  companyIdx: index("build_journal_company").on(table.companyId),
}));

// 21st.dev component search cache — raw registry results per query string.
// Project-independent, so shared across ALL sites/companies. Cuts the slow
// 21st.dev API round-trip on repeated searches (hero, pricing, features, ...).
export const componentCache = sqliteTable("component_cache", {
  query: text("query").primaryKey(), // normalized lowercase search query
  results: text("results").notNull(), // JSON: raw SearchResult[]
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Cache des verdicts vision 21st.dev — un composant déjà jugé (même preview,
// même contexte visuel) n'est JAMAIS re-analysé par un modèle vision.
export const visionVerdictCache = sqliteTable("vision_verdict_cache", {
  key: text("key").primaryKey(), // hash(preview_url + contexte visuel)
  score: integer("score").notNull(), // 0-100
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Cache des design systems générés — même contexte business (industrie, idée,
// vibe) → même design. Évite un appel Opus (le plus cher) sur les rebuilds.
export const designSystemCache = sqliteTable("design_system_cache", {
  key: text("key").primaryKey(), // hash du prompt de design complet
  json: text("json").notNull(), // design system sérialisé
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Cache du code source des composants 21st.dev (CDN) — évite de re-télécharger.
export const componentCodeCache = sqliteTable("component_code_cache", {
  url: text("url").primaryKey(),
  code: text("code").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

export const autopilotInsights = sqliteTable("autopilot_insights", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  // Insight details
  category: text("category").notNull(), // revenue, traffic, content, audience, competitor, opportunity
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity").default("info").notNull(), // critical, warning, info, positive
  // What to do about it
  recommendation: text("recommendation"),
  // Was it acted on?
  status: text("status").default("new").notNull(), // new, acknowledged, acted_on, dismissed
  actedOnTaskId: text("acted_on_task_id").references(() => autopilotTasks.id),
  // Auto-expire old insights
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Per-company secrets (Stripe/Resend/etc API keys) provided via the AI "secret"
// popup. Values are stored server-side and never echoed back into the chat.
// Printify print-on-demand orders (fulfilment tracking)
export const printifyOrders = sqliteTable("printify_orders", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  referenceId: text("reference_id"),        // external_id envoyé à Printify
  printifyOrderId: text("printify_order_id"),
  status: text("status").default("pending").notNull(),
  shipmentStatus: text("shipment_status"),
  trackingUrl: text("tracking_url"),
  customerEmail: text("customer_email"),
  payload: text("payload"),                 // JSON de la commande envoyée
  lastEvent: text("last_event"),            // JSON dernier webhook reçu
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

export const companySecrets = sqliteTable("company_secrets", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  key: text("key").notNull(), // e.g. STRIPE_SECRET_KEY
  value: text("value").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ── Dropshipping ──────────────────────────────────────────────────────────────
// Commandes clients passées sur le site généré (Stripe Checkout).
// Statuts EN TEXTE, jamais couleur seule :
// [PAYÉE] → [ENVOYÉE FOURNISSEUR] → [LIVRÉE], ou [ERREUR: raison] / [À TRAITER] (semi-auto)
export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  // Paiement client
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountTotal: real("amount_total"),          // ce que le client a payé
  currency: text("currency").default("USD"),
  // Client + livraison
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  shippingAddress: text("shipping_address"),  // JSON {line1,line2,city,state,zip,country,phone}
  // Fulfillment fournisseur
  fulfillmentMode: text("fulfillment_mode").default("auto").notNull(), // auto (CJ) | semi (AliExpress/service)
  supplierPlatform: text("supplier_platform"),   // cj | aliexpress | service
  supplierOrderId: text("supplier_order_id"),    // orderId CJ
  supplierCost: real("supplier_cost"),           // payé au fournisseur (solde CJ)
  marginAmount: real("margin_amount"),           // amountTotal - supplierCost
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  // Statut texte + journal (auditable, sans couleur)
  status: text("status").default("[PAYÉE]").notNull(),
  statusLog: text("status_log"),              // JSON [{at, status, detail}]
  errorDetail: text("error_detail"),          // raison lisible si [ERREUR]
  dryRun: integer("dry_run").default(0),      // 1 = simulation (aucune dépense CJ)
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  companyId: text("company_id").notNull().references(() => companies.id),
  productId: text("product_id").references(() => products.id),
  name: text("name").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  unitPrice: real("unit_price"),              // prix de vente unitaire
  unitCost: real("unit_cost"),                // coût fournisseur unitaire
  // Références fournisseur pour createOrder CJ
  supplierProductId: text("supplier_product_id"), // pid CJ
  supplierVariantId: text("supplier_variant_id"), // vid CJ
  variantLabel: text("variant_label"),            // ex. "Rouge / M"
  imageUrl: text("image_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Cache des recherches fournisseur (agent Sourcing) — évite de re-payer l'API
export const sourcingResults = sqliteTable("sourcing_results", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  query: text("query").notNull(),             // mots-clés anglais envoyés à CJ
  platform: text("platform").default("cj").notNull(), // cj | aliexpress
  supplierProductId: text("supplier_product_id"),     // pid CJ / URL AliExpress
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  costPrice: real("cost_price"),              // prix fournisseur (USD)
  suggestedRetail: real("suggested_retail"),  // prix de vente conseillé (marge ×2.5-3)
  rating: real("rating"),
  stockInfo: text("stock_info"),              // JSON {us, eu, cn}
  shippingInfo: text("shipping_info"),        // JSON délais/coûts par zone
  variants: text("variants"),                 // JSON [{vid, label, price}]
  raw: text("raw"),                           // JSON réponse brute
  status: text("status").default("candidat").notNull(), // candidat | retenu | rejeté
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Money Maker : usine à entreprises autonome (couche "boss" au-dessus de Velbaz) ───
// Config singleton par utilisateur. Le boss réfléchit, cherche les tendances,
// et lance/gère des entreprises tout seul quand `enabled` est vrai.
export const moneyMakerConfig = sqliteTable("money_maker_config", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id).unique(),
  enabled: integer("enabled", { mode: "boolean" }).default(false).notNull(),      // mode auto global on/off
  autoSpawn: integer("auto_spawn", { mode: "boolean" }).default(true).notNull(),  // le boss lance de nouvelles entreprises seul
  maxConcurrent: integer("max_concurrent").default(5).notNull(),                  // slots build/edit simultanés max
  killAfterDays: integer("kill_after_days").default(14).notNull(),                // seuil "mort" : 0€ après N jours -> kill
  strategyNote: text("strategy_note"),                                           // consigne libre donnée au boss via le chat
  lastTickAt: integer("last_tick_at", { mode: "timestamp" }),
  // Objectif de revenu fixé par l'owner ("faire X€/mois d'ici telle date")
  goalTargetMrr: integer("goal_target_mrr"),                                      // objectif MRR mensuel (€), accepté
  goalDeadline: integer("goal_deadline", { mode: "timestamp" }),                  // date cible de l'objectif accepté
  goalStatus: text("goal_status"),                                               // null | 'accepted'
  goalAssessment: text("goal_assessment"),                                       // dernière analyse de faisabilité (texte)
  goalPending: text("goal_pending"),                                             // JSON : proposition ajustée en attente d'Accept
  goalOriginal: text("goal_original"),                                           // demande brute de l'owner
  // Emails : envoi par l'IA
  emailAutoSend: integer("email_auto_send", { mode: "boolean" }).default(false).notNull(), // false = validation humaine (brouillon), true = envoi direct
  emailFromName: text("email_from_name"),                                        // nom d'expéditeur par défaut (sinon = nom de l'entreprise)
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Journal des décisions & activité du boss (alimente le panneau central + audit "argent réel")
export const moneyMakerRuns = sqliteTable("money_maker_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  type: text("type").notNull(),            // spawn | improve | kill | research | decision | chat
  companyId: text("company_id"),           // entreprise concernée (nullable pour research/decision globale)
  title: text("title").notNull(),
  detail: text("detail"),                  // texte/markdown
  meta: text("meta"),                      // JSON libre (idée trouvée, métriques, etc.)
  status: text("status").default("done").notNull(), // running | done | failed
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (t) => ({
  byUser: index("mm_runs_user_idx").on(t.userId),
}));

// File d'attente des entreprises à construire/éditer (respecte maxConcurrent = 5)
export const moneyMakerQueue = sqliteTable("money_maker_queue", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  companyId: text("company_id"),           // rempli une fois l'entreprise créée
  kind: text("kind").notNull(),            // build | edit
  payload: text("payload"),                // JSON : idée trouvée (nom, niche, type web/mobile, angle revenu)
  status: text("status").default("queued").notNull(), // queued | active | done | failed
  slotStartedAt: integer("slot_started_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (t) => ({
  byUserStatus: index("mm_queue_user_status_idx").on(t.userId, t.status),
}));

// ── Trading crypto ─────────────────────────────────────────────────────────
// Portefeuille de trading par entreprise. Mode:
//   paper = simulé aux VRAIS prix (aucun risque) · live = ordres réels via exchange.
export const tradingPortfolios = sqliteTable("trading_portfolios", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  mode: text("mode").default("paper").notNull(),      // analyse | paper | live
  quoteAsset: text("quote_asset").default("USDT").notNull(),
  cash: real("cash").default(10000).notNull(),        // solde disponible (paper: virtuel)
  holdings: text("holdings").default("{}").notNull(), // JSON { "BTC": { qty, avgPrice } }
  realizedPnl: real("realized_pnl").default(0).notNull(),
  exchange: text("exchange").default("binance"),      // pour le mode live (ccxt)
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (t) => ({
  byCompany: uniqueIndex("trading_pf_company_idx").on(t.companyId),
}));

// Ordres passés (paper ou live).
export const tradingOrders = sqliteTable("trading_orders", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  mode: text("mode").default("paper").notNull(),      // paper | live
  symbol: text("symbol").notNull(),                   // ex. BTC/USDT
  side: text("side").notNull(),                       // buy | sell
  qty: real("qty").notNull(),                         // quantité en base asset
  price: real("price").notNull(),                     // prix d'exécution réel
  cost: real("cost").notNull(),                        // qty * price (quote asset)
  status: text("status").default("filled").notNull(), // filled | rejected | error
  note: text("note"),                                  // raison / message
  exchangeOrderId: text("exchange_order_id"),          // id renvoyé par l'exchange (live)
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (t) => ({
  byCompany: index("trading_orders_company_idx").on(t.companyId),
}));

// ─── Secret store : clés API sensibles chiffrées au repos (AES-256-GCM) ───────
// Write-only : la valeur en clair n'est JAMAIS renvoyée au front. On expose
// seulement { name, isSet, last4, updatedAt }. Déchiffrement uniquement côté
// serveur au runtime via getSecret(). La master key vit dans l'env (jamais en DB).
export const secretStore = sqliteTable("secret_store", {
  name: text("name").primaryKey(),          // ex. RESEND_API_KEY, HF_API_KEY, GITHUB_TOKEN
  valueEnc: text("value_enc").notNull(),    // "v1:ivB64:tagB64:cipherB64"
  last4: text("last4"),                      // 4 derniers caractères (affichage seul)
  updatedBy: text("updated_by"),             // email admin ayant posé la valeur (audit)
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Config providers IA perso : clé chiffrée par provider ───────────────────
// Si un provider actif a une clé valide -> le builder l'utilise EN DIRECT au lieu
// du Runable AI Gateway. Sinon repli automatique sur le gateway.
export const aiProviderConfig = sqliteTable("ai_provider_config", {
  provider: text("provider").primaryKey(),   // openai | anthropic | google | custom
  apiKeyEnc: text("api_key_enc").notNull(),  // clé chiffrée (même format que secretStore)
  baseUrl: text("base_url"),                  // optionnel (endpoint OpenAI-compatible)
  enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
  status: text("status").default("unknown").notNull(), // valid | invalid | unknown
  statusMessage: text("status_message"),      // dernier message de test
  last4: text("last4"),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Bêta : accès au site par code d'invitation ──────────────────────────────
// Le code se saisit à l'ENTRÉE du site (pas à la création de compte). Un code
// "admin" (isAdmin=true, maxUses=null) marche toujours et ne consomme pas de
// place. Les codes normaux ont un nombre de places (maxUses) = nombre de
// testeurs autorisés ; chaque nouvel appareil/IP qui l'utilise prend une place.
export const betaCodes = sqliteTable("beta_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),        // saisi par l'utilisateur (comparé en MAJUSCULES)
  label: text("label"),                          // description libre (ex. "Bêta publique")
  maxUses: integer("max_uses"),                  // null = illimité
  uses: integer("uses").default(0).notNull(),    // places déjà prises
  isAdmin: integer("is_admin", { mode: "boolean" }).default(false).notNull(), // code maître (illimité, ne consomme pas de place)
  active: integer("active", { mode: "boolean" }).default(true).notNull(),
  batchId: text("batch_id"),                      // lot de génération (pour regrouper les codes générés ensemble)
  // ── Traçabilité de la 1re utilisation (codes uniques à usage unique) ──
  usedAt: integer("used_at", { mode: "timestamp" }),   // date de 1re validation
  usedIp: text("used_ip"),                        // IP au moment de la validation (le "lieu" d'utilisation)
  usedDeviceId: text("used_device_id"),           // appareil qui a validé le code
  usedUserAgent: text("used_user_agent"),         // navigateur/appareil
  usedByUserId: text("used_by_user_id"),          // compte créé/lié après avoir utilisé ce code
  usedByEmail: text("used_by_email"),             // email du compte lié (snapshot)
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// Appareils/IP ayant déjà validé un code — pour ne PLUS redemander le code.
export const betaAccess = sqliteTable("beta_access", {
  id: text("id").primaryKey(),
  codeId: text("code_id").notNull().references(() => betaCodes.id),
  deviceId: text("device_id").notNull(),         // uuid généré côté client (localStorage)
  ip: text("ip"),                                 // IP au moment de la validation
  userAgent: text("user_agent"),
  isAdmin: integer("is_admin", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
}, (t) => ({
  byDevice: index("beta_access_device_idx").on(t.deviceId),
  byIp: index("beta_access_ip_idx").on(t.ip),
}));

// ─── Config globale de l'app (clé/valeur) ───────────────────────────────────
// Stocke des réglages simples au niveau du site, ex. beta_enabled ("1"/"0").
export const appConfig = sqliteTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Journal des runs du moteur /genesis ────────────────────────────────────
// Partie 10.4 de la spec : chaque phase du pipeline est journalisée pour
// pouvoir analyser après coup où le raisonnement a dérivé.
export const genesisRuns = sqliteTable("genesis_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  sessionId: text("session_id"),
  brief: text("brief").notNull(),
  status: text("status").notNull().default("running"), // running | done | error
  phases: text("phases"),        // JSON: [{phase,title,output,ms}]
  critiques: text("critiques"),  // JSON: [{cycle,scores,verdict,fixes}]
  spec: text("spec"),
  degraded: integer("degraded", { mode: "boolean" }).default(false),
  weaknesses: text("weaknesses"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(unixepoch())`),
});

// ─── Journal de consommation IA (crédits) ───────────────────────────────────
// Un enregistrement par appel IA, écrit par le middleware du gateway : donc
// TOUS les appels sont couverts, pas seulement ceux instrumentés à la main.
// Répond à : combien, pour quoi, quand, pour quel user/projet, combien de temps,
// et si l'appel a échoué (coût gaspillé).
export const aiUsageEvents = sqliteTable("ai_usage_events", {
  id: text("id").primaryKey(),
  // Horodatage début/fin — permet la timeline « quand l'IA a bossé ».
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }).notNull(),
  durationMs: integer("duration_ms").notNull().default(0),

  model: text("model").notNull(),
  provider: text("provider").notNull().default("unknown"), // anthropic | openai | google | openrouter…
  routedVia: text("routed_via").notNull().default("gateway"), // gateway | direct-key
  kind: text("kind").notNull().default("text"), // text | stream | image | other

  // Attribution : à quoi servait l'appel.
  feature: text("feature").notNull().default("unknown"),
  label: text("label"),
  route: text("route"),
  runId: text("run_id"),

  userId: text("user_id"),
  userEmail: text("user_email"),
  companyId: text("company_id"),
  projectId: text("project_id"),

  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  images: integer("images").notNull().default(0),

  costUsd: real("cost_usd").notNull().default(0),
  credits: real("credits").notNull().default(0),
  // "table" = prix connu, "fallback" = modèle absent de la grille (coût estimé).
  priced: text("priced").notNull().default("table"),

  status: text("status").notNull().default("ok"), // ok | error
  errorMessage: text("error_message"),
  finishReason: text("finish_reason"),
  meta: text("meta"), // JSON libre
}, (t) => ({
  tsIdx: index("aiu_started_idx").on(t.startedAt),
  featureIdx: index("aiu_feature_idx").on(t.feature),
  modelIdx: index("aiu_model_idx").on(t.model),
  userIdx: index("aiu_user_idx").on(t.userId),
  companyIdx: index("aiu_company_idx").on(t.companyId),
  runIdx: index("aiu_run_idx").on(t.runId),
  statusIdx: index("aiu_status_idx").on(t.status),
}));
