import { z } from "zod";

const nullableText = z.string().nullable().optional();
export const roleSchema = z.enum(["owner", "admin", "member"]);
export type Role = z.infer<typeof roleSchema>;

export const adminContextSchema = z.object({
  user: z.object({ id: z.string(), email: nullableText, name: nullableText }),
  currentOrganization: z.object({
    id: z.string(),
    name: z.string(),
    role: roleSchema,
  }),
  currentWorkspace: z.object({ id: z.string(), name: z.string() }),
});
export type AdminContext = z.infer<typeof adminContextSchema>;

export const envVarSchema = z.object({
  name: z.string(),
  maskedValue: z.string(),
  deliveredToFlowRuns: z.boolean().optional(),
  setBy: nullableText,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EnvVar = z.infer<typeof envVarSchema>;
export const envVarListSchema = z.object({
  data: z.object({ items: z.array(envVarSchema) }),
});

export const credentialFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  placeholder: z.string().optional(),
});
export type CredentialField = z.infer<typeof credentialFieldSchema>;

export const connectionSchema = z.object({
  connectionId: z.string(),
  provider: z.string(),
  status: z.enum(["ready", "error"]),
  authMode: z.enum(["oauth2", "api_key"]),
  scopes: z.array(z.string()),
  accountLabel: nullableText,
  lastError: nullableText,
  connectedAt: z.string(),
  accessTokenExpiresAt: nullableText,
  refreshable: z.boolean().optional(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const oauthAppSchema = z.object({
  clientId: z.string(),
  clientSecretMasked: z.string(),
  scopes: z.array(z.string()),
  scopesOverridden: z.boolean(),
  updatedAt: z.string(),
});
export type OAuthApp = z.infer<typeof oauthAppSchema>;

export const providerSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  configKey: z.string().optional(),
  authMode: z.enum(["OAUTH2", "API_KEY"]),
  categories: z.array(z.string()).optional(),
  docs: z.string().optional(),
  defaultScopes: z.array(z.string()).optional(),
  appSetupUrl: z.string().url().optional(),
  credentialFields: z.array(credentialFieldSchema).optional(),
  configured: z.boolean(),
  oauthApp: oauthAppSchema.nullable(),
  connection: connectionSchema.nullable(),
});
export type Provider = z.infer<typeof providerSchema>;
export const providersSchema = z.object({
  redirectUri: z.string(),
  canManage: z.boolean(),
  providers: z.array(providerSchema),
});
export type ProvidersView = z.infer<typeof providersSchema>;

export const tokenPurposeSchema = z.enum([
  "agent-runtime",
  "workflow",
  "deployment",
]);
export type TokenPurpose = z.infer<typeof tokenPurposeSchema>;
export const apiTokenSchema = z.object({
  id: z.string(),
  label: z.string(),
  purpose: tokenPurposeSchema,
  scopes: z.array(z.string()),
  createdBy: z
    .object({ id: z.string(), name: nullableText, email: nullableText })
    .nullable(),
  createdAt: z.string(),
  accessTokenExpiresAt: nullableText,
  lastUsedAt: nullableText,
  status: z.enum(["active", "expired", "revoked"]),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;
export const apiTokensSchema = z.object({ tokens: z.array(apiTokenSchema) });
export const createdTokenSchema = apiTokenSchema.extend({
  accessToken: z.string(),
});

export const memberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  joinedAt: nullableText,
});
export type Member = z.infer<typeof memberSchema>;
export const membersSchema = z.object({ memberships: z.array(memberSchema) });

/** Self-host invites (relaycontrol /organizations/{id}/invitations). */
export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  invitedBy: z
    .object({ id: z.string(), name: z.string(), email: z.string() })
    .nullable()
    .optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;
export const invitationsSchema = z.object({
  invitations: z.array(invitationSchema),
});
export const emailDeliverySchema = z.enum([
  "sent",
  "failed",
  "not_configured",
  "skipped",
]);
export type EmailDelivery = z.infer<typeof emailDeliverySchema>;
export const invitationLinkSchema = z.object({
  invitation: invitationSchema,
  inviteUrl: z.string(),
  emailDelivery: emailDeliverySchema,
});
export type InvitationLink = z.infer<typeof invitationLinkSchema>;
export const signInMethodsSchema = z.object({
  oidc: z
    .object({ displayName: z.string(), allowedDomains: z.array(z.string()) })
    .nullable(),
  emailLink: z.boolean(),
  inviteEmail: z.boolean(),
  autoJoinDomains: z.array(z.string()),
  inviteTtlHours: z.number(),
});
export type SignInMethods = z.infer<typeof signInMethodsSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  relaycastWorkspaceId: z.string().optional(),
});
export const workspacesSchema = z.object({
  workspaces: z.array(workspaceSchema),
});

export const connectSessionSchema = z.object({
  connectLink: z.string().url(),
});

/** Hosted `CloudAgent` (Settings > Connections > Coding agents). No secrets. */
export const codingAgentSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  harness: z.string(),
  modelProvider: z.string(),
  authType: z.string(),
  label: nullableText,
  accountEmail: nullableText,
  secretPreview: z.string(),
  isActive: z.boolean(),
  harnessActive: z.boolean().optional(),
  defaultModel: nullableText,
  status: z.string(),
  lastAuthenticatedAt: nullableText,
  lastCheckedAt: nullableText,
  lastUsedAt: nullableText,
  lastError: nullableText,
  createdAt: z.string(),
  updatedAt: z.string(),
  owner: z
    .object({
      userId: z.string(),
      name: nullableText,
      email: nullableText,
      avatarUrl: nullableText,
    })
    .nullable()
    .optional(),
});
export type CodingAgent = z.infer<typeof codingAgentSchema>;

export const codingAgentProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  harness: z.string(),
  envName: z.string(),
  authTypes: z.array(z.string()),
  keyPlaceholder: z.string().optional(),
  docsUrl: z.string().optional(),
});
export type CodingAgentProvider = z.infer<typeof codingAgentProviderSchema>;

export const codingAgentsSchema = z.object({
  agents: z.array(codingAgentSchema),
  providers: z.array(codingAgentProviderSchema),
  canManage: z.boolean(),
});
export type CodingAgentsView = z.infer<typeof codingAgentsSchema>;

export const codingAgentCheckSchema = z.object({
  status: z.enum(["available", "unavailable", "unsupported", "error"]),
  checkedAt: z.string(),
  message: z.string(),
});
export type CodingAgentCheck = z.infer<typeof codingAgentCheckSchema>;

export const deviceLoginStartSchema = z.object({
  transactionId: z.string(),
  verificationUri: z.string().url(),
  userCode: z.string(),
  intervalSeconds: z.number().int().positive(),
  expiresAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "expiresAt must be a valid date"),
});
export const deviceLoginStatusSchema = z.object({
  status: z.enum(["pending", "connected", "expired", "failed"]),
  retryAfterSeconds: z.number().int().positive().optional(),
  providerCredentialId: z.string().optional(),
});
