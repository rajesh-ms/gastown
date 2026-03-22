/**
 * Optum RCM Real MVP — Production Workflow Templates
 *
 * These 4 templates are the minimum deployable set for an Optum-scale RCM
 * operation. Each template uses only patterns already supported by the
 * orchestration engine: sequential, condition, fan-out/fan-in, approval,
 * and the pause/resume state machine.
 *
 * Shape matches OrchestrationTemplate from src/lib/types and the
 * POST /api/orchestration/templates endpoint.
 *
 * Usage:
 *   Import and POST each template to the templates API on first deployment,
 *   or use `cosmos-seed.ts` to load them directly into the templates container.
 */

import type { OrchestrationTemplate } from "../../../apps/web/src/lib/types.js";

// ─── Shared constants ───────────────────────────────────────────────────────

const TENANT = "optum-rcm-prod";
const now = new Date().toISOString();

// ─── 1. Eligibility Verification ────────────────────────────────────────────

export const eligibilityVerification: Omit<OrchestrationTemplate, "id"> = {
  name: "Eligibility Verification",
  description:
    "Real-time patient eligibility check via 270/271 transaction with AI-generated benefit summary and exception routing.",
  category: "RCM",
  version: "1.0.0",
  tags: ["eligibility", "270/271", "patient-access", "payer", "production"],
  visibility: "shared",
  tenantId: TENANT,
  usageCount: 0,
  defaultPolicyIds: ["policy-phi-safe", "policy-rate-limit"],
  parameters: [
    { name: "patientId", type: "string", required: true, description: "Patient MRN or internal ID" },
    { name: "memberId", type: "string", required: true, description: "Payer member ID" },
    { name: "payerId", type: "string", required: true, description: "Payer identifier (e.g. BCBS, AETNA)" },
    { name: "dateOfService", type: "string", required: true, description: "Planned date of service (ISO 8601)" },
    { name: "providerNpi", type: "string", required: true, description: "Rendering provider NPI" },
  ],
  nodes: [
    {
      id: "ev-start",
      type: "start",
      position: { x: 60, y: 240 },
      data: {
        label: "Eligibility Request",
        description: "Patient and payer data received",
        config: { triggerType: "http" },
      },
    },
    {
      id: "ev-elig-agent",
      type: "agent",
      position: { x: 280, y: 240 },
      data: {
        label: "Eligibility Agent",
        description: "Calls payer 270/271 gateway and generates benefit summary",
        config: {
          agentId: "eligibility-verifier",
          systemPrompt:
            "You are an eligibility verification agent. Call the payer eligibility tool, then produce a plain-English benefit summary including copay, deductible status, and coverage flags.",
          tools: ["verify_eligibility", "lookup_payer_rules"],
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "ev-condition",
      type: "condition",
      position: { x: 520, y: 240 },
      data: {
        label: "Active Coverage?",
        description: "Route based on eligibility status",
        config: {
          conditionExpression: "output.status === 'active'",
          trueBranchLabel: "Active",
          falseBranchLabel: "Exception",
        },
      },
    },
    {
      id: "ev-end-active",
      type: "end",
      position: { x: 760, y: 140 },
      data: {
        label: "Verified",
        description: "Patient eligible — proceed to scheduling",
        config: { successMessage: "Eligibility verified successfully." },
      },
    },
    {
      id: "ev-exception",
      type: "agent",
      position: { x: 760, y: 340 },
      data: {
        label: "Exception Handler",
        description: "Routes inactive or partial coverage to manual review queue",
        config: {
          agentId: "eligibility-exception",
          systemPrompt:
            "Create a work queue item for the patient access team with the eligibility exception details and recommended next steps.",
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "ev-end-exception",
      type: "end",
      position: { x: 980, y: 340 },
      data: {
        label: "Queued for Review",
        description: "Exception routed to patient access team",
        config: { successMessage: "Eligibility exception queued for manual review." },
      },
    },
  ],
  edges: [
    { id: "eve1", source: "ev-start", target: "ev-elig-agent" },
    { id: "eve2", source: "ev-elig-agent", target: "ev-condition" },
    { id: "eve3", source: "ev-condition", target: "ev-end-active", label: "Active", data: { edgeType: "true" } },
    { id: "eve4", source: "ev-condition", target: "ev-exception", label: "Exception", data: { edgeType: "false" } },
    { id: "eve5", source: "ev-exception", target: "ev-end-exception" },
  ],
  createdAt: now,
  updatedAt: now,
};

// ─── 2. Prior Authorization ─────────────────────────────────────────────────

export const priorAuthorization: Omit<OrchestrationTemplate, "id"> = {
  name: "Prior Authorization",
  description:
    "End-to-end prior auth: clinical evidence gathering, UM review approval gate, payer portal submission, and long-running pause/resume for payer decision.",
  category: "RCM",
  version: "1.0.0",
  tags: ["prior-auth", "utilization-management", "approval", "pause-resume", "production"],
  visibility: "shared",
  tenantId: TENANT,
  usageCount: 0,
  defaultPolicyIds: ["policy-phi-safe", "policy-human-gate", "policy-compliance"],
  parameters: [
    { name: "patientId", type: "string", required: true, description: "Patient identifier" },
    { name: "procedureCode", type: "string", required: true, description: "CPT code for the requested procedure" },
    { name: "diagnosisCode", type: "string", required: true, description: "Primary ICD-10 diagnosis code" },
    { name: "payerId", type: "string", required: true, description: "Payer identifier" },
    { name: "orderingProviderNpi", type: "string", required: true, description: "Ordering provider NPI" },
  ],
  nodes: [
    {
      id: "pa-start",
      type: "start",
      position: { x: 40, y: 260 },
      data: { label: "Auth Request", description: "Order received from EHR", config: { triggerType: "http" } },
    },
    {
      id: "pa-clinical-agent",
      type: "agent",
      position: { x: 240, y: 260 },
      data: {
        label: "Clinical Doc Agent",
        description: "Retrieves clinical context and builds evidence package",
        config: {
          agentId: "clinical-documentation",
          systemPrompt:
            "Retrieve patient clinical history, imaging rationale, and diagnosis support from the EHR. Compile a clinical justification package for the requested procedure.",
          tools: ["get_patient_record", "get_clinical_notes", "get_imaging_history"],
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "pa-approval",
      type: "approval",
      position: { x: 480, y: 260 },
      data: {
        label: "UM Review",
        description: "Utilization reviewer validates clinical justification",
        config: {
          approvalMessage: "Review the clinical evidence package before payer submission.",
          approverRole: "utilization-reviewer",
          timeoutMinutes: 480,
          onReject: "abort",
        },
      },
    },
    {
      id: "pa-submit-agent",
      type: "agent",
      position: { x: 720, y: 260 },
      data: {
        label: "Prior Auth Agent",
        description: "Formats and submits auth request to payer portal",
        config: {
          agentId: "prior-auth-submitter",
          systemPrompt:
            "Format the clinical evidence into the payer-specific prior authorization format and submit via the payer auth portal tool.",
          tools: ["submit_prior_auth", "get_payer_auth_requirements"],
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "pa-wait",
      type: "approval",
      position: { x: 960, y: 260 },
      data: {
        label: "Await Payer Decision",
        description: "Paused — zero compute — until payer responds via webhook or manual entry",
        config: {
          approvalMessage: "Waiting for payer determination. Resume when decision is received.",
          approverRole: "system-or-manual",
          timeoutMinutes: 43200, // 30 days
          onReject: "abort",
        },
      },
    },
    {
      id: "pa-condition",
      type: "condition",
      position: { x: 1200, y: 260 },
      data: {
        label: "Auth Decision",
        description: "Route based on payer determination",
        config: {
          conditionExpression: "output.determination === 'approved'",
          trueBranchLabel: "Approved",
          falseBranchLabel: "Denied / Pended",
        },
      },
    },
    {
      id: "pa-end-approved",
      type: "end",
      position: { x: 1440, y: 160 },
      data: {
        label: "Authorized",
        description: "Auth number obtained — proceed with scheduling",
        config: { successMessage: "Prior authorization approved." },
      },
    },
    {
      id: "pa-denied-agent",
      type: "agent",
      position: { x: 1440, y: 360 },
      data: {
        label: "Denial Triage Agent",
        description: "Analyzes denial reason and drafts appeal or routes for additional documentation",
        config: {
          agentId: "denial-triage",
          systemPrompt:
            "Analyze the payer denial reason, determine if an appeal is warranted, and draft an appeal letter or request for additional clinical documentation.",
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "pa-end-denied",
      type: "end",
      position: { x: 1680, y: 360 },
      data: {
        label: "Denial Handled",
        description: "Appeal drafted or case closed",
        config: { successMessage: "Denial triage complete." },
      },
    },
  ],
  edges: [
    { id: "pae1", source: "pa-start", target: "pa-clinical-agent" },
    { id: "pae2", source: "pa-clinical-agent", target: "pa-approval" },
    { id: "pae3", source: "pa-approval", target: "pa-submit-agent", label: "approved" },
    { id: "pae4", source: "pa-submit-agent", target: "pa-wait" },
    { id: "pae5", source: "pa-wait", target: "pa-condition", label: "resumed" },
    { id: "pae6", source: "pa-condition", target: "pa-end-approved", label: "Approved", data: { edgeType: "true" } },
    { id: "pae7", source: "pa-condition", target: "pa-denied-agent", label: "Denied", data: { edgeType: "false" } },
    { id: "pae8", source: "pa-denied-agent", target: "pa-end-denied" },
  ],
  createdAt: now,
  updatedAt: now,
};

// ─── 3. Claims Submission ───────────────────────────────────────────────────

export const claimsSubmission: Omit<OrchestrationTemplate, "id"> = {
  name: "Claims Submission",
  description:
    "End-to-end claim lifecycle: eligibility sub-check, parallel coding + scrubbing, conditional routing for clean vs exception claims, billing review approval, and clearinghouse submission.",
  category: "RCM",
  version: "1.0.0",
  tags: ["claims", "coding", "scrub", "clearinghouse", "approval", "production"],
  visibility: "shared",
  tenantId: TENANT,
  usageCount: 0,
  defaultPolicyIds: ["policy-phi-safe", "policy-rate-limit", "policy-compliance"],
  parameters: [
    { name: "encounterId", type: "string", required: true, description: "Encounter or visit ID" },
    { name: "patientId", type: "string", required: true, description: "Patient identifier" },
    { name: "payerId", type: "string", required: true, description: "Primary payer ID" },
    { name: "providerNpi", type: "string", required: true, description: "Rendering provider NPI" },
  ],
  nodes: [
    {
      id: "cs-start",
      type: "start",
      position: { x: 40, y: 260 },
      data: { label: "Charge Event", description: "Encounter finalized in EHR", config: { triggerType: "http" } },
    },
    {
      id: "cs-elig-tool",
      type: "tool",
      position: { x: 240, y: 260 },
      data: {
        label: "Eligibility Sub-Check",
        description: "Quick 270/271 verification before claim build",
        config: { toolId: "verify_eligibility", serverId: "ehr-gateway" },
      },
    },
    {
      id: "cs-fanout",
      type: "fan-out",
      position: { x: 440, y: 240 },
      data: {
        label: "Parallel Analysis",
        description: "Coding and scrubbing run concurrently",
        config: { branches: 2, fanOutStrategy: "parallel" },
      },
    },
    {
      id: "cs-coding-agent",
      type: "agent",
      position: { x: 660, y: 140 },
      data: {
        label: "Coding Agent",
        description: "Auto-codes encounter: ICD-10, CPT, modifiers",
        config: {
          agentId: "medical-coder",
          systemPrompt:
            "Analyze the encounter documentation and produce ICD-10, CPT, and modifier codes with confidence scores. Flag any codes that need coder review.",
          tools: ["lookup_icd10", "lookup_cpt", "check_ncci_edits"],
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "cs-scrub-agent",
      type: "agent",
      position: { x: 660, y: 360 },
      data: {
        label: "Scrubber Agent",
        description: "Claim quality check: NCCI, LCD/NCD, payer-specific rules",
        config: {
          agentId: "claim-scrubber",
          systemPrompt:
            "Scrub the coded claim against NCCI edits, LCD/NCD policies, and payer-specific billing rules. Return clean/dirty status with specific edit failures.",
          tools: ["check_ncci_edits", "check_lcd_ncd", "get_payer_rules"],
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "cs-fanin",
      type: "fan-in",
      position: { x: 880, y: 240 },
      data: {
        label: "Merge Results",
        description: "Combine coding and scrub outputs",
        config: { joinStrategy: "all", joinTimeout: 120 },
      },
    },
    {
      id: "cs-condition",
      type: "condition",
      position: { x: 1080, y: 240 },
      data: {
        label: "Clean Claim?",
        description: "Route based on scrub result",
        config: {
          conditionExpression: "output.coded && output.clean",
          trueBranchLabel: "Submit",
          falseBranchLabel: "Review",
        },
      },
    },
    {
      id: "cs-submit-agent",
      type: "agent",
      position: { x: 1300, y: 140 },
      data: {
        label: "Submit Agent",
        description: "Submits clean claim to clearinghouse",
        config: {
          agentId: "claim-submitter",
          tools: ["submit_837p"],
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "cs-approval",
      type: "approval",
      position: { x: 1300, y: 360 },
      data: {
        label: "Billing Review",
        description: "Manual review for claims with scrub failures",
        config: {
          approvalMessage: "Review claim edits and correct before resubmission.",
          approverRole: "billing-reviewer",
          timeoutMinutes: 480,
          onReject: "abort",
        },
      },
    },
    {
      id: "cs-end",
      type: "end",
      position: { x: 1540, y: 240 },
      data: {
        label: "Claim Submitted",
        description: "Tracking active at clearinghouse",
        config: { successMessage: "Claim submitted to clearinghouse." },
      },
    },
  ],
  edges: [
    { id: "cse1", source: "cs-start", target: "cs-elig-tool" },
    { id: "cse2", source: "cs-elig-tool", target: "cs-fanout" },
    { id: "cse3", source: "cs-fanout", target: "cs-coding-agent", label: "B1", data: { edgeType: "fan" } },
    { id: "cse4", source: "cs-fanout", target: "cs-scrub-agent", label: "B2", data: { edgeType: "fan" } },
    { id: "cse5", source: "cs-coding-agent", target: "cs-fanin", data: { edgeType: "fan" } },
    { id: "cse6", source: "cs-scrub-agent", target: "cs-fanin", data: { edgeType: "fan" } },
    { id: "cse7", source: "cs-fanin", target: "cs-condition" },
    { id: "cse8", source: "cs-condition", target: "cs-submit-agent", label: "Submit", data: { edgeType: "true" } },
    { id: "cse9", source: "cs-condition", target: "cs-approval", label: "Review", data: { edgeType: "false" } },
    { id: "cse10", source: "cs-approval", target: "cs-submit-agent", label: "approved" },
    { id: "cse11", source: "cs-submit-agent", target: "cs-end" },
  ],
  createdAt: now,
  updatedAt: now,
};

// ─── 4. Payment Posting & Reconciliation ────────────────────────────────────

export const paymentReconciliation: Omit<OrchestrationTemplate, "id"> = {
  name: "Payment Posting & Reconciliation",
  description:
    "Batch ERA/835 processing: split by claim line, parallel payment analysis, underpayment detection, auto-post standard payments, and route exceptions to finance review.",
  category: "RCM",
  version: "1.0.0",
  tags: ["payment", "posting", "ERA", "835", "reconciliation", "underpayment", "production"],
  visibility: "shared",
  tenantId: TENANT,
  usageCount: 0,
  defaultPolicyIds: ["policy-phi-safe", "policy-rate-limit"],
  parameters: [
    { name: "eraFileId", type: "string", required: true, description: "ERA/835 file identifier" },
    { name: "batchId", type: "string", required: false, description: "Optional batch grouping ID" },
  ],
  nodes: [
    {
      id: "pp-start",
      type: "start",
      position: { x: 40, y: 260 },
      data: { label: "ERA Batch Received", description: "835 file ingested", config: { triggerType: "event" } },
    },
    {
      id: "pp-parse-tool",
      type: "tool",
      position: { x: 240, y: 260 },
      data: {
        label: "ERA Parser",
        description: "Parses 835 EDI into structured claim-line records",
        config: { toolId: "parse_era_835", serverId: "era-gateway" },
      },
    },
    {
      id: "pp-fanout",
      type: "fan-out",
      position: { x: 440, y: 240 },
      data: {
        label: "Split by Claim",
        description: "Process each claim line in parallel",
        config: { branches: 10, fanOutStrategy: "parallel" },
      },
    },
    {
      id: "pp-payment-agent",
      type: "agent",
      position: { x: 660, y: 140 },
      data: {
        label: "Payment Agent",
        description: "Compares paid amount to expected reimbursement from fee schedule",
        config: {
          agentId: "payment-analyzer",
          systemPrompt:
            "Compare the ERA payment amount to the expected reimbursement from the fee schedule. Flag underpayments, overpayments, and denied lines. Return a structured variance report.",
          tools: ["lookup_fee_schedule", "get_claim_expected_payment"],
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "pp-variance-agent",
      type: "agent",
      position: { x: 660, y: 380 },
      data: {
        label: "Variance Analyzer",
        description: "Identifies adjustment codes and categorizes payment discrepancies",
        config: {
          agentId: "variance-analyzer",
          systemPrompt:
            "Analyze adjustment reason codes (CAS segments) and remark codes. Categorize each variance as contractual, non-contractual, patient responsibility, or error.",
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "pp-fanin",
      type: "fan-in",
      position: { x: 880, y: 260 },
      data: {
        label: "Aggregate Results",
        description: "Merge payment and variance analysis",
        config: { joinStrategy: "all", joinTimeout: 300 },
      },
    },
    {
      id: "pp-condition",
      type: "condition",
      position: { x: 1080, y: 260 },
      data: {
        label: "Standard Payment?",
        description: "Route based on variance threshold",
        config: {
          conditionExpression: "output.variancePercent <= 2",
          trueBranchLabel: "Auto-Post",
          falseBranchLabel: "Finance Review",
        },
      },
    },
    {
      id: "pp-autopost-tool",
      type: "tool",
      position: { x: 1300, y: 160 },
      data: {
        label: "Auto-Post",
        description: "Posts standard payments to billing system",
        config: { toolId: "post_payment", serverId: "billing-system" },
      },
    },
    {
      id: "pp-finance-exception",
      type: "agent",
      position: { x: 1300, y: 380 },
      data: {
        label: "Finance Exception",
        description: "Routes underpayment or error cases to finance review queue",
        config: {
          agentId: "finance-exception-router",
          systemPrompt:
            "Create a finance work queue item with the variance details, recommended action (appeal, adjustment, write-off), and supporting documentation.",
          modelId: "gpt-4o",
        },
      },
    },
    {
      id: "pp-end",
      type: "end",
      position: { x: 1540, y: 260 },
      data: {
        label: "Batch Reconciled",
        description: "All claim lines processed",
        config: { successMessage: "ERA batch reconciliation complete." },
      },
    },
  ],
  edges: [
    { id: "ppe1", source: "pp-start", target: "pp-parse-tool" },
    { id: "ppe2", source: "pp-parse-tool", target: "pp-fanout" },
    { id: "ppe3", source: "pp-fanout", target: "pp-payment-agent", label: "B1", data: { edgeType: "fan" } },
    { id: "ppe4", source: "pp-fanout", target: "pp-variance-agent", label: "B2", data: { edgeType: "fan" } },
    { id: "ppe5", source: "pp-payment-agent", target: "pp-fanin", data: { edgeType: "fan" } },
    { id: "ppe6", source: "pp-variance-agent", target: "pp-fanin", data: { edgeType: "fan" } },
    { id: "ppe7", source: "pp-fanin", target: "pp-condition" },
    { id: "ppe8", source: "pp-condition", target: "pp-autopost-tool", label: "Auto-Post", data: { edgeType: "true" } },
    { id: "ppe9", source: "pp-condition", target: "pp-finance-exception", label: "Finance Review", data: { edgeType: "false" } },
    { id: "ppe10", source: "pp-autopost-tool", target: "pp-end" },
    { id: "ppe11", source: "pp-finance-exception", target: "pp-end" },
  ],
  createdAt: now,
  updatedAt: now,
};

// ─── Export all templates ───────────────────────────────────────────────────

export const OPTUM_RCM_TEMPLATES = [
  eligibilityVerification,
  priorAuthorization,
  claimsSubmission,
  paymentReconciliation,
];
