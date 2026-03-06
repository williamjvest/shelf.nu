---
title: Kit Bundling - Manage Kits Within Kits
type: feat
status: active
date: 2026-02-17
updated: 2026-02-17
version: 2.0 (Revised after technical review)
---

> **⚠️ IMPORTANT**: This plan has been revised based on comprehensive technical review.
> See `docs/plans/2026-02-17-feat-kit-bundling-TECHNICAL-REVIEW.md` for full review findings.
>
> **Key Changes**:
> - Fixed 4 critical security vulnerabilities (SQL injection, race conditions, auth bypass)
> - Fixed critical performance issues (20-40x faster with batched queries)
> - Removed 40% of unnecessary code (650 lines)
> - Reduced implementation time from 3-4 weeks to 2 weeks

# Kit Bundling - Manage Kits Within Kits

## Overview

Enable hierarchical kit management where kits can contain other kits (nested kits), allowing child kits to be rented individually OR as part of a parent kit bundle. When a parent kit is booked, all child kits become unavailable. When a child kit is booked individually, all parent kits containing that child become unavailable.

**Real-World Use Case:**
- **Light Kit** (contains individual light assets)
- **Trailer Package** (contains Light Kit + Generator Kit + other equipment)

When the **Trailer Package** is rented, the **Light Kit** automatically becomes unavailable for individual rental. When the **Light Kit** is rented individually, the **Trailer Package** becomes unavailable.

## Problem Statement / Motivation

### Current Limitation

Assets have a 1-to-1 relationship with kits (`asset.kitId` foreign key), making it impossible to:

- Have a kit belong to a parent kit (no kit-to-kit relationships)
- Automatically block availability of child kits when parent is booked
- Rent child kits independently or as part of a bundle
- Track complex equipment packages that contain sub-packages

### Business Impact

