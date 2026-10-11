-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "InvestigationMode" AS ENUM ('llm', 'rule_based');

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'running',
    "mode" "InvestigationMode" NOT NULL,
    "fallbackReason" TEXT,
    "model" TEXT,
    "summary" TEXT,
    "hypotheses" JSONB,
    "rejectedClaims" JSONB,
    "toolCalls" JSONB,
    "claimsTotal" INTEGER NOT NULL DEFAULT 0,
    "claimsRejected" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Investigation_incidentId_startedAt_idx" ON "Investigation"("incidentId", "startedAt");

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
