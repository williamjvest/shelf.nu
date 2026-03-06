# Kit Bundling Rollback Guide

**Created**: 2026-03-06  
**Feature**: Kit Bundling (Nested Kits)  
**Branch**: feature/kit-bundling

## When to Rollback

Rollback if you encounter:
- Data corruption or integrity issues
- Critical bugs that cannot be fixed quickly
- Performance degradation in production
- Circular reference bugs that bypass validation
- Security vulnerabilities in hierarchy implementation

## Prerequisites

Before rolling back, you must have:
- [ ] Database backup from before migration (`~/backups/shelf-nu-pre-kit-bundling-2026-03-06.sql`)
- [ ] Access to production database (or staging for testing)
- [ ] Downtime window scheduled (15-30 minutes)
- [ ] Team notified of rollback

## Rollback Steps

### Option A: Full Database Restore (Recommended for Critical Issues)

**Use when**: Data corruption, major integrity issues, or you need to preserve all data before migration

```bash
# 1. Stop application
# (Steps depend on deployment method - systemd, Docker, etc.)

# 2. Restore from backup
psql $DATABASE_URL < ~/backups/shelf-nu-pre-kit-bundling-2026-03-06.sql

# 3. Verify restoration
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Kit\";"
psql $DATABASE_URL -c "\d Kit" | grep parentKitId
# Should return no results for parentKitId

# 4. Restart application

# 5. Smoke test critical flows
```

**Time estimate**: 15-30 minutes (depends on database size)

---

### Option B: Rollback Migration Only (Faster, Less Disruptive)

**Use when**: Migration breaks production, but no data corruption occurred

```bash
# 1. Run rollback SQL script
psql $DATABASE_URL < docs/rollback/rollback-kit-bundling.sql

# 2. Verify rollback
psql $DATABASE_URL -c "\d Kit" | grep parentKitId
# Should return no results

# 3. Check for orphaned data
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Kit\" WHERE \"parentKitId\" IS NOT NULL;"
# Should return error (column doesn't exist) - this is good!
```

**Time estimate**: 2-5 minutes

---

### Option C: Code Rollback (Keep Database, Revert Code)

**Use when**: Migration succeeded, but application code has bugs

```bash
# 1. Switch back to main branch
cd ~/shelf.nu
git checkout main

# 2. Redeploy application
# (Deployment steps depend on setup)

# 3. Database can keep new columns (they won't be used)
# No data loss, easy to re-enable later
```

**Time estimate**: 5-10 minutes

---

## Post-Rollback Verification

After rolling back, verify the following:

### Database Schema
```bash
# Kit table should NOT have parentKitId
psql $DATABASE_URL -c "\d Kit" | grep parentKitId
# Expected: No results

# Indexes should be removed
psql $DATABASE_URL -c "\di" | grep Kit_parentKitId
# Expected: No results

# Constraints should be removed
psql $DATABASE_URL -c "\d Kit" | grep no_self_reference
# Expected: No results
```

### Application Functionality
- [ ] Can create new kits
- [ ] Can edit existing kits
- [ ] Can create bookings
- [ ] Can view kit details
- [ ] No console errors related to hierarchy
- [ ] Existing bookings still work

### Data Integrity
```bash
# All kits should still exist
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Kit\";"
# Should match count before rollback

# All bookings should still exist
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Booking\";"
# Should match count before rollback

# No orphaned assets
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Asset\" WHERE \"kitId\" NOT IN (SELECT id FROM \"Kit\");"
# Expected: 0
```

---

## Data Loss Assessment

### Option A (Full Restore)
- **Lost data**: All changes made AFTER backup was created
- **Includes**: New kits, bookings, users, etc. created after backup
- **Mitigation**: Minimize time between backup and rollback

### Option B (Migration Rollback)
- **Lost data**: All kit hierarchy relationships (parentKitId values)
- **Preserved**: All kits, bookings, assets, users
- **Impact**: Minimal if feature wasn't used yet

### Option C (Code Rollback)
- **Lost data**: None
- **Impact**: Database has unused columns, but no functional impact

---

## Troubleshooting

### Issue: Backup file not found
```bash
# Check backup location
ls -lh ~/backups/shelf-nu-pre-kit-bundling-*.sql

# If missing, use automated daily backup
ls -lh ~/shelf-full-backup-*.sql
# Use most recent backup before migration date
```

### Issue: Rollback SQL script fails
```bash
# Check error message
psql $DATABASE_URL < docs/rollback/rollback-kit-bundling.sql 2>&1 | tee rollback-error.log

# Common errors:
# - "column does not exist" → Migration not applied yet, rollback not needed
# - "constraint does not exist" → Already rolled back
# - Permission denied → Need superuser access
```

### Issue: Application won't start after rollback
```bash
# Check for references to parentKitId in code
cd ~/shelf.nu
git checkout main  # Ensure on main branch
grep -r "parentKitId" app/ | grep -v node_modules

# If found, code wasn't rolled back properly
```

---

## Re-Implementation Plan

If rollback was due to bugs (not fundamental issues), plan to re-implement:

1. **Root cause analysis**: Document what went wrong
2. **Fix in development**: Create fixes on feature branch
3. **Test thoroughly**: Add tests for failure scenario
4. **Deploy to staging**: Validate fix works
5. **Re-deploy to production**: With same Phase 0 preparation

---

## Incident Report Template

After rollback, create incident report:

```markdown
# Kit Bundling Rollback Incident Report

**Date**: YYYY-MM-DD
**Time**: HH:MM UTC
**Performed by**: [Name]
**Rollback method**: Option A / B / C

## What Went Wrong
[Describe the issue that triggered rollback]

## Impact
- Users affected: [number]
- Downtime: [duration]
- Data loss: [description]
- Bookings impacted: [number]

## Steps Taken
1. [Step 1]
2. [Step 2]
...

## Verification
- [ ] Database schema verified
- [ ] Application functionality tested
- [ ] Data integrity checked
- [ ] Users notified

## Root Cause
[Analysis of what caused the issue]

## Prevention
[How to prevent this in future implementations]

## Next Steps
- [ ] Fix root cause
- [ ] Add tests for failure scenario
- [ ] Re-test on staging
- [ ] Schedule re-deployment
```

---

## Emergency Contacts

**If rollback fails or you need help**:

- **Development Team**: [contact info]
- **Database Admin**: [contact info]
- **DevOps/Infrastructure**: [contact info]
- **On-call Engineer**: [contact info]

---

## Related Documents

- **Implementation Plan**: `docs/plans/Implementation-Plan.md`
- **Phase 0 Checklist**: `docs/plans/Phase-0-Checklist.md`
- **Technical Review**: `docs/plans/Technical-Review.md`
- **Critical Fixes**: `docs/plans/Critical-Fixes.md`

---

**Last Updated**: 2026-03-06  
**Version**: 1.0  
**Status**: Ready for use