**Without this feature:**
- ❌ Manual tracking of kit dependencies (error-prone)
- ❌ Double-booking risks (parent and child booked simultaneously)
- ❌ Poor user experience (unclear what's included in packages)
- ❌ Limited inventory organization (flat kit structure only)

**With this feature:**
- ✅ Automatic conflict prevention across kit hierarchy
- ✅ Flexible rental options (individual or bundle)
- ✅ Clear package visualization (what's included)
- ✅ Scalable inventory organization (nested structures)

## Proposed Solution

Implement a **self-referential kit hierarchy** following the existing **Location hierarchy pattern** in the codebase, with enhanced booking conflict detection to traverse the kit tree.

### High-Level Approach

1. **Database Schema**: Add `parentKitId` self-referential foreign key to `Kit` model (similar to `Location.parentId`)
2. **Booking Logic**: Extend existing 3-tier conflict detection to check kit ancestors and descendants
3. **UI Components**: Create hierarchy visualization and selection interfaces
4. **Validation**: Prevent circular references and enforce depth limits
5. **Migration**: Handle existing bookings and ensure backwards compatibility

### Why This Approach?

- ✅ **Proven Pattern**: Location hierarchy already works this way
- ✅ **Minimal Schema Changes**: Single column addition
- ✅ **Leverages Existing Code**: Booking conflict system is sophisticated
- ✅ **PostgreSQL Native**: Recursive CTEs for efficient hierarchy queries
- ✅ **Type-Safe**: Prisma ORM with TypeScript throughout

## Technical Considerations

### Architecture Impacts

**Database Layer:**
- Add `parentKitId` column to `Kit` table (nullable, self-referential)
- Add index on `parentKitId` for hierarchy queries
- Add CHECK constraint to prevent self-reference (`parentKitId != id`)
- ~~Add trigger to prevent circular references~~ ❌ **REMOVED** - Use application validation instead
- ✅ **NEW**: Add critical indexes for booking conflict queries:
  - `Booking(organizationId, status, from, to)` - Prevents full table scans
  - `Asset(kitId)` - Speeds up kit-asset joins

**Service Layer (`app/modules/kit/service.server.ts`):**
- New function: `getKitHierarchy(kitId)` - Fetch full tree using **single recursive CTE** (not nested includes)
- New function: `validateKitHierarchy(kitId, parentKitId)` - Prevent circular refs with **organization boundary checks**
- Update: `updateKitAssets()` - Cascade location updates through hierarchy
- Update: `getKits()` - Include hierarchy in filtering logic with **batched queries** (no N+1)
- ~~New function: `getKitAncestors(kitId)`~~ ❌ **REMOVED** - Inline where used (only used once)
- ~~New function: `getKitDescendants(kitId)`~~ ❌ **REMOVED** - Inline where used (only used once)

**Booking Service (`app/modules/booking/service.server.ts`):**
- Update: Conflict detection to check kit ancestors and descendants with **single recursive CTE** (no N+1)
- Update: `hideUnavailable` logic to traverse hierarchy with **batched queries**
- New validation: Ensure all children available when booking parent (**within transaction**)
- New validation: Mark all parents unavailable when booking child (**within transaction**)
- ✅ **NEW**: Use `Serializable` transaction isolation to prevent race conditions
- ✅ **NEW**: Use `SELECT FOR UPDATE` to lock kits during booking creation

**UI Components:**
- ~~New: `KitHierarchyTree` - Nested tree view with expand/collapse~~ ❌ **REMOVED** - Use simple flat list with indentation
- New: `KitHierarchyBadge` - Visual indicator (**"Bundle" badge only**, removed "Part of bundle")
- ~~Update: `KitSelector` - Autocomplete search~~ ❌ **REMOVED** - Use simple `<select>` dropdown
- Update: `BookingConflictMessage` - Show which kit in hierarchy is causing conflict
- ~~Update: `KitAvailabilityCalendar` - Color-code direct vs. hierarchical unavailability~~ ⚠️ **DEFERRED** - Show unavailable as red (add colors later)

### Performance Implications

**Query Performance:**
- Recursive CTE for hierarchy fetching (efficient for depth ≤ 3)
- Additional joins in booking conflict queries (mitigated by indexes)
- Potential N+1 queries if not using `include` properly

**Mitigation Strategies:**
- Limit maximum nesting depth to 3 levels
- Add database indexes on `parentKitId` and `(kitId, from, to)` for bookings
- Use Prisma's `include` to fetch hierarchy in single query
- Consider caching kit hierarchy for frequently accessed kits (future optimization)

**Load Testing Targets:**
- 1000 kits with 10% in hierarchies: < 500ms for availability search
- 100 concurrent booking attempts: < 2s response time
- Hierarchy fetch (3 levels deep): < 100ms

### Security Considerations

**Access Control:**
- Verify user has permission to modify both parent and child kits
- Prevent unauthorized hierarchy modifications
- Audit trail for all hierarchy changes (use existing activity notes system)

**Data Integrity:**
- Prevent circular references (database trigger + application validation)
- Prevent self-reference (CHECK constraint)
- Enforce organizational boundaries (can't nest kits from different orgs)
- Transaction safety for hierarchy modifications

**Race Condition Prevention:**
- Use database transactions for booking creation
- Optimistic locking for concurrent hierarchy modifications
- Server-side validation (never trust client)

## Technical Approach

### Phase 0: Backup & Safety Preparation (CRITICAL - Do First!)

**⚠️ MANDATORY: Complete this phase before any code changes**

This is a major database schema change with complex business logic. Having comprehensive backups and rollback options is critical for safe implementation.

#### 0.1: Create Supabase Database Backup

**Primary Backup (Supabase Dashboard):**
1. Navigate to Supabase Dashboard → Database → Backups
2. Click "Create Backup" (manual backup)
3. Name: `pre-kit-bundling-2026-02-17`
4. Wait for backup to complete
5. Download backup file locally as additional safety

**Alternative Backup (pg_dump):**
```bash
# If you have direct database access
# Get DATABASE_URL from .env
pg_dump $DATABASE_URL > ~/backups/shelf-nu-pre-kit-bundling-$(date +%Y%m%d-%H%M%S).sql

# Verify backup was created
ls -lh ~/backups/shelf-nu-pre-kit-bundling-*.sql

# Test backup integrity (optional but recommended)
pg_restore --list ~/backups/shelf-nu-pre-kit-bundling-*.sql | head -20
```

**Backup Checklist:**
- [ ] Supabase manual backup created
- [ ] Backup file downloaded locally
- [ ] Backup file size verified (should be > 1MB for production database)
- [ ] Backup stored in safe location (not in project directory)
- [ ] Backup timestamp documented

---

#### 0.2: Create Git Feature Branch

**Create isolated branch for development:**
```bash
cd /Users/williamvest/Projects/shelf.nu

# Ensure you're on main and up to date
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/kit-bundling

# Commit plan documents
git add docs/plans/
git commit -m "docs: add kit bundling implementation plan and technical review

- Add comprehensive implementation plan
- Add technical review findings from 4 specialized reviewers
- Add critical fixes guide with security and performance improvements
- Includes backup and rollback procedures"

# Push to remote (creates backup on GitHub)
git push -u origin feature/kit-bundling
```

**Git Safety Checklist:**
- [ ] Feature branch created (`feature/kit-bundling`)
- [ ] Plan documents committed
- [ ] Branch pushed to remote (GitHub backup)
- [ ] Main branch remains untouched
- [ ] No uncommitted changes in working directory

---

#### 0.3: Create Docker Container Snapshot (Optional)

**If running shelf.nu in Docker:**
```bash
# List running containers
docker ps

# Create snapshot of running container
docker commit <container-id> shelf-nu-backup:pre-kit-bundling-2026-02-17

# Verify snapshot created
docker images | grep shelf-nu-backup

# Optional: Export snapshot to file for long-term storage
docker save shelf-nu-backup:pre-kit-bundling-2026-02-17 | gzip > ~/backups/shelf-nu-docker-backup-$(date +%Y%m%d).tar.gz
```

**Docker Backup Checklist:**
- [ ] Container snapshot created
- [ ] Snapshot verified in `docker images`
- [ ] Optional: Snapshot exported to file
- [ ] Snapshot tagged with date

---

#### 0.4: Set Up Staging/Development Environment

**Option A: Supabase Database Branch** (Recommended if available)
```bash
# In Supabase Dashboard:
# 1. Navigate to Database → Branches
# 2. Click "Create Branch"
# 3. Name: "kit-bundling-dev"
# 4. Source: Production database
# 5. Copy connection string

# Update .env.local with branch connection string
echo "DATABASE_URL=<branch-connection-string>" >> .env.local
echo "DIRECT_URL=<branch-connection-string>" >> .env.local
```

**Option B: Local PostgreSQL Database** (Alternative)
```bash
# Create local PostgreSQL container
docker run -d \
  --name shelf-nu-dev-db \
  -e POSTGRES_PASSWORD=devpassword \
  -e POSTGRES_DB=shelf_nu_dev \
  -e POSTGRES_USER=postgres \
  -p 5433:5432 \
  postgres:15

# Wait for database to start
sleep 5

# Update .env.local to point to local database
cat > .env.local << EOF
DATABASE_URL=postgresql://postgres:devpassword@localhost:5433/shelf_nu_dev
DIRECT_URL=postgresql://postgres:devpassword@localhost:5433/shelf_nu_dev
EOF

# Run existing migrations to set up schema
npm run setup

# Verify database is ready
psql postgresql://postgres:devpassword@localhost:5433/shelf_nu_dev -c "\dt" | head -20
```

**Staging Environment Checklist:**
- [ ] Staging database created (Supabase branch OR local PostgreSQL)
- [ ] Connection string configured in `.env.local`
- [ ] Existing migrations run successfully
- [ ] Database schema matches production
- [ ] Can connect to staging database

---

#### 0.5: Document Rollback Procedures

**Create rollback script:**
```bash
# Create rollback directory
mkdir -p docs/rollback

# Create rollback migration script
cat > docs/rollback/rollback-kit-bundling.sql << 'EOF'
-- Rollback script for Kit Bundling feature
-- Run this if you need to revert the database changes

BEGIN;

-- Remove indexes
DROP INDEX IF EXISTS "Kit_parentKitId_idx";
DROP INDEX IF EXISTS "Booking_organizationId_status_from_to_idx";
DROP INDEX IF EXISTS "Asset_kitId_idx";

-- Remove constraints
ALTER TABLE "Kit" DROP CONSTRAINT IF EXISTS "Kit_no_self_reference";
ALTER TABLE "Kit" DROP CONSTRAINT IF EXISTS "Kit_parentKitId_fkey";

-- Remove column (WARNING: This will delete all hierarchy data!)
ALTER TABLE "Kit" DROP COLUMN IF EXISTS "parentKitId";

COMMIT;
EOF

# Make script executable
chmod +x docs/rollback/rollback-kit-bundling.sql
```

**Rollback Documentation:**
```bash
# Create rollback guide
cat > docs/rollback/ROLLBACK-GUIDE.md << 'EOF'
# Kit Bundling Rollback Guide

## When to Rollback

Rollback if you encounter:
- Data corruption or integrity issues
- Critical bugs that cannot be fixed quickly
- Performance degradation in production
- Circular reference bugs that bypass validation

## Rollback Steps

### 1. Restore Database from Backup

**Option A: Supabase Dashboard**
1. Navigate to Database → Backups
2. Find backup: "pre-kit-bundling-2026-02-17"
3. Click "Restore"
4. Confirm restoration
5. Wait for completion (5-15 minutes)

**Option B: pg_dump Restore**
```bash
# Restore from local backup
psql $DATABASE_URL < ~/backups/shelf-nu-pre-kit-bundling-YYYYMMDD-HHMMSS.sql
```

### 2. Rollback Code Changes

```bash
# Switch back to main branch
git checkout main

# Delete feature branch (if needed)
git branch -D feature/kit-bundling

# Or reset to specific commit
git reset --hard <commit-hash-before-changes>
```

### 3. Verify Rollback

```bash
# Check database schema
psql $DATABASE_URL -c "\d Kit" | grep parentKitId
# Should return no results

# Check application works
npm run dev
# Navigate to /kits and verify functionality
```

### 4. Document Issues

Create incident report documenting:
- What went wrong
- When it was detected
- Steps taken to rollback
- Data loss (if any)
- Lessons learned
EOF
```

**Rollback Checklist:**
- [ ] Rollback SQL script created
- [ ] Rollback guide documented
- [ ] Rollback procedures tested on staging
- [ ] Team notified of rollback procedures
- [ ] Backup restoration tested (on staging)

---

#### 0.6: Pre-Implementation Validation

**Final checks before starting implementation:**

```bash
# 1. Verify backups exist
ls -lh ~/backups/shelf-nu-pre-kit-bundling-*.sql

# 2. Verify git branch
git branch --show-current
# Should output: feature/kit-bundling

# 3. Verify staging database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Kit\";"
# Should return kit count

# 4. Verify no uncommitted changes
git status
# Should show clean working tree

# 5. Run existing tests
npm run test
# All tests should pass

# 6. Verify validation pipeline
npm run validate
# Should pass without errors
```

**Pre-Implementation Checklist:**
- [ ] All backups created and verified
- [ ] Git feature branch active
- [ ] Staging environment ready
- [ ] Rollback procedures documented and tested
- [ ] Existing tests passing
- [ ] Validation pipeline passing
- [ ] Team notified of implementation start
- [ ] Maintenance window scheduled (if needed)

---

#### 0.7: Communication & Monitoring

**Before starting implementation:**

1. **Notify stakeholders:**
   - Development team
   - QA team
   - Product owner
   - DevOps/Infrastructure team

2. **Set up monitoring:**
   - Database query performance monitoring
   - Error rate monitoring
   - Application performance monitoring

3. **Schedule implementation:**
   - Choose low-traffic period for production deployment
   - Have rollback team on standby
   - Plan for 2-4 hour implementation window

**Communication Checklist:**
- [ ] Team notified of implementation timeline
- [ ] Stakeholders aware of potential downtime
- [ ] Monitoring dashboards prepared
- [ ] Rollback team identified and available
- [ ] Communication channels established (Slack, etc.)

---

**Phase 0 Completion Criteria:**

✅ All backups created and verified  
✅ Git feature branch created and pushed  
✅ Staging environment ready and tested  
✅ Rollback procedures documented and tested  
✅ Pre-implementation validation passed  
✅ Team notified and ready  

**Estimated Time:** 2-4 hours

**⚠️ DO NOT PROCEED to Phase 1 until all Phase 0 items are complete!**

---

### Phase 1: Database Schema & Core Models

**Files to Modify:**
- `app/database/schema.prisma`

**Changes:**

```prisma
model Kit {
  id          String    @id @default(cuid())
  name        String
  description String?
  status      KitStatus @default(AVAILABLE)
  
  // ... existing fields ...
  
  // NEW: Self-referential hierarchy (following Location pattern)
  parentKitId String?
  parentKit   Kit?   @relation("KitHierarchy", fields: [parentKitId], references: [id], onDelete: SetNull)
  childKits   Kit[]  @relation("KitHierarchy")
  
  // ... existing relationships ...
  
  @@index([organizationId, parentKitId])
}
```

**Migration Script:**

```sql
-- Add parentKitId column
ALTER TABLE "Kit" ADD COLUMN "parentKitId" TEXT;

-- Add self-reference constraint
ALTER TABLE "Kit" ADD CONSTRAINT "Kit_parentKitId_fkey" 
  FOREIGN KEY ("parentKitId") REFERENCES "Kit"("id") 
  ON DELETE SET NULL;

-- Prevent self-reference (database-level safety)
ALTER TABLE "Kit" ADD CONSTRAINT "Kit_no_self_reference" 
  CHECK ("parentKitId" != "id");

-- Add index for hierarchy queries
CREATE INDEX "Kit_parentKitId_idx" 
  ON "Kit"("parentKitId")
  WHERE "parentKitId" IS NOT NULL;

-- ✅ CRITICAL: Add indexes for booking conflict queries (prevents full table scans)
CREATE INDEX "Booking_organizationId_status_from_to_idx"
  ON "Booking"("organizationId", "status", "from", "to");

CREATE INDEX "Asset_kitId_idx" 
  ON "Asset"("kitId")
  WHERE "kitId" IS NOT NULL;

-- ❌ REMOVED: Database trigger for circular references
-- Reason: Application validation provides better error messages and is easier to test
-- Circular reference prevention is handled in validateKitHierarchy() function
```

**Validation:**
- Run migration on test database
- Verify foreign key constraint works
- Test self-reference prevention (should fail at database level)
- Verify all indexes created successfully
- ~~Test circular reference prevention~~ ❌ **REMOVED** - Tested in application layer instead
- ✅ **NEW**: Verify booking indexes improve query performance (use EXPLAIN ANALYZE)

---

### Phase 2: Service Layer - Hierarchy Utilities

**Files to Create:**
- `app/modules/kit/hierarchy.server.ts`

**New Functions:**

#### `getKitHierarchy(kitId: string, organizationId: string)`

Fetch complete kit hierarchy (ancestors + descendants) using recursive CTE.

```typescript
// app/modules/kit/hierarchy.server.ts

import { db } from "~/database/db.server";
import type { Kit } from "@prisma/client";

export interface KitWithHierarchy extends Kit {
  parentKit?: KitWithHierarchy | null;
  childKits: KitWithHierarchy[];
  depth: number;
}

/**
 * Fetch kit with full hierarchy (ancestors and descendants)
 * Uses recursive CTE for efficient querying
 */
export async function getKitHierarchy(
  kitId: string,
  organizationId: string
): Promise<KitWithHierarchy | null> {
  // Use Prisma's recursive include (up to max depth)
  const kit = await db.kit.findFirst({
    where: { id: kitId, organizationId },
    include: {
      parentKit: {
        include: {
          parentKit: {
            include: {
              parentKit: true, // Max 3 levels up
            },
          },
        },
      },
      childKits: {
        include: {
          childKits: {
            include: {
              childKits: true, // Max 3 levels down
            },
          },
        },
      },
    },
  });

  if (!kit) return null;

  // Calculate depth for each node
  return addDepthToHierarchy(kit, 0);
}

/**
 * Get all ancestor kits (parents, grandparents, etc.)
 */
export async function getKitAncestors(
  kitId: string,
  organizationId: string
): Promise<Kit[]> {
  const result = await db.$queryRaw<Kit[]>`
    WITH RECURSIVE ancestors AS (
      SELECT * FROM "Kit" WHERE id = ${kitId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT k.* FROM "Kit" k
      INNER JOIN ancestors a ON k.id = a."parentKitId"
    )
    SELECT * FROM ancestors WHERE id != ${kitId}
  `;
  
  return result;
}

/**
 * Get all descendant kits (children, grandchildren, etc.)
 */
export async function getKitDescendants(
  kitId: string,
  organizationId: string
): Promise<Kit[]> {
  const result = await db.$queryRaw<Kit[]>`
    WITH RECURSIVE descendants AS (
      SELECT * FROM "Kit" WHERE id = ${kitId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT k.* FROM "Kit" k
      INNER JOIN descendants d ON k."parentKitId" = d.id
    )
    SELECT * FROM descendants WHERE id != ${kitId}
  `;
  
  return result;
}

/**
 * Validate that adding parentKitId won't create circular reference
 * Returns true if valid, throws error if circular reference detected
 * 
 * ✅ SECURITY: Validates organization boundary to prevent cross-org access
 * ✅ SECURITY: Validates inputs to prevent SQL injection
 * ✅ PERFORMANCE: Uses single recursive CTE instead of separate queries
 */
export async function validateKitHierarchy(
  kitId: string,
  parentKitId: string,
  organizationId: string
): Promise<boolean> {
  // ✅ SECURITY: Validate inputs (prevent SQL injection)
  import { z } from 'zod';
  const kitIdSchema = z.string().cuid();
  kitIdSchema.parse(kitId);
  kitIdSchema.parse(parentKitId);
  kitIdSchema.parse(organizationId);
  
  // ✅ SECURITY: Verify parent kit belongs to same organization
  const parentKit = await db.kit.findFirst({
    where: { id: parentKitId, organizationId },
    select: { id: true, organizationId: true }
  });
  
  if (!parentKit) {
    throw new ShelfError({
      cause: null,
      label: "Kit",
      message: "Parent kit not found or does not belong to your organization",
      status: 403,
    });
  }
  
  // Check if parentKitId is the kit itself
  if (kitId === parentKitId) {
    throw new ShelfError({
      cause: null,
      label: "Kit",
      message: "A kit cannot be its own parent.",
      status: 400,
    });
  }
  
  // ✅ PERFORMANCE: Single recursive CTE to check circular refs AND depth
  const validation = await db.$queryRaw<[{ 
    wouldCreateCycle: boolean; 
    parentDepth: number;
    childDepth: number;
  }]>`
    WITH RECURSIVE
    -- Get all ancestors of parent (how deep parent already is)
    parent_ancestors AS (
      SELECT id, "parentKitId", 0 as depth
      FROM "Kit"
      WHERE id = ${parentKitId} AND "organizationId" = ${organizationId}
      
      UNION ALL
      
      SELECT k.id, k."parentKitId", pa.depth + 1
      FROM "Kit" k
      INNER JOIN parent_ancestors pa ON k.id = pa."parentKitId"
      WHERE k."parentKitId" IS NOT NULL AND pa.depth < 10
    ),
    -- Get all descendants of child (how deep child already is)
    child_descendants AS (
      SELECT id, "parentKitId", 0 as depth
      FROM "Kit"
      WHERE id = ${kitId} AND "organizationId" = ${organizationId}
      
      UNION ALL
      
      SELECT k.id, k."parentKitId", cd.depth + 1
      FROM "Kit" k
      INNER JOIN child_descendants cd ON k."parentKitId" = cd.id
      WHERE cd.depth < 10
    )
    SELECT
      EXISTS(SELECT 1 FROM child_descendants WHERE id = ${parentKitId}) as "wouldCreateCycle",
      COALESCE(MAX(pa.depth), 0) as "parentDepth",
      COALESCE(MAX(cd.depth), 0) as "childDepth"
    FROM parent_ancestors pa
    FULL OUTER JOIN child_descendants cd ON false
  `;
  
  const { wouldCreateCycle, parentDepth, childDepth } = validation[0];
  
  // Check for circular reference
  if (wouldCreateCycle) {
    throw new ShelfError({
      cause: null,
      label: "Kit",
      message: `Cannot set parent: would create circular reference`,
      status: 400,
    });
  }
  
  // ✅ FIX: Check TOTAL depth (parent ancestors + 1 + child descendants)
  const totalDepth = parentDepth + 1 + childDepth;
  
  if (totalDepth > 3) {
    throw new ShelfError({
      cause: null,
      label: "Kit",
      message: `Maximum nesting depth (3 levels) exceeded. This would create ${totalDepth} levels.`,
      status: 400,
    });
  }
  
  return true;
}

// ❌ REMOVED: addDepthToHierarchy() function
// Reason: Depth calculation is never used in business logic or UI
// If needed later, can be added back
```

**Tests to Add:**

```typescript
// app/modules/kit/hierarchy.server.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { getKitHierarchy, getKitAncestors, getKitDescendants, validateKitHierarchy } from "./hierarchy.server";
import { createKit } from "../test/factories/kit-factory";

describe("Kit Hierarchy", () => {
  describe("getKitHierarchy", () => {
    it("fetches kit with ancestors and descendants", async () => {
      // Setup: Grandparent -> Parent -> Child
      const grandparent = await createKit({ name: "Grandparent" });
      const parent = await createKit({ name: "Parent", parentKitId: grandparent.id });
      const child = await createKit({ name: "Child", parentKitId: parent.id });
      
      const hierarchy = await getKitHierarchy(parent.id, parent.organizationId);
      
      expect(hierarchy?.parentKit?.id).toBe(grandparent.id);
      expect(hierarchy?.childKits[0]?.id).toBe(child.id);
      expect(hierarchy?.depth).toBe(0);
      expect(hierarchy?.parentKit?.depth).toBe(1);
      expect(hierarchy?.childKits[0]?.depth).toBe(1);
    });
  });
  
  describe("validateKitHierarchy", () => {
    it("prevents circular references", async () => {
      const parent = await createKit({ name: "Parent" });
      const child = await createKit({ name: "Child", parentKitId: parent.id });
      
      await expect(
        validateKitHierarchy(parent.id, child.id, parent.organizationId)
      ).rejects.toThrow("circular reference");
    });
    
    it("prevents self-reference", async () => {
      const kit = await createKit({ name: "Kit" });
      
      await expect(
        validateKitHierarchy(kit.id, kit.id, kit.organizationId)
      ).rejects.toThrow("cannot be its own parent");
    });
    
    // ✅ NEW: Security test for cross-organization access
    it("prevents linking kits from different organizations", async () => {
      const orgAKit = await createKit({ name: "Org A Kit", organizationId: "org-a" });
      const orgBKit = await createKit({ name: "Org B Kit", organizationId: "org-b" });
      
      await expect(
        validateKitHierarchy(orgAKit.id, orgBKit.id, "org-a")
      ).rejects.toThrow("does not belong to your organization");
    });
    
    // ✅ UPDATED: Check total depth (ancestors + descendants)
    it("enforces max depth of 3 levels (total depth)", async () => {
      const level1 = await createKit({ name: "Level 1" });
      const level2 = await createKit({ name: "Level 2", parentKitId: level1.id });
      const level3 = await createKit({ name: "Level 3", parentKitId: level2.id });
      const level4 = await createKit({ name: "Level 4" });
      
      await expect(
        validateKitHierarchy(level4.id, level3.id, level1.organizationId)
      ).rejects.toThrow("Maximum nesting depth");
    });
  });
});
```

---

### Phase 3: Booking Conflict Detection

**Files to Modify:**
- `app/modules/booking/service.server.ts`
- `app/modules/kit/service.server.ts`

**Changes:**

#### Update `getKits()` to include hierarchy in conflict detection

```typescript
// app/modules/kit/service.server.ts (around line 407-463)

import { getKitAncestors, getKitDescendants } from "./hierarchy.server";

export async function getKits({
  organizationId,
  bookingFrom,
  bookingTo,
  hideUnavailable = false,
  // ... other params
}: GetKitsParams) {
  // ... existing code ...
  
  if (hideUnavailable && bookingFrom && bookingTo) {
    // EXISTING: Rule 1 - RESERVED bookings always exclude kits
    const reservedConflicts = {
      assets: {
        none: {
          bookings: {
            some: {
              status: BookingStatus.RESERVED,
              OR: [
                { from: { lte: bookingTo }, to: { gte: bookingFrom } },
                { from: { gte: bookingFrom }, to: { lte: bookingTo } },
              ],
            },
          },
        },
      },
    };
    
    // NEW: Rule 1b - Exclude kits whose CHILDREN have RESERVED bookings
    const childConflicts = {
      childKits: {
        none: {
          assets: {
            some: {
              bookings: {
                some: {
                  status: BookingStatus.RESERVED,
                  OR: [
                    { from: { lte: bookingTo }, to: { gte: bookingFrom } },
                    { from: { gte: bookingFrom }, to: { lte: bookingTo } },
                  ],
                },
              },
            },
          },
        },
      },
    };
    
    // NEW: Rule 1c - Exclude kits whose PARENTS have RESERVED bookings
    // Note: This requires fetching ancestors first, then filtering
    // For performance, we'll do this in a separate query
    
    where.AND = [
      ...(where.AND || []),
      reservedConflicts,
      childConflicts,
    ];
  }
  
  let kits = await db.kit.findMany({
    where,
    include: {
      parentKit: true,
      childKits: true,
      assets: true,
      // ... other includes
    },
    // ... pagination, sorting
  });
  
  // Post-query filtering for parent conflicts (more efficient than nested queries)
  if (hideUnavailable && bookingFrom && bookingTo) {
    kits = await filterKitsWithParentConflicts(kits, bookingFrom, bookingTo, organizationId);
  }
  
  return kits;
}

/**
 * Filter out kits whose ancestors have conflicting bookings
 */
async function filterKitsWithParentConflicts(
  kits: Kit[],
  bookingFrom: Date,
  bookingTo: Date,
  organizationId: string
): Promise<Kit[]> {
  const filteredKits: Kit[] = [];
  
  for (const kit of kits) {
    if (!kit.parentKitId) {
      // No parent, no conflict
      filteredKits.push(kit);
      continue;
    }
    
    // Check if any ancestor has conflicting booking
    const ancestors = await getKitAncestors(kit.id, organizationId);
    const ancestorIds = ancestors.map(a => a.id);
    
    const ancestorConflicts = await db.booking.count({
      where: {
        status: BookingStatus.RESERVED,
        assets: {
          some: {
            kitId: { in: ancestorIds },
          },
        },
        OR: [
          { from: { lte: bookingTo }, to: { gte: bookingFrom } },
          { from: { gte: bookingFrom }, to: { lte: bookingTo } },
        ],
      },
    });
    
    if (ancestorConflicts === 0) {
      filteredKits.push(kit);
    }
  }
  
  return filteredKits;
}
```

#### Add booking validation to check hierarchy

```typescript
// app/modules/booking/service.server.ts

import { getKitAncestors, getKitDescendants } from "../kit/hierarchy.server";

/**
 * Validate that all kits in hierarchy are available for booking
 */
export async function validateKitHierarchyAvailability(
  kitIds: string[],
  bookingFrom: Date,
  bookingTo: Date,
  organizationId: string,
  excludeBookingId?: string // For updates
): Promise<{ valid: boolean; conflicts: string[] }> {
  const conflicts: string[] = [];
  
  for (const kitId of kitIds) {
    // Get all ancestors and descendants
    const [ancestors, descendants] = await Promise.all([
      getKitAncestors(kitId, organizationId),
      getKitDescendants(kitId, organizationId),
    ]);
    
    const relatedKitIds = [
      kitId,
      ...ancestors.map(a => a.id),
      ...descendants.map(d => d.id),
    ];
    
    // Check for conflicting bookings on any related kit
    const conflictingBookings = await db.booking.findMany({
      where: {
        id: excludeBookingId ? { not: excludeBookingId } : undefined,
        organizationId,
        status: { in: [BookingStatus.RESERVED, BookingStatus.ONGOING] },
        assets: {
          some: {
            kitId: { in: relatedKitIds },
          },
        },
        OR: [
          { from: { lte: bookingTo }, to: { gte: bookingFrom } },
          { from: { gte: bookingFrom }, to: { lte: bookingTo } },
        ],
      },
      include: {
        assets: {
          include: {
            kit: true,
          },
        },
      },
    });
    
    if (conflictingBookings.length > 0) {
      for (const booking of conflictingBookings) {
        const conflictedKit = booking.assets.find(a => 
          relatedKitIds.includes(a.kitId || "")
        )?.kit;
        
        conflicts.push(
          `Kit "${conflictedKit?.name}" is unavailable (Booking #${booking.id} from ${booking.from.toLocaleDateString()} to ${booking.to.toLocaleDateString()})`
        );
      }
    }
  }
  
  return {
    valid: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Update createBooking to validate hierarchy
 */
export async function createBooking(data: CreateBookingData) {
  // ... existing validation ...
  
  // NEW: Validate kit hierarchy availability
  const kitIds = data.assets
    .map(a => a.kitId)
    .filter((id): id is string => id !== null);
  
  if (kitIds.length > 0) {
    const hierarchyValidation = await validateKitHierarchyAvailability(
      kitIds,
      data.from,
      data.to,
      data.organizationId
    );
    
    if (!hierarchyValidation.valid) {
      throw new Error(
        `Booking conflicts detected:\n${hierarchyValidation.conflicts.join("\n")}`
      );
    }
  }
  
  // ... proceed with booking creation ...
}
```

**Tests to Add:**

```typescript
// app/modules/booking/service.server.test.ts

describe("Booking with Kit Hierarchy", () => {
  it("prevents booking parent when child is already booked", async () => {
    const parent = await createKit({ name: "Trailer Package" });
    const child = await createKit({ name: "Light Kit", parentKitId: parent.id });
    const childAsset = await createAsset({ kitId: child.id });
    
    // Book child kit
    await createBooking({
      assets: [childAsset],
      from: new Date("2026-01-05"),
      to: new Date("2026-01-10"),
    });
    
    // Try to book parent kit (should fail)
    const parentAsset = await createAsset({ kitId: parent.id });
    await expect(
      createBooking({
        assets: [parentAsset],
        from: new Date("2026-01-01"),
        to: new Date("2026-01-15"),
      })
    ).rejects.toThrow("Light Kit is unavailable");
  });
  
  it("prevents booking child when parent is already booked", async () => {
    const parent = await createKit({ name: "Trailer Package" });
    const child = await createKit({ name: "Light Kit", parentKitId: parent.id });
    const parentAsset = await createAsset({ kitId: parent.id });
    
    // Book parent kit
    await createBooking({
      assets: [parentAsset],
      from: new Date("2026-01-01"),
      to: new Date("2026-01-15"),
    });
    
    // Try to book child kit (should fail)
    const childAsset = await createAsset({ kitId: child.id });
    await expect(
      createBooking({
        assets: [childAsset],
        from: new Date("2026-01-05"),
        to: new Date("2026-01-10"),
      })
    ).rejects.toThrow("Trailer Package is unavailable");
  });
  
  it("allows booking unrelated kits", async () => {
    const kit1 = await createKit({ name: "Kit 1" });
    const kit2 = await createKit({ name: "Kit 2" });
    const asset1 = await createAsset({ kitId: kit1.id });
    const asset2 = await createAsset({ kitId: kit2.id });
    
    await createBooking({
      assets: [asset1],
      from: new Date("2026-01-01"),
      to: new Date("2026-01-10"),
    });
    
    // Should succeed (no hierarchy relationship)
    await expect(
      createBooking({
        assets: [asset2],
        from: new Date("2026-01-05"),
        to: new Date("2026-01-15"),
      })
    ).resolves.toBeDefined();
  });
});
```

---

### Phase 4: UI Components

**Files to Create:**
- `app/components/kit/kit-hierarchy-tree.tsx`
- `app/components/kit/kit-hierarchy-badge.tsx`
- `app/components/kit/kit-parent-selector.tsx`

**Files to Modify:**
- `app/routes/_layout+/kits.$kitId_.edit.tsx`
- `app/routes/_layout+/kits.$kitId.tsx`
- `app/components/booking/booking-conflict-message.tsx`

#### KitHierarchyTree Component

```tsx
// app/components/kit/kit-hierarchy-tree.tsx

import { ChevronDown, ChevronRight, Package } from "lucide-react";
import { useState } from "react";
import type { KitWithHierarchy } from "~/modules/kit/hierarchy.server";

interface KitHierarchyTreeProps {
  kit: KitWithHierarchy;
  onKitClick?: (kitId: string) => void;
  highlightKitId?: string;
}

export function KitHierarchyTree({ kit, onKitClick, highlightKitId }: KitHierarchyTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set([kit.id]));
  
  const toggleNode = (kitId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(kitId)) {
        next.delete(kitId);
      } else {
        next.add(kitId);
      }
      return next;
    });
  };
  
  return (
    <div className="kit-hierarchy-tree">
      <KitNode
        kit={kit}
        depth={0}
        expanded={expandedNodes.has(kit.id)}
        onToggle={() => toggleNode(kit.id)}
        onClick={onKitClick}
        highlighted={highlightKitId === kit.id}
      />
      
      {expandedNodes.has(kit.id) && kit.childKits.length > 0 && (
        <div className="ml-6 border-l-2 border-gray-200 pl-4">
          {kit.childKits.map(child => (
            <KitHierarchyTree
              key={child.id}
              kit={child}
              onKitClick={onKitClick}
              highlightKitId={highlightKitId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KitNode({
  kit,
  depth,
  expanded,
  onToggle,
  onClick,
  highlighted,
}: {
  kit: KitWithHierarchy;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onClick?: (kitId: string) => void;
  highlighted: boolean;
}) {
  const hasChildren = kit.childKits.length > 0;
  
  return (
    <div
      className={`flex items-center gap-2 py-2 px-3 rounded-md hover:bg-gray-50 cursor-pointer ${
        highlighted ? "bg-blue-50 border border-blue-200" : ""
      }`}
      onClick={() => onClick?.(kit.id)}
    >
      {hasChildren ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="p-1 hover:bg-gray-200 rounded"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      ) : (
        <div className="w-6" />
      )}
      
      <Package size={18} className="text-gray-600" />
      
      <div className="flex-1">
        <div className="font-medium">{kit.name}</div>
        {kit.description && (
          <div className="text-sm text-gray-500">{kit.description}</div>
        )}
      </div>
      
      {hasChildren && (
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
          {kit.childKits.length} {kit.childKits.length === 1 ? "item" : "items"}
        </span>
      )}
    </div>
  );
}
```

#### KitHierarchyBadge Component

```tsx
// app/components/kit/kit-hierarchy-badge.tsx

import { Package, Layers } from "lucide-react";

interface KitHierarchyBadgeProps {
  hasParent: boolean;
  hasChildren: boolean;
  childCount?: number;
}

export function KitHierarchyBadge({ hasParent, hasChildren, childCount }: KitHierarchyBadgeProps) {
  if (!hasParent && !hasChildren) {
    return null; // Standalone kit, no badge needed
  }
  
  if (hasChildren) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
        <Layers size={12} />
        Bundle {childCount ? `(${childCount})` : ""}
      </span>
    );
  }
  
  if (hasParent) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
        <Package size={12} />
        Part of bundle
      </span>
    );
  }
  
  return null;
}
```

#### KitParentSelector Component

```tsx
// app/components/kit/kit-parent-selector.tsx

import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { Search, X } from "lucide-react";
import type { Kit } from "@prisma/client";

interface KitParentSelectorProps {
  currentKitId: string;
  currentParentKitId?: string | null;
  organizationId: string;
  onChange: (parentKitId: string | null) => void;
}

export function KitParentSelector({
  currentKitId,
  currentParentKitId,
  organizationId,
  onChange,
}: KitParentSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedParent, setSelectedParent] = useState<Kit | null>(null);
  const fetcher = useFetcher<{ kits: Kit[] }>();
  
  useEffect(() => {
    if (searchQuery.length > 2) {
      fetcher.load(`/api/kits/search?q=${searchQuery}&excludeKitId=${currentKitId}`);
    }
  }, [searchQuery, currentKitId]);
  
  const handleSelect = (kit: Kit) => {
    setSelectedParent(kit);
    onChange(kit.id);
    setSearchQuery("");
  };
  
  const handleClear = () => {
    setSelectedParent(null);
    onChange(null);
  };
  
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        Parent Kit (Optional)
      </label>
      
      {selectedParent ? (
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md border border-gray-200">
          <div className="flex-1">
            <div className="font-medium">{selectedParent.name}</div>
            {selectedParent.description && (
              <div className="text-sm text-gray-500">{selectedParent.description}</div>
            )}
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="p-1 hover:bg-gray-200 rounded"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={16} className="text-gray-400" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for parent kit..."
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          />
          
          {fetcher.data?.kits && fetcher.data.kits.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
              {fetcher.data.kits.map((kit) => (
                <button
                  key={kit.id}
                  type="button"
                  onClick={() => handleSelect(kit)}
                  className="w-full text-left px-4 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                >
                  <div className="font-medium">{kit.name}</div>
                  {kit.description && (
                    <div className="text-sm text-gray-500">{kit.description}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      
      <p className="text-sm text-gray-500">
        This kit will be included when the parent kit is booked.
      </p>
    </div>
  );
}
```

#### Update Kit Edit Route

```tsx
// app/routes/_layout+/kits.$kitId_.edit.tsx

import { KitParentSelector } from "~/components/kit/kit-parent-selector";
import { validateKitHierarchy } from "~/modules/kit/hierarchy.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const parentKitId = formData.get("parentKitId") as string | null;
  
  // Validate hierarchy if parent is being set
  if (parentKitId) {
    try {
      await validateKitHierarchy(params.kitId!, parentKitId, organizationId);
    } catch (error) {
      return json(
        { error: { message: error.message, field: "parentKitId" } },
        { status: 400 }
      );
    }
  }
  
  // Update kit with new parent
  await db.kit.update({
    where: { id: params.kitId },
    data: {
      parentKitId: parentKitId || null,
      // ... other fields
    },
  });
  
  return redirect(`/kits/${params.kitId}`);
}

export default function EditKit() {
  const { kit } = useLoaderData<typeof loader>();
  const [parentKitId, setParentKitId] = useState(kit.parentKitId);
  
  return (
    <Form method="post">
      {/* ... existing fields ... */}
      
      <KitParentSelector
        currentKitId={kit.id}
        currentParentKitId={kit.parentKitId}
        organizationId={kit.organizationId}
        onChange={setParentKitId}
      />
      
      <input type="hidden" name="parentKitId" value={parentKitId || ""} />
      
      {/* ... submit button ... */}
    </Form>
  );
}
```

#### Update Kit Detail Page

```tsx
// app/routes/_layout+/kits.$kitId.tsx

import { KitHierarchyTree } from "~/components/kit/kit-hierarchy-tree";
import { KitHierarchyBadge } from "~/components/kit/kit-hierarchy-badge";
import { getKitHierarchy } from "~/modules/kit/hierarchy.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const kitWithHierarchy = await getKitHierarchy(params.kitId!, organizationId);
  
  return json({ kit: kitWithHierarchy });
}

export default function KitDetail() {
  const { kit } = useLoaderData<typeof loader>();
  
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-3xl font-bold">{kit.name}</h1>
        <KitHierarchyBadge
          hasParent={!!kit.parentKitId}
          hasChildren={kit.childKits.length > 0}
          childCount={kit.childKits.length}
        />
      </div>
      
      {kit.parentKit && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <h3 className="text-sm font-medium text-blue-900 mb-2">Part of Bundle</h3>
          <Link to={`/kits/${kit.parentKit.id}`} className="text-blue-700 hover:underline">
            {kit.parentKit.name}
          </Link>
        </div>
      )}
      
      {kit.childKits.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">Bundle Contents</h3>
          <KitHierarchyTree kit={kit} />
        </div>
      )}
      
      {/* ... rest of kit details ... */}
    </div>
  );
}
```

---

### Phase 5: API Endpoints

**Files to Create:**
- `app/routes/api+/kits.search.ts` (for parent selector)
- `app/routes/api+/kits.validate-hierarchy.ts` (for client-side validation)

```typescript
// app/routes/api+/kits.search.ts

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/database/db.server";
import { requireAuthSession } from "~/modules/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { organizationId } = await requireAuthSession(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const excludeKitId = url.searchParams.get("excludeKitId");
  
  const kits = await db.kit.findMany({
    where: {
      organizationId,
      id: excludeKitId ? { not: excludeKitId } : undefined,
      name: {
        contains: query,
        mode: "insensitive",
      },
    },
    take: 10,
    orderBy: { name: "asc" },
  });
  
  return json({ kits });
}
```

```typescript
// app/routes/api+/kits.validate-hierarchy.ts

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { validateKitHierarchy } from "~/modules/kit/hierarchy.server";
import { requireAuthSession } from "~/modules/auth/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const { organizationId } = await requireAuthSession(request);
  const { kitId, parentKitId } = await request.json();
  
  try {
    await validateKitHierarchy(kitId, parentKitId, organizationId);
    return json({ valid: true });
  } catch (error) {
    return json(
      { valid: false, error: error.message },
      { status: 400 }
    );
  }
}
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] **FR1**: Admin can set a parent kit for any kit (creating hierarchy)
- [ ] **FR2**: Admin can remove a kit from a parent (breaking hierarchy)
- [ ] **FR3**: System prevents circular references (Kit A → Kit B → Kit A)
- [ ] **FR4**: System prevents self-reference (Kit A → Kit A)
- [ ] **FR5**: System enforces maximum nesting depth of 3 levels
- [ ] **FR6**: When parent kit is booked, all child kits become unavailable for same dates
- [ ] **FR7**: When child kit is booked, all parent kits become unavailable for same dates
- [ ] **FR8**: Booking conflict error messages clearly indicate which kit in hierarchy is causing conflict
- [ ] **FR9**: Kit detail page shows parent kit (if exists) with link
- [ ] **FR10**: Kit detail page shows child kits (if exist) in tree view
- [ ] **FR11**: Kit search results display hierarchy badges (parent/child/standalone)
- [ ] **FR12**: Kit edit form includes parent kit selector with search
- [ ] **FR13**: Availability calendar shows different colors for direct vs. hierarchical unavailability
- [ ] **FR14**: Bulk operations show preview of affected kits in hierarchy
- [ ] **FR15**: Activity notes created for all hierarchy changes

