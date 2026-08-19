// Generated from spec/raw.json. Do not edit by hand.
// 50 operations across 11 areas of the Spaceship API.

export type Tier = "T0" | "T1" | "T2" | "T3";

export type Operation = {
  /** Command name as typed by a user: `domains list` */
  command: string;
  /** One line, human-facing */
  description: string;
  method: string;
  path: string;
  /** Risk tier: T0 read, T1 reversible, T2 destructive, T3 money or domain loss */
  tier: Tier;
  /** Returns 202 + spaceship-async-operationid; supports --wait */
  async: boolean;
  operationId: string;
  /** Documented rate limit, parsed from the spec prose */
  rateLimit: { limit: number; scope: string; windowSeconds: number } | null;
  /** API key scopes required */
  scopes: string[];
};

export const OPERATIONS: readonly Operation[] = [
  { command: "ops get", description: "Check an async operation", method: "GET", path: "/v1/async-operations/{operationId}", tier: "T0", async: false, operationId: "getAsyncOperationDetails", rateLimit: { limit: 60, scope: "user", windowSeconds: 300 }, scopes: ["asyncoperations:read"] },
  { command: "contacts save", description: "Create or update a contact", method: "PUT", path: "/v1/contacts", tier: "T1", async: false, operationId: "saveDetails", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["contacts:write"] },
  { command: "contacts attrs-save", description: "Save TLD-specific attributes", method: "PUT", path: "/v1/contacts/attributes", tier: "T1", async: false, operationId: "saveContactAttributes", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["contacts:write"] },
  { command: "contacts attrs-get", description: "Show TLD-specific attributes", method: "GET", path: "/v1/contacts/attributes/{contact}", tier: "T0", async: false, operationId: "readAttributeDetails", rateLimit: { limit: 5, scope: "attribute", windowSeconds: 300 }, scopes: ["contacts:read"] },
  { command: "contacts get", description: "Show a contact", method: "GET", path: "/v1/contacts/{contact}", tier: "T0", async: false, operationId: "readDetails", rateLimit: { limit: 5, scope: "contact", windowSeconds: 300 }, scopes: ["contacts:read"] },
  { command: "dns set", description: "Add records or update TTL", method: "PUT", path: "/v1/dns/records/{domain}", tier: "T1", async: false, operationId: "saveRecords", rateLimit: { limit: 300, scope: "user + per domain", windowSeconds: 300 }, scopes: ["dnsrecords:write"] },
  { command: "dns delete", description: "Delete DNS records", method: "DELETE", path: "/v1/dns/records/{domain}", tier: "T2", async: false, operationId: "deleteRecords", rateLimit: { limit: 300, scope: "user + per domain", windowSeconds: 300 }, scopes: ["dnsrecords:write"] },
  { command: "dns list", description: "List DNS records", method: "GET", path: "/v1/dns/records/{domain}", tier: "T0", async: false, operationId: "getResourceRecordsList", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["dnsrecords:read"] },
  { command: "domains list", description: "List domains in your account", method: "GET", path: "/v1/domains", tier: "T0", async: false, operationId: "getDomainList", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["domains:read"] },
  { command: "domains check", description: "Check availability (1 or many)", method: "POST", path: "/v1/domains/available", tier: "T1", async: false, operationId: "checkDomainsAvailability", rateLimit: { limit: 30, scope: "user", windowSeconds: 30 }, scopes: ["domains:read"] },
  { command: "domains get", description: "Show one domain in detail", method: "GET", path: "/v1/domains/{domain}", tier: "T0", async: false, operationId: "getDomainInfo", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:read"] },
  { command: "domains delete", description: "Delete a domain permanently", method: "DELETE", path: "/v1/domains/{domain}", tier: "T3", async: false, operationId: "domainDelete", rateLimit: null, scopes: ["domains:write"] },
  { command: "domains register", description: "Register a domain", method: "POST", path: "/v1/domains/{domain}", tier: "T3", async: true, operationId: "domainCreate", rateLimit: { limit: 30, scope: "user", windowSeconds: 30 }, scopes: ["domains:billing"] },
  { command: "domains autorenew", description: "Turn auto-renew on or off", method: "PUT", path: "/v1/domains/{domain}/autorenew", tier: "T1", async: false, operationId: "updateAutorenewal", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:write"] },
  { command: "domains check", description: "Check availability (1 or many)", method: "GET", path: "/v1/domains/{domain}/available", tier: "T0", async: false, operationId: "checkSingleDomainAvailability", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:read"] },
  { command: "domains contacts", description: "Set the domain contacts", method: "PUT", path: "/v1/domains/{domain}/contacts", tier: "T1", async: false, operationId: "setDomainContacts", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:write"] },
  { command: "domains nameservers", description: "Set the nameservers", method: "PUT", path: "/v1/domains/{domain}/nameservers", tier: "T1", async: false, operationId: "setDomainNameservers", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:write"] },
  { command: "ns list", description: "List personal nameservers", method: "GET", path: "/v1/domains/{domain}/personal-nameservers", tier: "T0", async: false, operationId: "getDomainPersonalNameservers", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:read"] },
  { command: "ns get", description: "Show one personal nameserver", method: "GET", path: "/v1/domains/{domain}/personal-nameservers/{currentHost}", tier: "T0", async: false, operationId: "getDomainPersonalNameserverHostInfo", rateLimit: null, scopes: ["domains:read"] },
  { command: "ns set", description: "Create or update a personal nameserver", method: "PUT", path: "/v1/domains/{domain}/personal-nameservers/{currentHost}", tier: "T1", async: false, operationId: "updateDomainPersonalNameserverHostInfo", rateLimit: { limit: 10, scope: "domain", windowSeconds: 300 }, scopes: ["domains:write"] },
  { command: "ns delete", description: "Delete a personal nameserver", method: "DELETE", path: "/v1/domains/{domain}/personal-nameservers/{currentHost}", tier: "T2", async: false, operationId: "deleteDomainPersonalNameserverHostInfo", rateLimit: { limit: 10, scope: "domain", windowSeconds: 300 }, scopes: ["domains:write"] },
  { command: "domains email-protection", description: "Toggle the WHOIS contact form", method: "PUT", path: "/v1/domains/{domain}/privacy/email-protection-preference", tier: "T1", async: false, operationId: "updateDomainEmailProtectionPreference", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:write"] },
  { command: "domains privacy", description: "Set the WHOIS privacy level", method: "PUT", path: "/v1/domains/{domain}/privacy/preference", tier: "T1", async: false, operationId: "updateDomainPrivacyPreference", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:write"] },
  { command: "domains renew", description: "Renew a domain", method: "POST", path: "/v1/domains/{domain}/renew", tier: "T3", async: true, operationId: "domainRenew", rateLimit: { limit: 30, scope: "user", windowSeconds: 30 }, scopes: ["domains:billing"] },
  { command: "domains restore", description: "Restore an expired domain", method: "POST", path: "/v1/domains/{domain}/restore", tier: "T3", async: true, operationId: "domainRestore", rateLimit: { limit: 30, scope: "user", windowSeconds: 30 }, scopes: ["domains:billing"] },
  { command: "transfer start", description: "Transfer a domain in", method: "POST", path: "/v1/domains/{domain}/transfer", tier: "T3", async: true, operationId: "transferRequest", rateLimit: { limit: 30, scope: "user", windowSeconds: 30 }, scopes: ["domains:billing"] },
  { command: "transfer status", description: "Show transfer progress", method: "GET", path: "/v1/domains/{domain}/transfer", tier: "T0", async: false, operationId: "getTransferInfo", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:transfer"] },
  { command: "transfer auth-code", description: "Get the EPP auth code", method: "GET", path: "/v1/domains/{domain}/transfer/auth-code", tier: "T0", async: false, operationId: "getAuthCode", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:transfer"] },
  { command: "transfer lock", description: "Lock or unlock transfers", method: "PUT", path: "/v1/domains/{domain}/transfer/lock", tier: "T1", async: false, operationId: "updateTransferLock", rateLimit: { limit: 5, scope: "domain", windowSeconds: 300 }, scopes: ["domains:transfer"] },
  { command: "app list", description: "List Hyperlift applications", method: "GET", path: "/v1/hyperlift/applications", tier: "T0", async: false, operationId: "getHyperliftApplicationList", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["hyperlift:read"] },
  { command: "app get", description: "Show one application", method: "GET", path: "/v1/hyperlift/applications/{id}", tier: "T0", async: false, operationId: "getHyperliftApplication", rateLimit: { limit: 300, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:read"] },
  { command: "app build", description: "Trigger a build", method: "POST", path: "/v1/hyperlift/applications/{id}/build", tier: "T1", async: false, operationId: "buildHyperliftApplication", rateLimit: { limit: 10, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:execute"] },
  { command: "app build-logs", description: "Read build logs", method: "GET", path: "/v1/hyperlift/applications/{id}/build-logs", tier: "T0", async: false, operationId: "getHyperliftApplicationBuildLogs", rateLimit: { limit: 300, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:read"] },
  { command: "app env get", description: "Read environment variables", method: "GET", path: "/v1/hyperlift/applications/{id}/environment", tier: "T0", async: false, operationId: "getHyperliftApplicationEnvironment", rateLimit: { limit: 300, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:manage"] },
  { command: "app env set", description: "Update environment variables", method: "PUT", path: "/v1/hyperlift/applications/{id}/environment", tier: "T1", async: false, operationId: "updateHyperliftApplicationEnvironment", rateLimit: { limit: 60, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:manage"] },
  { command: "app logs", description: "Read runtime logs", method: "GET", path: "/v1/hyperlift/applications/{id}/logs", tier: "T0", async: false, operationId: "getHyperliftApplicationLogs", rateLimit: { limit: 300, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:read"] },
  { command: "app metrics", description: "Show resource metrics", method: "GET", path: "/v1/hyperlift/applications/{id}/metrics", tier: "T0", async: false, operationId: "getHyperliftApplicationMetrics", rateLimit: { limit: 120, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:read"] },
  { command: "app restart", description: "Restart the application", method: "POST", path: "/v1/hyperlift/applications/{id}/restart", tier: "T1", async: false, operationId: "restartHyperliftApplication", rateLimit: { limit: 10, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:execute"] },
  { command: "app scale", description: "Scale the application (0 stops, 1 runs)", method: "PUT", path: "/v1/hyperlift/applications/{id}/scale", tier: "T1", async: false, operationId: "scaleHyperliftApplication", rateLimit: { limit: 10, scope: "application", windowSeconds: 300 }, scopes: ["hyperlift:execute"] },
  { command: "market checkout-link", description: "Create a Buy Now checkout link", method: "POST", path: "/v1/sellerhub/checkout-links", tier: "T3", async: false, operationId: "createCheckoutLink", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:write"] },
  { command: "market list", description: "List your marketplace listings", method: "GET", path: "/v1/sellerhub/domains", tier: "T0", async: false, operationId: "getSellerHubDomainList", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:read"] },
  { command: "market add", description: "List a domain for sale", method: "POST", path: "/v1/sellerhub/domains", tier: "T3", async: false, operationId: "createSellerHubDomain", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:write"] },
  { command: "market sold", description: "Show sold domains and payouts", method: "GET", path: "/v1/sellerhub/domains/reports/sold", tier: "T0", async: false, operationId: "getSoldDomains", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:read"] },
  { command: "market get", description: "Show one listing", method: "GET", path: "/v1/sellerhub/domains/{domain}", tier: "T0", async: false, operationId: "getSellerHubDomain", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:read"] },
  { command: "market update", description: "Update a listing", method: "PATCH", path: "/v1/sellerhub/domains/{domain}", tier: "T3", async: false, operationId: "updateSellerHubDomain", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:write"] },
  { command: "market remove", description: "Remove a listing", method: "DELETE", path: "/v1/sellerhub/domains/{domain}", tier: "T3", async: false, operationId: "deleteSellerHubDomain", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:write"] },
  { command: "market safepay list", description: "List SafePay transactions", method: "GET", path: "/v1/sellerhub/safepay-transactions", tier: "T0", async: false, operationId: "getSafePayTransactionList", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:read"] },
  { command: "market safepay create", description: "Create a SafePay transaction", method: "POST", path: "/v1/sellerhub/safepay-transactions", tier: "T3", async: false, operationId: "createSafePayTransaction", rateLimit: { limit: 300, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:write"] },
  { command: "market safepay get", description: "Show a SafePay transaction", method: "GET", path: "/v1/sellerhub/safepay-transactions/{transactionId}", tier: "T0", async: false, operationId: "getSafePayTransaction", rateLimit: { limit: 60, scope: "user", windowSeconds: 300 }, scopes: ["sellerhub:read"] },
  { command: "market verify-records", description: "Get ownership verification records", method: "GET", path: "/v1/sellerhub/verification-records", tier: "T0", async: false, operationId: "getVerificationRecords", rateLimit: { limit: 10, scope: "user", windowSeconds: 60 }, scopes: ["sellerhub:read"] },
] as const;

export const byCommand = (name: string): Operation[] =>
  OPERATIONS.filter((op) => op.command === name);

export const byTier = (tier: Tier): Operation[] =>
  OPERATIONS.filter((op) => op.tier === tier);

/** Distinct command names, in the order a user meets them. */
export const commandNames = (): string[] => [...new Set(OPERATIONS.map((op) => op.command))];
