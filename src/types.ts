/** Response shapes, transcribed from the official OpenAPI document. */

export type Paged<T> = { items: T[]; total: number };

export type LifecycleStatus = "creating" | "registered" | "grace1" | "grace2" | "redemption";
export type VerificationStatus = "verification" | "success" | "failed";
export type TransferStatus = "pending" | "completed" | "cancelled";
export type AvailabilityStatus =
  | "available"
  | "taken"
  | "invalidDomainName"
  | "tldNotSupported"
  | "unexpectedError";
export type AsyncStatus = "pending" | "failed" | "success";

/** Only client-side EPP statuses are exposed; clientTransferProhibited is the lock. */
export type EppStatus =
  | "clientDeleteProhibited"
  | "clientHold"
  | "clientRenewProhibited"
  | "clientTransferProhibited"
  | "clientUpdateProhibited";

export type DomainInfo = {
  name: string;
  unicodeName: string;
  isPremium: boolean;
  autoRenew: boolean;
  registrationDate: string;
  expirationDate: string;
  lifecycleStatus: LifecycleStatus;
  verificationStatus: VerificationStatus;
  eppStatuses: EppStatus[];
  suspensions: { type?: string; startedAt?: string }[];
  privacyProtection: { level: string; contactForm: boolean };
  nameservers: { provider?: string; hosts: string[] };
  contacts: { registrant: string; admin?: string; tech?: string; billing?: string };
};

export type DnsRecord = {
  type: string;
  name: string;
  ttl?: number;
  /** custom records are yours; product and personalNs are managed by Spaceship */
  group: "custom" | "product" | "personalNs";
  address?: string;
  cname?: string;
  exchange?: string;
  preference?: number;
  value?: string;
  target?: string;
  port?: number;
  priority?: number;
  weight?: number;
  flags?: number;
  tag?: string;
};

export type TransferInfo = {
  startedAt: string;
  finishedAt?: string;
  direction: "in";
  status: TransferStatus;
};

export type AuthCode = { authCode: string };

export type PriceDetail = { operation: string; price: number; currency: string };

export type AvailabilityResult = {
  domain: string;
  result: AvailabilityStatus;
  premiumPricing: PriceDetail[];
};

export type AsyncOperation = {
  status: AsyncStatus;
  type: string;
  details?: unknown;
  createdAt: string;
  modifiedAt: string;
};

export type Contact = Record<string, unknown> & { contactId?: string };

export type PersonalNameserver = { host: string; ips: string[] };

export type SellerHubDomain = {
  name: string;
  unicodeName: string;
  displayName?: string;
  description?: string;
  status: string;
  minPrice?: number;
  binPrice?: number;
  binPriceEnabled?: boolean;
  minPriceEnabled?: boolean;
};

export type SoldDomain = {
  name: string;
  unicodeName: string;
  displayName?: string;
  saleDateTime: string;
  salePrice: number;
  payout: number;
  source: string;
};

export type SafePayTransaction = {
  transactionId: string;
  status: string;
  saleStatus?: string;
  domainName: string;
  basePrice: number;
  type: string;
  buyerEmail?: string;
  sellerEmail?: string;
};

export type VerificationRecord = Record<string, unknown>;

export type HyperliftApp = {
  id: string;
  name?: string;
  status?: string;
  buildStatus?: string;
  /** null while the desired scale is not yet known */
  scale?: number | null;
  domain?: string;
  repository?: string;
};

export type HyperliftMetrics = Record<string, unknown>;
export type HyperliftLogs = { items?: { message?: string; timestamp?: string }[] } & Record<string, unknown>;
