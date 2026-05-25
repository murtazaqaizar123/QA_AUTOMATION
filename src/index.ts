// ─────────────────────────────────────────────────────────────
// src/index.ts — CLI entry point
// ─────────────────────────────────────────────────────────────
import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import * as readline from "readline";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import { listProjects, getProject, upsertProject, removeProject } from "./projects/registry.js";
import { validateProjectConfig } from "./projects/project-config.js";
import { buildWorkflow } from "./graph/workflow.js";
import { ensureCollections } from "./memory/qdrant-client.js";
import { seedBuiltInRules } from "./memory/procedural-store.js";
import { logger } from "./utils/logger.js";
import { TestCase, TestSuite } from "./types/test-case.js";
import type { ProjectConfig } from "./types/project.js";

const program = new Command();

program
  .name("qa-factory")
  .description("Universal Agentic QA Factory — multi-project test case generation")
  .version("1.0.0");

// ── projects list ──────────────────────────────────────────────

program
  .command("projects")
  .description("Manage registered projects")
  .addCommand(
    new Command("list").description("List all registered projects").action(() => {
      const projects = listProjects();
      if (projects.length === 0) {
        console.log(chalk.yellow("No projects registered. Use: qa-factory projects add"));
        return;
      }
      console.log(chalk.bold("\nRegistered Projects:\n"));
      for (const p of projects) {
        console.log(`  ${chalk.cyan(p.projectId.padEnd(20))} ${chalk.white(p.projectName)}`);
        console.log(`    Codebase: ${chalk.gray(p.codebasePath)}`);
        console.log(`    PRD:      ${chalk.gray(p.prdPath)}\n`);
      }
    })
  )
  .addCommand(
    new Command("add")
      .description("Register a new project")
      .requiredOption("--id <id>", "Unique project slug (e.g. build-nest)")
      .requiredOption("--name <name>", "Display name")
      .requiredOption("--path <path>", "Path to codebase root")
      .requiredOption("--prd <prd>", "Path to PRD markdown file")
      .option("--framework <framework>", "Framework type", "nextjs-app")
      .option("--prisma <prisma>", "Path to schema.prisma (if non-standard)")
      .action((opts) => {
        const project: ProjectConfig = {
          projectId: opts.id,
          projectName: opts.name,
          codebasePath: opts.path,
          prdPath: opts.prd,
          framework: opts.framework,
          prismaSchemaPath: opts.prisma,
        };
        upsertProject(project);
        console.log(chalk.green(`✓ Project "${opts.id}" registered successfully`));
      })
  )
  .addCommand(
    new Command("remove")
      .description("Remove a project from the registry")
      .argument("<id>", "Project ID to remove")
      .action((id: string) => {
        const removed = removeProject(id);
        if (removed) {
          console.log(chalk.green(`✓ Project "${id}" removed`));
        } else {
          console.log(chalk.red(`✗ Project "${id}" not found`));
        }
      })
  );

// ── run ───────────────────────────────────────────────────────

