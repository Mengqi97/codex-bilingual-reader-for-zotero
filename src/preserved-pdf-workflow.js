/* global module */
(function (global) {
  "use strict";

  const JOB_SCHEMA_VERSION = 1;
  const JOB_STAGES = Object.freeze([
    "queued",
    "preflight",
    "layout",
    "translation",
    "render",
    "validate",
    "import",
    "completed",
    "failed",
    "cancelled",
  ]);

  const RESUMABLE_STAGES = new Set([
    "queued",
    "preflight",
    "layout",
    "translation",
    "render",
    "validate",
    "failed",
  ]);

  function assertStage(stage) {
    if (!JOB_STAGES.includes(stage)) throw new Error(`Unknown PDF workflow stage: ${stage}`);
    return stage;
  }

  function createJob({ sourceFingerprint, engine, translationProvider, createdAt }) {
    if (!sourceFingerprint) throw new Error("sourceFingerprint is required");
    if (!engine) throw new Error("engine is required");
    if (!translationProvider) throw new Error("translationProvider is required");
    const at = createdAt || new Date().toISOString();
    return {
      schemaVersion: JOB_SCHEMA_VERSION,
      sourceFingerprint,
      engine,
      translationProvider,
      status: "queued",
      events: [{ at, stage: "queued" }],
      artifacts: {},
    };
  }

  function appendEvent(job, { stage, at, completed, total, message, error }) {
    assertStage(stage);
    const event = { at: at || new Date().toISOString(), stage };
    if (Number.isFinite(completed)) event.completed = completed;
    if (Number.isFinite(total)) event.total = total;
    if (message) event.message = String(message);
    if (error) event.error = String(error);
    return {
      ...job,
      status: stage,
      events: [...(job.events || []), event],
    };
  }

  function attachArtifacts(job, artifacts) {
    const merged = { ...(job.artifacts || {}), ...(artifacts || {}) };
    return { ...job, artifacts: merged };
  }

  function canResume(job, { sourceFingerprint, engine, translationProvider }) {
    return Boolean(
      job
      && job.schemaVersion === JOB_SCHEMA_VERSION
      && job.sourceFingerprint === sourceFingerprint
      && job.engine === engine
      && job.translationProvider === translationProvider
      && RESUMABLE_STAGES.has(job.status),
    );
  }

  function progressOf(job) {
    const last = [...(job.events || [])].reverse().find((event) => Number.isFinite(event.completed));
    if (!last || !Number.isFinite(last.total) || last.total <= 0) return null;
    return Math.min(1, Math.max(0, last.completed / last.total));
  }

  const api = {
    JOB_SCHEMA_VERSION,
    JOB_STAGES,
    createJob,
    appendEvent,
    attachArtifacts,
    canResume,
    progressOf,
  };
  global.CodexPreservedPdfWorkflow = api;
  if (typeof module !== "undefined") module.exports = api;
}(this));
