-- pgvector: created here too so the migration works on any database (and Prisma's shadow DB).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "Runbook" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "embedding" vector(512),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Runbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentMemory" (
    "incidentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT,
    "service" TEXT,
    "embedding" vector(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentMemory_pkey" PRIMARY KEY ("incidentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Runbook_slug_key" ON "Runbook"("slug");

-- Approximate nearest-neighbour indexes for cosine similarity (pgvector HNSW).
-- Written by hand: Prisma cannot declare index types on Unsupported columns.
CREATE INDEX "Runbook_embedding_hnsw" ON "Runbook" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "IncidentMemory_embedding_hnsw" ON "IncidentMemory" USING hnsw ("embedding" vector_cosine_ops);