program
  .command("run")
  .description("Run a QA cycle for a registered project")
  .requiredOption("--project <id>", "Project ID to run against")
  .requiredOption(
    "--story <story>",
    'User story (e.g. "As a Builder, I want to create a Draw Request")'
  )
  .option("--output <dir>", "Output directory for test case files", "./output")
  .option("--skip-hitl", "Skip human review and auto-approve test cases")
  .option("--mode <mode>", "Pipeline mode (full | prd-only)", "full")
  .action(async (opts) => {
    console.log(chalk.bold.cyan("\n🏭  QA Factory — Starting Pipeline\n"));

    const mode: "full" | "prd-only" = opts.mode === "prd-only" ? "prd-only" : "full";
    if (opts.mode && opts.mode !== "full" && opts.mode !== "prd-only") {
      console.error(chalk.red(`✗ Invalid mode "${opts.mode}". Valid modes: full, prd-only`));
      process.exit(1);
    }

    // 1. Load project
    const project = getProject(opts.project);
    if (!project) {
      console.error(chalk.red(`✗ Project "${opts.project}" not found. Run: qa-factory projects list`));
      process.exit(1);
    }

    // 2. Validate paths
    const validationErrors = validateProjectConfig(project, mode);
    if (validationErrors.length > 0) {
      console.error(chalk.red("✗ Project config errors:"));
      validationErrors.forEach((e) => console.error(chalk.red(`  - ${e}`)));
      process.exit(1);
    }

    // 3. Resolve story (could be raw string or file path)
    let finalStory = opts.story;
    const storyPath = path.resolve(opts.story);
    if (fs.existsSync(storyPath) && fs.statSync(storyPath).isFile()) {
      finalStory = fs.readFileSync(storyPath, "utf-8");
      console.log(`User Story: ${chalk.white(`Loaded from ${opts.story}`)}\n`);
    } else {
      console.log(`User Story: ${chalk.white(opts.story.substring(0, 80))}...\n`);
    }

    // 4. Bootstrap Qdrant
    try {
      await ensureCollections();
      await seedBuiltInRules();
    } catch (err) {
      console.error(chalk.red("✗ Qdrant connection failed. Is Docker running?"));
      console.error(chalk.gray((err as Error).message));
      process.exit(1);
    }

    // 4. Build workflow
    const workflow = buildWorkflow();
    const threadId = uuidv4();
    const runConfig = { configurable: { thread_id: threadId } };

    const initialState = {
      projectConfig: {
        ...project,
        outputPath: opts.output,
      },
      userStory: finalStory,
      pipelineMode: mode,
    };

    // 6. Run pipeline until HITL interrupt
    console.log(chalk.gray("▶ Running pipeline...\n"));
    let interrupted = false;
    let currentState: typeof initialState | null = null;

    for await (const event of await workflow.stream(initialState, runConfig)) {
      const [nodeName, nodeOutput] = Object.entries(event)[0] as [string, unknown];

      if (nodeName === "__interrupt__") {
        interrupted = true;
        const payload = (nodeOutput as { value: Record<string, unknown> }[])[0].value;
        
        if (opts.skipHitl) {
          // Auto-approve and continue
          console.log(chalk.green("✓ Auto-approving (--skip-hitl)"));
          const { Command: LGCommand } = await import("@langchain/langgraph");
          const resumeCommand = new LGCommand({ resume: { decision: "approved", feedback: "" } });
          const resumeConfig = { configurable: { thread_id: threadId } };
          
          for await (const resumeEvent of await workflow.stream(resumeCommand, resumeConfig)) {
            const [rNodeName] = Object.entries(resumeEvent)[0] as [string, unknown];
            if (rNodeName !== "__interrupt__") {
              console.log(chalk.green(`  ✓ ${rNodeName}`));
            }
          }
          
          // Save output
          const testCases = payload["testCases"] as TestCase[] ?? [];
          await saveTestCaseOutput(testCases, finalStory, opts.output, project.projectId);
          
          // List generated specs
          const specsDir = path.resolve(opts.output, project.projectId, "specs");
          if (fs.existsSync(specsDir)) {
            const specFiles = fs.readdirSync(specsDir).filter((f) => f.endsWith(".spec.js"));
            if (specFiles.length > 0) {
              console.log(chalk.bold.magenta(`\n📋 Generated ${specFiles.length} Playwright spec file(s):`));
              specFiles.forEach((f) => console.log(chalk.cyan(`  ✓ ${f}`)));
              console.log(chalk.gray(`\n📂 Location: ${specsDir}`));
            }
          }
        } else {
          await handleHITLReview(payload, workflow, threadId, opts.output, project.projectId, finalStory);
        }
        break;
      } else {
        const agentOutput = nodeOutput as Record<string, unknown>;
        const agent = agentOutput["currentAgent"] ?? nodeName;
        const errors = agentOutput["errors"] as string[] | undefined;

        if (errors && errors.length > 0) {
          console.error(chalk.red(`\n✗ Agent "${agent}" encountered errors:`));
          errors.forEach((e: string) => console.error(chalk.red(`  ${e}`)));
          process.exit(1);
        }

        console.log(chalk.green(`  ✓ ${String(agent)}`));
      }
    }

    if (!interrupted) {
      console.log(chalk.yellow("\n⚠  Pipeline completed without HITL interrupt."));
    }
  });

