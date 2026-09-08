-- Pipeline text/voice session state + per-turn latency metrics (Phase 1)
CREATE TABLE "PipelineSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PipelineSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PipelineTurnMetric" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "crisisLevel" VARCHAR(32) NOT NULL DEFAULT 'none',
    "llmTtftMs" INTEGER,
    "llmTotalMs" INTEGER,
    "totalMs" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineTurnMetric_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PipelineSession_userId_updatedAt_idx" ON "PipelineSession"("userId", "updatedAt");

CREATE INDEX "PipelineTurnMetric_sessionId_turnNumber_idx" ON "PipelineTurnMetric"("sessionId", "turnNumber");

ALTER TABLE "PipelineSession" ADD CONSTRAINT "PipelineSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PipelineTurnMetric" ADD CONSTRAINT "PipelineTurnMetric_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PipelineSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
