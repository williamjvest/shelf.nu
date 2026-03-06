import type { Kit } from "@prisma/client";
import { z } from "zod";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

/**
 * Kit with hierarchy relations
 */
export interface KitWithHierarchy extends Kit {
  parentKit?: KitWithHierarchy | null;
  childKits: KitWithHierarchy[];
}

/**
 * Fetch kit with full hierarchy (ancestors and descendants)
 * Uses Prisma's recursive include for efficient querying
 * 
 * @param kitId - ID of the kit to fetch
 * @param organizationId - Organization ID for authorization
 * @returns Kit with hierarchy or null if not found
 */
export async function getKitHierarchy(
  kitId: string,
  organizationId: string
): Promise<KitWithHierarchy | null> {
  // Validate inputs
  const kitIdSchema = z.string().cuid();
  kitIdSchema.parse(kitId);
  kitIdSchema.parse(organizationId);

  // Use Prisma's recursive include (up to max depth of 3)
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

  return kit;
}

/**
 * Get all ancestor kits (parents, grandparents, etc.)
 * Uses recursive CTE for efficient traversal
 * 
 * @param kitId - ID of the kit
 * @param organizationId - Organization ID for authorization
 * @returns Array of ancestor kits (empty if no ancestors)
 */
export async function getKitAncestors(
  kitId: string,
  organizationId: string
): Promise<Kit[]> {
  // Validate inputs
  const kitIdSchema = z.string().cuid();
  kitIdSchema.parse(kitId);
  kitIdSchema.parse(organizationId);

  const result = await db.$queryRaw<Kit[]>`
    WITH RECURSIVE ancestors AS (
      SELECT * FROM "Kit" WHERE id = ${kitId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT k.* FROM "Kit" k
      INNER JOIN ancestors a ON k.id = a."parentKitId"
      WHERE k."organizationId" = ${organizationId}
    )
    SELECT * FROM ancestors WHERE id != ${kitId}
  `;

  return result;
}

/**
 * Get all descendant kits (children, grandchildren, etc.)
 * Uses recursive CTE for efficient traversal
 * 
 * @param kitId - ID of the kit
 * @param organizationId - Organization ID for authorization
 * @returns Array of descendant kits (empty if no children)
 */
export async function getKitDescendants(
  kitId: string,
  organizationId: string
): Promise<Kit[]> {
  // Validate inputs
  const kitIdSchema = z.string().cuid();
  kitIdSchema.parse(kitId);
  kitIdSchema.parse(organizationId);

  const result = await db.$queryRaw<Kit[]>`
    WITH RECURSIVE descendants AS (
      SELECT * FROM "Kit" WHERE id = ${kitId} AND "organizationId" = ${organizationId}
      UNION ALL
      SELECT k.* FROM "Kit" k
      INNER JOIN descendants d ON k."parentKitId" = d.id
      WHERE k."organizationId" = ${organizationId}
    )
    SELECT * FROM descendants WHERE id != ${kitId}
  `;

  return result;
}

/**
 * Validate that adding parentKitId won't create circular reference
 * or exceed max depth. Also enforces organization boundaries.
 * 
 * Throws ShelfError if validation fails.
 * Returns true if validation passes.
 * 
 * Security:
 * - Validates inputs to prevent SQL injection
 * - Enforces organization boundary (parent must be in same org)
 * - Prevents circular references
 * - Enforces max depth of 3 levels
 * 
 * @param kitId - ID of the kit to modify
 * @param parentKitId - ID of the proposed parent kit
 * @param organizationId - Organization ID for authorization
 * @returns true if valid
 * @throws ShelfError if validation fails
 */
export async function validateKitHierarchy(
  kitId: string,
  parentKitId: string,
  organizationId: string
): Promise<boolean> {
  // SECURITY: Validate inputs (prevent SQL injection)
  const kitIdSchema = z.string().cuid();
  
  try {
    kitIdSchema.parse(kitId);
    kitIdSchema.parse(parentKitId);
    kitIdSchema.parse(organizationId);
  } catch (error) {
    throw new ShelfError({
      cause: error,
      label: "Kit",
      message: "Invalid kit ID format",
      status: 400,
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

  // SECURITY: Verify parent kit belongs to same organization
  const parentKit = await db.kit.findFirst({
    where: { id: parentKitId, organizationId },
    select: { id: true, organizationId: true },
  });

  if (!parentKit) {
    throw new ShelfError({
      cause: null,
      label: "Kit",
      message: "Parent kit not found or does not belong to your organization",
      status: 403,
    });
  }

  // PERFORMANCE: Single recursive CTE to check circular refs AND depth
  const validation = await db.$queryRaw<
    [
      {
        wouldCreateCycle: boolean;
        parentDepth: number;
        childDepth: number;
      },
    ]
  >`
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
      message: "Cannot set parent: would create circular reference",
      status: 400,
    });
  }

  // FIX: Check TOTAL depth (parent ancestors + 1 + child descendants)
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

/**
 * Check if a kit is available for booking in a given date range.
 * Considers both direct bookings on the kit and bookings on ancestor/descendant kits.
 * 
 * @param kitId - ID of the kit to check
 * @param dateRange - { from: Date, to: Date }
 * @param organizationId - Organization ID for authorization
 * @returns true if available, false if conflicts exist
 */
export async function isKitAvailable(
  kitId: string,
  dateRange: { from: Date; to: Date },
  organizationId: string
): Promise<boolean> {
  // Validate inputs
  const kitIdSchema = z.string().cuid();
  kitIdSchema.parse(kitId);
  kitIdSchema.parse(organizationId);

  const { from, to } = dateRange;

  // Get all related kits (ancestors + descendants)
  const [ancestors, descendants] = await Promise.all([
    getKitAncestors(kitId, organizationId),
    getKitDescendants(kitId, organizationId),
  ]);

  const relatedKitIds = [
    kitId,
    ...ancestors.map((a) => a.id),
    ...descendants.map((d) => d.id),
  ];

  // Check for any conflicting RESERVED or ONGOING bookings on related kits
  const conflictCount = await db.booking.count({
    where: {
      organizationId,
      status: {
        in: ["RESERVED", "ONGOING"],
      },
      assets: {
        some: {
          kitId: {
            in: relatedKitIds,
          },
        },
      },
      OR: [
        { from: { lte: to }, to: { gte: from } },
        { from: { gte: from }, to: { lte: to } },
      ],
    },
  });

  return conflictCount === 0;
}