// ── HITL Review Handler ────────────────────────────────────────

async function handleHITLReview(
  payload: Record<string, unknown>,
  workflow: ReturnType<typeof buildWorkflow>,
  threadId: string,
  outputDir: string,
  projectId: string,
  userStory: string
): Promise<void> {
  const testCases = payload["testCases"] as TestCase[] ?? [];
  const gaps = payload["gapAnalysis"] as { severity: string; area: string; businessRequirement: string }[] ?? [];
  const insights = payload["mutationInsights"] as string[] ?? [];

  console.log(chalk.bold.yellow("\n⏸  HUMAN REVIEW REQUIRED\n"));
  console.log(chalk.bold(`Generated ${testCases.length} test cases:`));
  console.log(
    `  ${chalk.green(String(testCases.filter((t) => t.category === "positive").length))} positive  ` +
    `${chalk.red(String(testCases.filter((t) => t.category === "negative").length))} negative  ` +
    `${chalk.blue(String(testCases.filter((t) => t.category === "edge").length))} edge`
  );

  if (gaps.length > 0) {
    console.log(chalk.bold(`\n${gaps.length} gaps found:`));
    gaps.forEach((g) => {
      const color = g.severity === "critical" ? chalk.red : g.severity === "major" ? chalk.yellow : chalk.gray;
      console.log(`  ${color(`[${g.severity.toUpperCase()}]`)} ${g.area}: ${g.businessRequirement}`);
    });
  }

  if (insights.length > 0) {
    console.log(chalk.bold(`\n${insights.length} mutation insights:`));
    insights.forEach((i) => console.log(`  • ${i}`));
  }

  // Preview test case titles
  console.log(chalk.bold("\nTest Case Titles:"));
  testCases.forEach((tc, i) => {
    const cat =
      tc.category === "positive" ? chalk.green("(+)")
      : tc.category === "negative" ? chalk.red("(-)")
      : chalk.blue("(~)");
    console.log(`  ${String(i + 1).padStart(2)}. ${cat} ${tc.title}`);
  });

  // ── NEW: Write a temporary preview file for the user to read ──
  const previewDir = path.resolve(outputDir, ".preview");
  fs.mkdirSync(previewDir, { recursive: true });
  const previewPath = path.join(previewDir, `preview-${projectId}.md`);
  let previewContent = `# 🔍 PREVIEW: ${userStory.substring(0, 50)}...\n\n`;
  for (const tc of testCases) {
    const catIcon = tc.category === "positive" ? "✅" : tc.category === "negative" ? "❌" : "⚡";
    previewContent += `## ${catIcon} ${tc.title}\n**Category:** ${tc.category} | **Status:** ${tc.status}\n\n`;
    if (tc.preconditions.length > 0) {
      previewContent += `**Preconditions:**\n${tc.preconditions.map(p => `- ${p}`).join("\n")}\n\n`;
    }
    previewContent += `**Steps:**\n| # | Action | Expected | Verification |\n|---|---|---|---|\n`;
    tc.steps.forEach(s => {
      previewContent += `| ${s.stepNumber} | ${s.action} | ${s.expectedResult} | ${s.verification} |\n`;
    });
    if (tc.backendVerification.length > 0) {
      previewContent += `\n**Backend Verifications:**\n${tc.backendVerification.map(b => `- \`${b.query}\` -> ${b.expectedResult}`).join("\n")}\n`;
    }
    previewContent += `\n---\n\n`;
  }
  fs.writeFileSync(previewPath, previewContent, "utf-8");
  console.log(chalk.bold.magenta(`\n📄 To read the full step-by-step test cases, open: `) + chalk.underline.magenta(previewPath));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    console.log(chalk.bold.cyan("\nDecision: [A]pprove / [R]eject / [V]ision request"));
    rl.question(chalk.yellow("→ "), resolve);
  });

  const feedbackAnswer = await new Promise<string>((resolve) => {
    rl.question(chalk.yellow("Feedback (optional, press Enter to skip): "), resolve);
  });

  rl.close();

  const decisionMap: Record<string, string> = {
    a: "approved", approve: "approved",
    r: "rejected", reject: "rejected",
    v: "revision_requested", revision: "revision_requested",
  };

  const decision = decisionMap[answer.toLowerCase().trim()] ?? "rejected";
  const feedback = feedbackAnswer.trim();

  console.log(chalk.gray(`\n▶ Resuming with decision: ${decision}`));

  // Resume the graph
  const { Command: LGCommand } = await import("@langchain/langgraph");
  const runConfig = { configurable: { thread_id: threadId } };
  const resumeCommand = new LGCommand({ resume: { decision, feedback } });

  for await (const event of await workflow.stream(resumeCommand, runConfig)) {
    const [nodeName] = Object.entries(event)[0] as [string, unknown];
    if (nodeName !== "__interrupt__") {
      console.log(chalk.green(`  ✓ ${nodeName}`));
    }
  }

  // Save test cases to markdown output
  if (decision === "approved") {
    await saveTestCaseOutput(testCases, userStory, outputDir, projectId);
    
    // List generated Playwright specs
    const specsDir = path.resolve(outputDir, projectId, "specs");
    if (fs.existsSync(specsDir)) {
      const specFiles = fs.readdirSync(specsDir).filter((f) => f.endsWith(".spec.js"));
      if (specFiles.length > 0) {
        console.log(chalk.bold.magenta(`\n📋 Generated ${specFiles.length} Playwright spec file(s):`));
        specFiles.forEach((f) => {
          const specPath = path.join(specsDir, f);
          console.log(chalk.cyan(`  ✓ ${f}`));
        });
        console.log(chalk.gray(`\n📂 Location: ${specsDir}`));
        console.log(chalk.gray(`   Run specs: npx playwright test ${path.join(outputDir, projectId, "specs")}`));
      }
    }
  }
}

// ── Output Writer ─────────────────────────────────────────────

async function saveTestCaseOutput(
  testCases: TestCase[],
  userStory: string,
  outputDir: string,
  projectId: string
): Promise<void> {
  const dir = path.resolve(outputDir, projectId);
  fs.mkdirSync(dir, { recursive: true });

  const slug = userStory.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
  const filename = `${slug}-${Date.now()}.md`;
  const filePath = path.join(dir, filename);

  let content = `# Test Suite: ${userStory}\n\n`;
  content += `**Project:** ${projectId}  \n`;
  content += `**Generated:** ${new Date().toISOString()}  \n`;
  content += `**Total Tests:** ${testCases.length}\n\n---\n\n`;

  for (const tc of testCases) {
    const catIcon = tc.category === "positive" ? "✅" : tc.category === "negative" ? "❌" : "⚡";
    content += `## ${catIcon} ${tc.title}\n\n`;
    content += `| Field | Value |\n|---|---|\n`;
    content += `| **Category** | ${tc.category} |\n`;
    content += `| **Status** | ${tc.status} |\n\n`;

    if (tc.preconditions.length > 0) {
      content += `**Preconditions:**\n`;
      tc.preconditions.forEach((p) => { content += `- ${p}\n`; });
      content += "\n";
    }

    content += `**Steps:**\n\n| # | Action | Expected | Verification |\n|---|---|---|---|\n`;
    for (const step of tc.steps) {
      content += `| ${step.stepNumber} | ${step.action} | ${step.expectedResult} | ${step.verification} |\n`;
    }

    if (tc.backendVerification.length > 0) {
      content += `\n**Backend Verification:**\n`;
      tc.backendVerification.forEach((bv) => {
        content += `- \`${bv.query}\` → ${bv.expectedResult}\n`;
      });
    }

    if (tc.mutationNote) {
      content += `\n> 🧬 **Mutation Note:** ${tc.mutationNote}\n`;
    }

    content += "\n---\n\n";
  }

  fs.writeFileSync(filePath, content, "utf-8");
  console.log(chalk.bold.green(`\n✅ Test cases saved to: ${filePath}`));
}

// ── Boot ──────────────────────────────────────────────────────

program.parse(process.argv);