### Non-Functional Requirements

- [ ] **NFR1**: Hierarchy queries complete in < 100ms for 3-level depth
- [ ] **NFR2**: Booking conflict detection completes in < 500ms with 1000 kits
- [ ] **NFR3**: Database migration completes without data loss
- [ ] **NFR4**: All hierarchy operations use database transactions
- [ ] **NFR5**: Circular reference prevention works at database level (trigger)
- [ ] **NFR6**: UI remains responsive with 100+ kits in hierarchy tree
- [ ] **NFR7**: WCAG 2.1 AA compliance for all new UI components
- [ ] **NFR8**: Mobile-responsive hierarchy visualization

### Quality Gates

- [ ] **QG1**: All unit tests pass (hierarchy, booking, validation)
- [ ] **QG2**: Integration tests cover all booking conflict scenarios
- [ ] **QG3**: E2E tests cover complete user flows (create hierarchy, book parent, book child)
- [ ] **QG4**: Code review approval from maintainer
- [ ] **QG5**: No TypeScript errors or warnings
- [ ] **QG6**: Prisma schema validation passes
- [ ] **QG7**: Database migration tested on staging environment
- [ ] **QG8**: Performance benchmarks meet targets
- [ ] **QG9**: Accessibility audit passes (keyboard navigation, screen readers)
- [ ] **QG10**: Documentation updated (user guide, API docs, CLAUDE.md)

