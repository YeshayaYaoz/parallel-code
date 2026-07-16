#!/usr/bin/env node

// Ultrakod CLI - Dedicated CLI for model routing and context management.
// Provides commands for managing project context, routing modes, and model switching.

import path from 'path';
import {
  initializeContext,
  loadContext,
  saveContext,
  updateContextForModelSwitch,
  setExecutiveSummary,
  setResetTime,
  isResetDue,
  getContextForModel,
} from './context.js';
import { getModelForMode, MODEL_REGISTRY, type RoutingMode } from './registry.js';

interface CLIArgs {
  command: string;
  projectRoot: string;
  mode?: RoutingMode;
  model?: string;
  summary?: string;
  resetAt?: string;
  exclude?: string[];
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    command: '',
    projectRoot: process.cwd(),
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      if (!args.command) {
        args.command = arg;
      }
      continue;
    }

    const [key, value] = arg.slice(2).split('=');

    switch (key) {
      case 'project':
      case 'p':
        args.projectRoot = path.resolve(value || argv[++i]);
        break;
      case 'mode':
      case 'm':
        args.mode = value as RoutingMode;
        break;
      case 'model':
        args.model = value || argv[++i];
        break;
      case 'summary':
      case 's':
        args.summary = value || argv[++i];
        break;
      case 'reset-at':
        args.resetAt = value || argv[++i];
        break;
      case 'exclude':
        args.exclude = (value || argv[++i])
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`
Ultrakod CLI - Model Router & Context Manager

Usage: ultrakod <command> [options]

Commands:
  init              Initialize project context
  status            Show current context and model status
  route             Get optimal model for routing mode
  switch            Switch to a different model
  summary           Set executive summary
  reset             Set/reset quota timer
  models            List all available models
  context           Show full context for current model

Options:
  --project, -p     Project root directory (default: cwd)
  --mode, -m        Routing mode: cheap, balanced, extra
  --model           Specific model ID
  --summary, -s     Executive summary text
  --reset-at        ISO timestamp for quota reset
  --exclude         Comma-separated model IDs to exclude

Examples:
  ultrakod init --project ./my-app
  ultrakod route --mode balanced
  ultrakod switch --model claude-opus-4-8
  ultrakod summary --summary "Fixing auth bug in login flow"
  ultrakod reset --reset-at 2026-07-16T15:00:00Z
`);
}

function handleInit(args: CLIArgs): void {
  const context = initializeContext(
    args.projectRoot,
    generateProjectId(args.projectRoot),
    'claude-sonnet-5',
  );
  console.log(`Initialized context for project: ${context.projectId}`);
  console.log(`Active model: ${context.activeModel}`);
}

function handleStatus(args: CLIArgs): void {
  const context = loadContext(args.projectRoot);
  if (!context) {
    console.error('No context found. Run "ultrakod init" first.');
    process.exit(1);
  }

  console.log('Project Context Status:');
  console.log(`  Project ID: ${context.projectId}`);
  console.log(`  Active Model: ${context.activeModel}`);
  console.log(`  Created: ${context.createdAt}`);
  console.log(`  Updated: ${context.updatedAt}`);
  console.log(`  Reset At: ${context.resetAt || 'Not set'}`);
  console.log(`  Reset Due: ${isResetDue(context) ? 'Yes' : 'No'}`);
  console.log(`  Model Switches: ${context.modelHistory.length}`);
  console.log(`  Files Modified: ${context.fileTree.length}`);
  console.log(`  Executive Summary: ${context.executiveSummary || 'Not set'}`);
}

