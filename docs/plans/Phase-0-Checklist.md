---
title: Phase 0 Backup & Safety Checklist
type: checklist
status: pending
date: 2026-02-17
related_plan: 2026-02-17-feat-kit-bundling-nested-kits-plan.md
---

# Phase 0: Backup & Safety Preparation Checklist

**⚠️ MANDATORY: Complete ALL items before starting implementation**

This checklist ensures you have comprehensive backups and rollback options before making any code or database changes.

---

## ✅ 0.1: Supabase Database Backup

### Primary Backup (Supabase Dashboard)
- [ ] Navigate to Supabase Dashboard → Database → Backups
- [ ] Click "Create Backup" (manual backup)
- [ ] Name: `pre-kit-bundling-2026-02-17`
- [ ] Wait for backup to complete
- [ ] Download backup file locally
- [ ] Verify backup file size (should be > 1MB)
- [ ] Store in: `~/backups/shelf-nu-pre-kit-bundling-2026-02-17.sql`

### Alternative Backup (pg_dump)
```bash
# If you have direct database access
pg_dump $DATABASE_URL > ~/backups/shelf-nu-pre-kit-bundling-$(date +%Y%m%d-%H%M%S).sql

# Verify backup
ls -lh ~/backups/shelf-nu-pre-kit-bundling-*.sql
```

### Verification
- [ ] Backup file exists
- [ ] Backup file size > 1MB
- [ ] Backup timestamp is today
- [ ] Backup stored in safe location (not in project directory)

**Status**: ⬜ Not Started | ⏳ In Progress | ✅ Complete

---

## ✅ 0.2: Git Feature Branch

### Create Branch
```bash
cd /Users/williamvest/Projects/shelf.nu

# Ensure on main and up to date
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/kit-bundling

# Commit plan documents
git add docs/plans/
git commit -m "docs: add kit bundling implementation plan with Phase 0 backup procedures"
```

### Push to Remote (if you have fork)
```bash
# If you have a fork, add it as remote
git remote add fork https://github.com/YOUR-USERNAME/shelf.nu.git

# Push to your fork
git push -u fork feature/kit-bundling
```

### Verification
- [x] Feature branch created: `feature/kit-bundling`
- [x] Plan documents committed (commit: 27b99d111)
- [ ] Branch pushed to remote (GitHub backup)
- [x] Main branch remains untouched
- [x] No uncommitted changes

**Status**: ✅ Complete (local only - need to push to fork)

**Note**: You need to create a fork of Shelf-nu/shelf.nu on GitHub first, then push to your fork.

---

## ✅ 0.3: Docker Container Snapshot (Optional)

### Create Snapshot
```bash
# List running containers
docker ps

# Create snapshot
docker commit <container-id> shelf-nu-backup:pre-kit-bundling-2026-02-17

# Verify
docker images | grep shelf-nu-backup

# Optional: Export to file
docker save shelf-nu-backup:pre-kit-bundling-2026-02-17 | gzip > ~/backups/shelf-nu-docker-backup-$(date +%Y%m%d).tar.gz
```

### Verification
- [ ] Container snapshot created
- [ ] Snapshot visible in `docker images`
- [ ] Optional: Snapshot exported to file
- [ ] Snapshot tagged with date

**Status**: ⬜ Not Started | ⏳ In Progress | ✅ Complete | ⊘ Skipped (not using Docker)

---

## ✅ 0.4: Staging/Development Environment

### Option A: Supabase Database Branch (Recommended)
```bash
# In Supabase Dashboard:
# 1. Navigate to Database → Branches
# 2. Click "Create Branch"
# 3. Name: "kit-bundling-dev"
# 4. Source: Production database
# 5. Copy connection string

# Update .env.local
echo "DATABASE_URL=<branch-connection-string>" >> .env.local
echo "DIRECT_URL=<branch-connection-string>" >> .env.local
```

### Option B: Local PostgreSQL Database
```bash
# Create local PostgreSQL container
docker run -d \
  --name shelf-nu-dev-db \
  -e POSTGRES_PASSWORD=devpassword \
  -e POSTGRES_DB=shelf_nu_dev \
  -e POSTGRES_USER=postgres \
  -p 5433:5432 \
  postgres:15

# Update .env.local
cat > .env.local << EOF
DATABASE_URL=postgresql://postgres:devpassword@localhost:5433/shelf_nu_dev
DIRECT_URL=postgresql://postgres:devpassword@localhost:5433/shelf_nu_dev
EOF

# Run existing migrations
npm run setup

# Verify database
psql postgresql://postgres:devpassword@localhost:5433/shelf_nu_dev -c "\dt"
```