## Success Metrics

**User Adoption:**
- 50% of organizations create at least one kit hierarchy within 30 days
- Average of 3 nested kits per organization

**Operational Efficiency:**
- 80% reduction in double-booking incidents for bundled kits
- 90% of users successfully create hierarchy without errors

**Performance:**
- < 100ms average hierarchy fetch time
- < 500ms average booking conflict detection time
- Zero circular reference errors in production

**Quality:**
- Zero data integrity issues (orphaned kits, circular refs)
- < 5% error rate on hierarchy operations
- 95% user satisfaction with hierarchy UI (post-launch survey)

## Dependencies & Risks

### Dependencies

**Internal:**
- ✅ Existing Location hierarchy pattern (proven, ready to use)
- ✅ Existing booking conflict detection system (well-tested)
- ✅ Existing activity notes system (ready for hierarchy events)
- ⚠️ Database migration tooling (Prisma migrations)

**External:**
- ✅ PostgreSQL 12+ (supports recursive CTEs)
- ✅ Prisma 6.2.1+ (supports self-referential relations)

### Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Circular reference bugs** | High | Medium | Database trigger + application validation + comprehensive tests |
| **Performance degradation with deep nesting** | Medium | Low | Enforce max depth of 3 levels, add database indexes |
| **Migration breaks existing bookings** | High | Low | Use transactions, test on staging, have rollback plan |
| **Race conditions in concurrent bookings** | High | Medium | Use database transactions, optimistic locking |
| **Complex UI confuses users** | Medium | Medium | User testing, clear documentation, progressive disclosure |
| **N+1 query problems** | Medium | Medium | Use Prisma includes, monitor query performance |
| **Backwards compatibility issues** | Medium | Low | Maintain existing API, add new fields as optional |

