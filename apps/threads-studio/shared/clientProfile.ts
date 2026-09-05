import { z } from "zod";

export const profileStatusSchema = z.enum(["verified", "inferred", "missing", "user_edited"]);
export type ProfileStatus = z.infer<typeof profileStatusSchema>;

const sourceSchema = z.object({
  url: z.string().url().max(512),
  pageTitle: z.string().max(160),
  excerpt: z.string().max(240),
});

const fieldSchema = z.object({
  value: z.union([z.string().max(2_000), z.array(z.string().max(160)).max(30)]).nullable(),
  status: profileStatusSchema,
  confidence: z.number().min(0).max(1),
  sources: z.array(sourceSchema).max(8),
  conflict: z.string().max(500).nullable(),
});

export const PROFILE_FIELD_KEYS = [
  "clientName", "brandName", "industry", "industryDetail", "productsServices",
  "strengths", "achievements", "targetCustomers", "customerProblems", "useCases",
  "regions", "languages", "priceRange", "marketingGoals", "conversionPaths",
  "brandTone", "commonWords", "avoidExpressions", "postThemes", "regionKeywords",
  "industryKeywords", "problemKeywords", "productKeywords", "seasonalKeywords", "referenceAccounts",
] as const;

export type ProfileFieldKey = typeof PROFILE_FIELD_KEYS[number];

const profileShape = Object.fromEntries(PROFILE_FIELD_KEYS.map((key) => [key, fieldSchema])) as {
  [K in ProfileFieldKey]: typeof fieldSchema;
};

export const clientProfileSchema = z.object(profileShape).strict();
export type ClientProfile = z.infer<typeof clientProfileSchema>;

export const keywordCategorySchema = z.enum([
  "industry", "product", "customer_problem", "region", "use_case", "season",
  "news", "comparison", "faq", "purchase_intent",
]);

export const keywordCandidateSchema = z.object({
  keyword: z.string().trim().min(1).max(60),
  category: keywordCategorySchema,
  reason: z.string().min(1).max(300),
  targetCustomer: z.string().max(160).nullable(),
  region: z.string().max(80).nullable(),
  priority: z.number().int().min(1).max(5),
  enabled: z.boolean(),
  sources: z.array(z.string().url().max(512)).max(8),
});

export const profileExtractionSchema = z.object({
  profile: clientProfileSchema,
  keywords: z.array(keywordCandidateSchema).min(1).max(40),
  warnings: z.array(z.string().max(300)).max(20),
}).strict();

export type ProfileExtraction = z.infer<typeof profileExtractionSchema>;

export type ProfileDiff = {
  key: ProfileFieldKey;
  before: ClientProfile[ProfileFieldKey] | null;
  after: ClientProfile[ProfileFieldKey];
  protected: boolean;
};

export function diffProfiles(current: ClientProfile | null, candidate: ClientProfile): ProfileDiff[] {
  return PROFILE_FIELD_KEYS.flatMap((key) => {
    const before = current?.[key] ?? null;
    const after = candidate[key];
    if (before && JSON.stringify(before.value) === JSON.stringify(after.value)) return [];
    return [{ key, before, after, protected: before?.status === "user_edited" }];
  });
}

/** AI再読み込みでも、利用者が修正した項目は候補に置き換えない。 */
export function protectUserEdits(current: ClientProfile | null, candidate: ClientProfile): ClientProfile {
  if (!current) return candidate;
  const output = { ...candidate };
  for (const key of PROFILE_FIELD_KEYS) {
    if (current[key].status === "user_edited") output[key] = current[key];
  }
  return output;
}

export function emptyProfile(): ClientProfile {
  const entries: Partial<Record<ProfileFieldKey, ClientProfile[ProfileFieldKey]>> = {};
  for (const key of PROFILE_FIELD_KEYS) {
    entries[key] = { value: null, status: "missing", confidence: 0, sources: [], conflict: null };
  }
  return clientProfileSchema.parse(entries);
}