### Verification
- [ ] Staging database created (Supabase branch OR local PostgreSQL)
- [ ] Connection string configured in `.env.local`
- [ ] Existing migrations run successfully
- [ ] Database schema matches production
- [ ] Can connect to staging database

**Status**: ⬜ Not Started | ⏳ In Progress | ✅ Complete

---

## ✅ 0.5: Rollback Procedures

### Create Rollback Script
```bash
# Create rollback directory
mkdir -p docs/rollback

# Create rollback SQL script
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
```

### Test Rollback on Staging
```bash
# Apply migration to staging
npm run db:prepare-migration
npm run setup

# Test rollback
psql $DATABASE_URL < docs/rollback/rollback-kit-bundling.sql

# Verify rollback worked
psql $DATABASE_URL -c "\d Kit" | grep parentKitId
# Should return no results
```

### Verification
- [ ] Rollback SQL script created
- [ ] Rollback guide documented (see plan)
- [ ] Rollback tested on staging database
- [ ] Rollback script works without errors
- [ ] Database returns to original state after rollback

**Status**: ⬜ Not Started | ⏳ In Progress | ✅ Complete

---

## ✅ 0.6: Pre-Implementation Validation

### Run Validation Commands
```bash
# 1. Verify backups exist
ls -lh ~/backups/shelf-nu-pre-kit-bundling-*.sql

# 2. Verify git branch
git branch --show-current
# Should output: feature/kit-bundling

# 3. Verify staging database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Kit\";"

# 4. Verify no uncommitted changes
git status
# Should show clean working tree

# 5. Run existing tests
npm run test

# 6. Verify validation pipeline
npm run validate
```

### Verification
- [ ] All backups exist and verified
- [ ] Git feature branch active
- [ ] Staging database ready and accessible
- [ ] No uncommitted changes in working directory
- [ ] All existing tests passing
- [ ] Validation pipeline passing (`npm run validate`)

**Status**: ⬜ Not Started | ⏳ In Progress | ✅ Complete

---

## ✅ 0.7: Communication & Monitoring

### Stakeholder Notification
- [ ] Development team notified
- [ ] QA team notified (if applicable)
- [ ] Product owner notified
- [ ] DevOps/Infrastructure team notified (if applicable)

### Implementation Schedule
- [ ] Low-traffic period identified for production deployment
- [ ] Implementation window scheduled (2-4 hours)
- [ ] Rollback team identified and available
- [ ] Communication channels established (Slack, email, etc.)

### Monitoring Setup
- [ ] Database query performance monitoring enabled
- [ ] Error rate monitoring enabled
- [ ] Application performance monitoring enabled
- [ ] Alerts configured for anomalies

**Status**: ⬜ Not Started | ⏳ In Progress | ✅ Complete

---

## 📊 Phase 0 Completion Summary

### Required Items (Must Complete)
- [ ] 0.1: Supabase Database Backup
- [ ] 0.2: Git Feature Branch (local complete, need remote push)
- [ ] 0.4: Staging/Development Environment
- [ ] 0.5: Rollback Procedures
- [ ] 0.6: Pre-Implementation Validation

### Optional Items (Recommended)
- [ ] 0.3: Docker Container Snapshot
- [ ] 0.7: Communication & Monitoring

### Overall Status
- **Started**: 2026-02-17
- **Completed**: ___________
- **Duration**: _____ hours
- **Ready for Phase 1**: ⬜ No | ✅ Yes

---

## ⚠️ STOP! Do Not Proceed Until:

✅ All required items are checked  
✅ All backups are verified  
✅ Staging environment is ready  
✅ Rollback procedures are tested  
✅ Team is notified  

**Once all items are complete, you may proceed to Phase 1: Database Schema**

---

## 📝 Notes & Issues

Use this section to document any issues encountered during Phase 0:

```
Date: 2026-02-17
Issue: Cannot push to origin (Shelf-nu/shelf.nu) - permission denied
Resolution: Need to create fork and push to personal fork instead
Status: Pending

Date: ___________
Issue: ___________
Resolution: ___________
Status: ___________
```

---

## 🔗 Related Documents

- **Implementation Plan**: `docs/plans/2026-02-17-feat-kit-bundling-nested-kits-plan.md`
- **Technical Review**: `docs/plans/2026-02-17-feat-kit-bundling-TECHNICAL-REVIEW.md`
- **Critical Fixes**: `docs/plans/2026-02-17-feat-kit-bundling-CRITICAL-FIXES.md`
- **Rollback Guide**: `docs/rollback/ROLLBACK-GUIDE.md` (to be created in 0.5)

---

**Last Updated**: 2026-02-17  
**Checklist Version**: 1.0  
**Estimated Time**: 2-4 hours