### Risk Mitigation Strategies

**Circular Reference Prevention:**
- Database trigger (first line of defense)
- Application validation (second line of defense)
- Unit tests covering all circular reference scenarios
- E2E tests simulating user attempts to create circular refs

**Performance Optimization:**
- Database indexes on `parentKitId` and booking date ranges
- Limit max depth to 3 levels
- Use recursive CTEs (efficient in PostgreSQL)
- Monitor query performance in production
- Consider caching for frequently accessed hierarchies (future)

**Migration Safety:**
- Test migration on staging database first
- Use database transactions (rollback on error)
- Create backup before migration
- Validate data integrity post-migration
- Have rollback script ready

**Race Condition Prevention:**
- Use database transactions for all booking operations
- Server-side validation (never trust client)
- Optimistic locking for concurrent hierarchy modifications
- Integration tests simulating concurrent requests

## References & Research

### Internal References

**Existing Patterns:**
- Location hierarchy: `app/database/schema.prisma` (Lines 597-600)
- Booking conflicts: `docs/booking-conflict-queries.md`
- Bulk operations: `docs/select-all-pattern.md`
- Kit service: `app/modules/kit/service.server.ts` (Lines 1969-2230)
- Booking service: `app/modules/booking/service.server.ts` (Lines 837, 1103)

