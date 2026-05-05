// ─────────────────────────────────────────────────────────────
// types/test-case.ts — Test case structure types
// ─────────────────────────────────────────────────────────────

export type TestCategory = "positive" | "negative" | "edge";
export type TestStatus = "draft" | "pending_review" | "approved" | "rejected";

export interface TestStep {
  stepNumber: number;
  action: string;
  expectedResult: string;
  /** DOM selector, API assertion, or DB query to verify this step */
  verification: string;
}

export interface BackendVerification {
  /** Prisma query or API call to run */
  query: string;
  /** What the result should look like */
  expectedResult: string;
}

export interface TestCase {
  id: string;
  /** Reference to the user story that generated this test */
  userStoryRef: string;
  projectId: string;
  category: TestCategory;
  title: string;
  /** Conditions that must be true before the test runs */
  preconditions: string[];
  steps: TestStep[];
  backendVerification: BackendVerification[];
  /** Notes from logic inversion / mutation analysis */
  mutationNote?: string;
  status: TestStatus;
  humanFeedback?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestSuite {
  projectId: string;
  userStory: string;
  generatedAt: string;
  testCases: TestCase[];
  /** Summary of gaps found during this run */
  gapSummary: string;
}