function handleRoute(args: CLIArgs): void {
  if (!args.mode) {
    console.error('Mode required. Use --mode cheap, balanced, or extra.');
    process.exit(1);
  }

  let context = loadContext(args.projectRoot);
  if (!context) {
    context = initializeContext(
      args.projectRoot,
      generateProjectId(args.projectRoot),
      'claude-sonnet-5',
    );
  }
  const excludeList = args.exclude || [];

  if (context?.resetAt && !isResetDue(context)) {
    console.log(`Current model still available: ${context.activeModel}`);
    console.log(JSON.stringify({ model: context.activeModel, reason: 'within quota' }));
    return;
  }

  const model = getModelForMode(args.mode, excludeList);
  if (!model) {
    console.error(`No model available for mode: ${args.mode}`);
    process.exit(1);
  }

  console.log(`Recommended model for ${args.mode} mode: ${model.name}`);
  console.log(
    JSON.stringify({
      model: model.id,
      mode: args.mode,
      inputCostPerMillion: model.inputCostPerMillion,
      outputCostPerMillion: model.outputCostPerMillion,
    }),
  );
}

function handleSwitch(args: CLIArgs): void {
  if (!args.model) {
    console.error('Model ID required. Use --model <model-id>.');
    process.exit(1);
  }

  let context = loadContext(args.projectRoot);
  if (!context) {
    context = initializeContext(args.projectRoot, generateProjectId(args.projectRoot), args.model);
  }

  const model = MODEL_REGISTRY[args.model];
  if (!model) {
    console.error(`Unknown model: ${args.model}`);
    process.exit(1);
  }

  context = updateContextForModelSwitch(context, args.model, 'manual switch');
  saveContext(context);

  console.log(`Switched to model: ${model.name}`);
  console.log(
    JSON.stringify({ from: context.modelHistory.slice(-1)[0]?.fromModel, to: args.model }),
  );
}

function handleSummary(args: CLIArgs): void {
  if (!args.summary) {
    console.error('Summary text required. Use --summary "text".');
    process.exit(1);
  }

  let context = loadContext(args.projectRoot);
  if (!context) {
    context = initializeContext(
      args.projectRoot,
      generateProjectId(args.projectRoot),
      'claude-sonnet-5',
    );
  }

  context = setExecutiveSummary(context, args.summary);
  saveContext(context);

  console.log('Executive summary updated.');
}

function handleReset(args: CLIArgs): void {
  if (!args.resetAt) {
    console.error('Reset time required. Use --reset-at <ISO timestamp>.');
    process.exit(1);
  }

  let context = loadContext(args.projectRoot);
  if (!context) {
    context = initializeContext(
      args.projectRoot,
      generateProjectId(args.projectRoot),
      'claude-sonnet-5',
    );
  }

  context = setResetTime(context, args.resetAt);
  saveContext(context);

  console.log(`Reset time set to: ${args.resetAt}`);
}

function handleModels(): void {
  console.log('Available Models:');
  console.log('─'.repeat(80));

  for (const model of Object.values(MODEL_REGISTRY)) {
    console.log(`${model.name} (${model.id})`);
    console.log(
      `  Provider: ${model.provider} · Tier: ${model.tier} · Throughput: ${model.throughput}`,
    );
    console.log(
      `  Cost: $${model.inputCostPerMillion}/1M in, $${model.outputCostPerMillion}/1M out`,
    );
    console.log(
      `  Context: ${model.contextWindowTokens.toLocaleString()} tokens · Max output: ${model.maxOutputTokens}`,
    );
    console.log(`  Strengths: ${model.strengths.join(', ')}`);
    console.log('');
  }
}

function handleContext(args: CLIArgs): void {
  const context = loadContext(args.projectRoot);
  if (!context) {
    console.error('No context found. Run "ultrakod init" first.');
    process.exit(1);
  }

  const modelId = args.model || context.activeModel;
  const contextStr = getContextForModel(context, modelId);
  console.log(contextStr);
}

function generateProjectId(projectRoot: string): string {
  return path
    .basename(projectRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-');
}

function main(): void {
  const args = parseArgs(process.argv);

  if (!args.command || args.command === 'help') {
    printUsage();
    return;
  }

  switch (args.command) {
    case 'init':
      handleInit(args);
      break;
    case 'status':
      handleStatus(args);
      break;
    case 'route':
      handleRoute(args);
      break;
    case 'switch':
      handleSwitch(args);
      break;
    case 'summary':
      handleSummary(args);
      break;
    case 'reset':
      handleReset(args);
      break;
    case 'models':
      handleModels();
      break;
    case 'context':
      handleContext(args);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      printUsage();
      process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