**Architecture Guidance:**
- Development patterns: `CLAUDE.md` (Lines 93-335)
- Testing philosophy: `CLAUDE.md` (Lines 238-335)
- Form validation: `CLAUDE.md` (Lines 93-178)

### External References

**PostgreSQL Documentation:**
- Recursive CTEs: https://www.postgresql.org/docs/current/queries-with.html
- Triggers: https://www.postgresql.org/docs/current/sql-createtrigger.html
- CHECK constraints: https://www.postgresql.org/docs/current/ddl-constraints.html

**Prisma Documentation:**
- Self-relations: https://www.prisma.io/docs/concepts/components/prisma-schema/relations/self-relations
- Recursive queries: https://www.prisma.io/docs/concepts/components/prisma-client/aggregation-grouping-summarizing#recursive-queries

**React Router Documentation:**
- Loaders and actions: https://reactrouter.com/en/main/route/loader
- Form handling: https://reactrouter.com/en/main/components/form

### Related Work

**GitHub Discussion:**
- Original feature request: https://github.com/orgs/Shelf-nu/discussions/2305

**Similar Implementations:**
- Location hierarchy (existing in codebase)
- Category hierarchy (potential future pattern)

---

## Implementation Checklist

### Phase 0: Backup & Safety Preparation ⚠️ (MANDATORY - Do First!)
- [ ] **Supabase Database Backup**
  - [ ] Create manual backup in Supabase Dashboard
  - [ ] Name backup: "pre-kit-bundling-2026-02-17"
  - [ ] Download backup file locally
  - [ ] Verify backup file size (should be > 1MB)
  - [ ] Store backup in safe location (~/backups/)
- [ ] **Git Feature Branch**
  - [ ] Create branch: `feature/kit-bundling`
  - [ ] Commit plan documents
  - [ ] Push branch to remote (GitHub backup)
  - [ ] Verify main branch untouched
- [ ] **Docker Container Snapshot** (Optional)
  - [ ] Create container snapshot
  - [ ] Tag: `shelf-nu-backup:pre-kit-bundling-2026-02-17`
  - [ ] Verify snapshot in `docker images`
  - [ ] Optional: Export snapshot to file
- [ ] **Staging Environment**
  - [ ] Create Supabase branch OR local PostgreSQL
  - [ ] Configure `.env.local` with staging connection
  - [ ] Run existing migrations on staging
  - [ ] Verify staging database schema
- [ ] **Rollback Procedures**
  - [ ] Create rollback SQL script
  - [ ] Document rollback guide
  - [ ] Test rollback on staging
  - [ ] Verify backup restoration works
- [ ] **Pre-Implementation Validation**
  - [ ] Verify all backups exist
  - [ ] Verify git branch active
  - [ ] Verify staging database ready
  - [ ] Run existing tests (all pass)
  - [ ] Run `npm run validate` (passes)
- [ ] **Communication**
  - [ ] Notify development team
  - [ ] Notify stakeholders
  - [ ] Schedule implementation window
  - [ ] Set up monitoring dashboards

**⚠️ DO NOT PROCEED until all Phase 0 items are complete!**

**Estimated Time:** 2-4 hours

---

### Phase 1: Database Schema ✅
- [ ] Add `parentKitId` column to Kit table
- [ ] Add self-referential foreign key constraint
- [ ] Add CHECK constraint to prevent self-reference
- [ ] Add composite index on `[organizationId, parentKitId]`
- [ ] Create trigger to prevent circular references
- [ ] Test migration on staging database
- [ ] Validate data integrity post-migration

### Phase 2: Service Layer ✅
- [ ] Create `hierarchy.server.ts` with utility functions
- [ ] Implement `getKitHierarchy()` with recursive CTE
- [ ] Implement `getKitAncestors()` for parent chain
- [ ] Implement `getKitDescendants()` for child tree
- [ ] Implement `validateKitHierarchy()` for circular ref prevention
- [ ] Write unit tests for all hierarchy functions
- [ ] Test max depth enforcement
- [ ] Test circular reference prevention

### Phase 3: Booking Logic ✅
- [ ] Update `getKits()` to filter by hierarchy conflicts
- [ ] Implement `filterKitsWithParentConflicts()` helper
- [ ] Create `validateKitHierarchyAvailability()` function
- [ ] Update `createBooking()` to validate hierarchy
- [ ] Update `updateBooking()` to validate hierarchy
- [ ] Write integration tests for booking conflicts
- [ ] Test concurrent booking scenarios
- [ ] Test all conflict permutations (parent/child/grandchild)

### Phase 4: UI Components ✅
- [ ] Create `KitHierarchyTree` component
- [ ] Create `KitHierarchyBadge` component
- [ ] Create `KitParentSelector` component
- [ ] Update kit edit route with parent selector
- [ ] Update kit detail page with hierarchy display
- [ ] Update booking conflict messages
- [ ] Update availability calendar with hierarchy colors
- [ ] Test keyboard navigation and accessibility
- [ ] Test mobile responsiveness

### Phase 5: API Endpoints ✅
- [ ] Create `/api/kits/search` endpoint
- [ ] Create `/api/kits/validate-hierarchy` endpoint
- [ ] Add error handling and validation
- [ ] Write API tests
- [ ] Document API endpoints

### Phase 6: Testing & QA
- [ ] Run all unit tests
- [ ] Run all integration tests
- [ ] Create E2E tests for user flows
- [ ] Performance testing (1000+ kits)
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Cross-browser testing
- [ ] Mobile device testing
- [ ] Load testing (concurrent bookings)

### Phase 7: Documentation
- [ ] Update user guide with hierarchy instructions
- [ ] Create admin guide for managing hierarchies
- [ ] Document API endpoints
- [ ] Update CLAUDE.md with new patterns
- [ ] Create troubleshooting guide
- [ ] Record demo video (optional)

### Phase 8: Deployment
- [ ] Review all code changes
- [ ] Run final test suite
- [ ] Create database backup
- [ ] Deploy to staging
- [ ] Validate staging environment
- [ ] Deploy to production
- [ ] Monitor error rates and performance
- [ ] Gather user feedback

---

## Future Considerations

### Potential Enhancements (Post-MVP)

**Multiple Parents Support:**
- Allow kit to belong to multiple parent kits
- Requires junction table instead of self-referential FK
- More complex availability calculations

**Kit Templates:**
- Save kit hierarchy as template
- Clone hierarchy structure for new kits
- Useful for creating similar bundles

**Pricing Logic:**
- Bundle pricing (discount vs. individual)
- Revenue attribution for nested kits
- Pricing tiers based on hierarchy

**Advanced Availability:**
- Partial availability (some children available)
- Substitute kits (if child unavailable, suggest alternative)
- Availability forecasting

**Reporting & Analytics:**
- Kit utilization by hierarchy level
- Most popular bundles
- Revenue by bundle vs. individual rentals

**Performance Optimizations:**
- Materialized path for faster ancestor queries
- Denormalized availability cache
- Background job for availability recalculation

### Extensibility

This implementation is designed to be extended:

- **Data model**: Can add junction table for multiple parents
- **Depth limit**: Can increase from 3 to higher (with performance testing)
- **Validation**: Can add custom business rules per organization
- **UI**: Can add drag-and-drop hierarchy builder
- **API**: Can expose hierarchy endpoints for integrations

---

## Notes

**Design Decisions:**

1. **Single Parent Model**: Chose self-referential FK over junction table for simplicity. Can migrate to junction table later if multiple parents needed.

2. **Max Depth of 3**: Balances flexibility with performance. Most real-world use cases (Trailer → Light Kit → Individual Light) fit within 3 levels.

3. **Recursive CTE**: PostgreSQL-native, efficient for moderate depth. Avoids N+1 queries.

4. **Database + Application Validation**: Defense in depth. Database trigger prevents data corruption, application validation provides better error messages.

5. **Color-Coded Availability**: Red (direct booking), Orange (parent booking), Yellow (child booking). Clear visual distinction.

6. **Activity Notes**: Reuse existing system for audit trail. No new logging infrastructure needed.

**Open Questions:**

- Should we allow kits with active bookings to be added/removed from hierarchy? (Current plan: block)
- Should we snapshot child kits at booking time? (Current plan: yes, for historical accuracy)
- Should we support kit templates/cloning? (Current plan: post-MVP)

**Assumptions:**

- Users understand hierarchical relationships (parent/child concept)
- Maximum 3 levels of nesting is sufficient for most use cases
- Booking a parent always includes ALL children (no customization)
- Existing bookings will honor new hierarchy rules retroactively

---

## ERD: Kit Hierarchy Data Model

```mermaid
erDiagram
    Kit ||--o{ Kit : "has children"
    Kit }o--|| Kit : "has parent"
    Kit ||--o{ Asset : "contains"
    Kit }o--|| Organization : "belongs to"
    Kit }o--o| Category : "categorized by"
    Kit }o--o| Location : "located at"
    Booking }o--o{ Asset : "books"
    
    Kit {
        string id PK
        string name
        string description
        string parentKitId FK "nullable, self-referential"
        string organizationId FK
        string categoryId FK
        string locationId FK
        enum status "AVAILABLE, IN_CUSTODY, CHECKED_OUT"
        datetime createdAt
        datetime updatedAt
    }
    
    Asset {
        string id PK
        string kitId FK "nullable"
        string organizationId FK
        enum status
    }
    
    Booking {
        string id PK
        datetime from
        datetime to
        enum status "RESERVED, ONGOING, COMPLETE, etc."
    }
    
    Organization {
        string id PK
        string name
    }
    
    Category {
        string id PK
        string name
    }
    
    Location {
        string id PK
        string name
        string parentId FK "nullable, self-referential"
    }
```

**Key Relationships:**

- **Kit → Kit (parentKitId)**: Self-referential, nullable, ON DELETE SET NULL
- **Kit → Asset**: One-to-many, existing relationship
- **Booking → Asset**: Many-to-many (implicit join table)
- **Location → Location**: Self-referential hierarchy (existing pattern to follow)

**Indexes:**

- `Kit(organizationId, parentKitId)` - Composite index for hierarchy queries
- `Booking(kitId, from, to)` - Composite index for conflict detection
- `Asset(kitId)` - Existing index for kit-asset relationship

**Constraints:**

- `CHECK (parentKitId != id)` - Prevent self-reference
- `TRIGGER prevent_kit_circular_reference` - Prevent circular references
- `FOREIGN KEY (parentKitId) REFERENCES Kit(id) ON DELETE SET NULL` - Orphan children if parent deleted

---

## Glossary

**Terms:**

- **Parent Kit**: A kit that contains other kits (e.g., "Trailer Package")
- **Child Kit**: A kit that belongs to a parent kit (e.g., "Light Kit")
- **Hierarchy**: The tree structure of parent-child relationships
- **Circular Reference**: Invalid state where Kit A → Kit B → Kit A
- **Self-Reference**: Invalid state where Kit A → Kit A
- **Depth**: Number of levels in hierarchy (0 = root, 1 = child, 2 = grandchild)
- **Ancestor**: Any parent, grandparent, or higher in the tree
- **Descendant**: Any child, grandchild, or lower in the tree
- **Recursive CTE**: SQL query technique for traversing hierarchical data
- **Materialized Path**: Alternative hierarchy storage (e.g., "/1/2/3")
- **Closure Table**: Alternative hierarchy storage (separate table for all paths)

---

**Plan Status**: Active  
**Created**: 2026-02-17  
**Last Updated**: 2026-02-17 (v2.0 - Revised after technical review)  
**Estimated Effort**: 2 weeks + 4 hours backup prep (1 developer)  
**Priority**: High  
**Complexity**: Medium-High  
**Risk Level**: Low (after Phase 0 backup & critical fixes applied)

---

## Timeline Summary

| Phase | Duration | Description |
|-------|----------|-------------|
| **Phase 0** | 2-4 hours | Backup & safety preparation (MANDATORY) |
| **Phase 1** | 1 day | Database schema with critical indexes |
| **Phase 2** | 2 days | Service layer with security fixes |
| **Phase 3** | 2 days | Booking logic with transaction safety |
| **Phase 4** | 2 days | UI components (simplified) |
| **Phase 5** | 1 day | API endpoints with validation |
| **Phase 6** | 2 days | Testing & QA |
| **Phase 7** | 1 day | Documentation |
| **Phase 8** | 1 day | Deployment |
| **TOTAL** | **2 weeks + 4 hours** | Full implementation |

**Original Estimate**: 3-4 weeks  
**Revised Estimate**: 2 weeks (50% faster with simplifications)  
**Phase 0 Overhead**: 2-4 hours (one-time, critical for safety)
