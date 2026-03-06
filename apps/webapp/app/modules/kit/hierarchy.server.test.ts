import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "~/database/db.server";
import {
  getKitHierarchy,
  getKitAncestors,
  getKitDescendants,
  validateKitHierarchy,
  isKitAvailable,
} from "./hierarchy.server";
import { ShelfError } from "~/utils/error";
import type { Kit, Organization, User } from "@prisma/client";

// @vitest-environment node
// Test kit hierarchy utilities with real database operations

describe("Kit Hierarchy", () => {
  let testOrg: Organization;
  let testUser: User;
  let testKits: Kit[] = [];

  // Helper to create a test kit
  async function createTestKit(
    name: string,
    parentKitId?: string | null
  ): Promise<Kit> {
    const kit = await db.kit.create({
      data: {
        name,
        organizationId: testOrg.id,
        createdById: testUser.id,
        parentKitId: parentKitId || null,
      },
    });
    testKits.push(kit);
    return kit;
  }

  // Set up test organization and user before each test
  beforeEach(async () => {
    // Create test organization
    testOrg = await db.organization.create({
      data: {
        name: `Test Org ${Date.now()}`,
        type: "PRO",
      },
    });

    // Create test user
    testUser = await db.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        username: `testuser-${Date.now()}`,
        firstName: "Test",
        lastName: "User",
      },
    });

    // Create user organization membership
    await db.userOrganization.create({
      data: {
        userId: testUser.id,
        organizationId: testOrg.id,
        roles: ["BASE"],
      },
    });
  });

  // Clean up test data after each test
  afterEach(async () => {
    // Delete test kits
    if (testKits.length > 0) {
      await db.kit.deleteMany({
        where: {
          id: {
            in: testKits.map((k) => k.id),
          },
        },
      });
      testKits = [];
    }

    // Delete test user organization membership
    await db.userOrganization.deleteMany({
      where: {
        userId: testUser.id,
        organizationId: testOrg.id,
      },
    });

    // Delete test user
    await db.user.delete({
      where: { id: testUser.id },
    });

    // Delete test organization
    await db.organization.delete({
      where: { id: testOrg.id },
    });
  });

  describe("getKitHierarchy", () => {
    it("fetches kit with no hierarchy", async () => {
      const kit = await createTestKit("Standalone Kit");

      const hierarchy = await getKitHierarchy(kit.id, testOrg.id);

      expect(hierarchy).toBeDefined();
      expect(hierarchy?.id).toBe(kit.id);
      expect(hierarchy?.parentKit).toBeNull();
      expect(hierarchy?.childKits).toEqual([]);
    });

    it("fetches kit with parent and children", async () => {
      // Create: Grandparent -> Parent -> Child
      const grandparent = await createTestKit("Grandparent");
      const parent = await createTestKit("Parent", grandparent.id);
      const child = await createTestKit("Child", parent.id);

      const hierarchy = await getKitHierarchy(parent.id, testOrg.id);

      expect(hierarchy).toBeDefined();
      expect(hierarchy?.id).toBe(parent.id);
      expect(hierarchy?.parentKit?.id).toBe(grandparent.id);
      expect(hierarchy?.childKits).toHaveLength(1);
      expect(hierarchy?.childKits[0]?.id).toBe(child.id);
    });

    it("fetches complete 3-level hierarchy", async () => {
      // Create: Level 1 -> Level 2 -> Level 3
      const level1 = await createTestKit("Level 1");
      const level2 = await createTestKit("Level 2", level1.id);
      const level3 = await createTestKit("Level 3", level2.id);

      const hierarchy = await getKitHierarchy(level2.id, testOrg.id);

      expect(hierarchy).toBeDefined();
      expect(hierarchy?.parentKit?.id).toBe(level1.id);
      expect(hierarchy?.childKits[0]?.id).toBe(level3.id);
    });

    it("returns null for non-existent kit", async () => {
      const hierarchy = await getKitHierarchy("non-existent-id", testOrg.id);
      expect(hierarchy).toBeNull();
    });

    it("returns null for kit in different organization", async () => {
      const kit = await createTestKit("Kit");
      const hierarchy = await getKitHierarchy(kit.id, "different-org-id");
      expect(hierarchy).toBeNull();
    });
  });

  describe("getKitAncestors", () => {
    it("returns empty array for kit with no parents", async () => {
      const kit = await createTestKit("Standalone Kit");

      const ancestors = await getKitAncestors(kit.id, testOrg.id);

      expect(ancestors).toEqual([]);
    });

    it("returns immediate parent", async () => {
      const parent = await createTestKit("Parent");
      const child = await createTestKit("Child", parent.id);

      const ancestors = await getKitAncestors(child.id, testOrg.id);

      expect(ancestors).toHaveLength(1);
      expect(ancestors[0]?.id).toBe(parent.id);
    });

    it("returns all ancestors up to root", async () => {
      // Create: Level 1 -> Level 2 -> Level 3
      const level1 = await createTestKit("Level 1");
      const level2 = await createTestKit("Level 2", level1.id);
      const level3 = await createTestKit("Level 3", level2.id);

      const ancestors = await getKitAncestors(level3.id, testOrg.id);

      expect(ancestors).toHaveLength(2);
      const ancestorIds = ancestors.map((a) => a.id);
      expect(ancestorIds).toContain(level1.id);
      expect(ancestorIds).toContain(level2.id);
    });

    it("respects organization boundary", async () => {
      const parent = await createTestKit("Parent");
      const child = await createTestKit("Child", parent.id);

      const ancestors = await getKitAncestors(child.id, "different-org-id");

      expect(ancestors).toEqual([]);
    });
  });

  describe("getKitDescendants", () => {
    it("returns empty array for kit with no children", async () => {
      const kit = await createTestKit("Standalone Kit");

      const descendants = await getKitDescendants(kit.id, testOrg.id);

      expect(descendants).toEqual([]);
    });

    it("returns immediate children", async () => {
      const parent = await createTestKit("Parent");
      const child1 = await createTestKit("Child 1", parent.id);
      const child2 = await createTestKit("Child 2", parent.id);

      const descendants = await getKitDescendants(parent.id, testOrg.id);

      expect(descendants).toHaveLength(2);
      const descendantIds = descendants.map((d) => d.id);
      expect(descendantIds).toContain(child1.id);
      expect(descendantIds).toContain(child2.id);
    });

    it("returns all descendants recursively", async () => {
      // Create: Level 1 -> Level 2 -> Level 3
      const level1 = await createTestKit("Level 1");
      const level2 = await createTestKit("Level 2", level1.id);
      const level3 = await createTestKit("Level 3", level2.id);

      const descendants = await getKitDescendants(level1.id, testOrg.id);

      expect(descendants).toHaveLength(2);
      const descendantIds = descendants.map((d) => d.id);
      expect(descendantIds).toContain(level2.id);
      expect(descendantIds).toContain(level3.id);
    });

    it("respects organization boundary", async () => {
      const parent = await createTestKit("Parent");
      await createTestKit("Child", parent.id);

      const descendants = await getKitDescendants(parent.id, "different-org-id");

      expect(descendants).toEqual([]);
    });
  });

  describe("validateKitHierarchy", () => {
    it("allows valid parent assignment", async () => {
      const parent = await createTestKit("Parent");
      const child = await createTestKit("Child");

      await expect(
        validateKitHierarchy(child.id, parent.id, testOrg.id)
      ).resolves.toBe(true);
    });

    it("prevents self-reference", async () => {
      const kit = await createTestKit("Kit");

      await expect(
        validateKitHierarchy(kit.id, kit.id, testOrg.id)
      ).rejects.toThrow(ShelfError);

      await expect(
        validateKitHierarchy(kit.id, kit.id, testOrg.id)
      ).rejects.toThrow("cannot be its own parent");
    });

    it("prevents circular references (direct)", async () => {
      const parent = await createTestKit("Parent");
      const child = await createTestKit("Child", parent.id);

      // Try to make parent a child of child (would create cycle)
      await expect(
        validateKitHierarchy(parent.id, child.id, testOrg.id)
      ).rejects.toThrow(ShelfError);

      await expect(
        validateKitHierarchy(parent.id, child.id, testOrg.id)
      ).rejects.toThrow("circular reference");
    });

    it("prevents circular references (indirect)", async () => {
      // Create: A -> B -> C
      const kitA = await createTestKit("Kit A");
      const kitB = await createTestKit("Kit B", kitA.id);
      const kitC = await createTestKit("Kit C", kitB.id);

      // Try to make A a child of C (would create A -> B -> C -> A)
      await expect(
        validateKitHierarchy(kitA.id, kitC.id, testOrg.id)
      ).rejects.toThrow(ShelfError);

      await expect(
        validateKitHierarchy(kitA.id, kitC.id, testOrg.id)
      ).rejects.toThrow("circular reference");
    });

    it("prevents cross-organization hierarchy", async () => {
      const parent = await createTestKit("Parent");

      // Create another organization
      const otherOrg = await db.organization.create({
        data: {
          name: `Other Org ${Date.now()}`,
          type: "PRO",
        },
      });

      try {
        await expect(
          validateKitHierarchy("some-kit-id", parent.id, otherOrg.id)
        ).rejects.toThrow(ShelfError);

        await expect(
          validateKitHierarchy("some-kit-id", parent.id, otherOrg.id)
        ).rejects.toThrow("does not belong to your organization");
      } finally {
        // Clean up
        await db.organization.delete({
          where: { id: otherOrg.id },
        });
      }
    });

    it("enforces max depth of 3 levels", async () => {
      // Create: Level 1 -> Level 2 -> Level 3
      const level1 = await createTestKit("Level 1");
      const level2 = await createTestKit("Level 2", level1.id);
      const level3 = await createTestKit("Level 3", level2.id);
      const level4 = await createTestKit("Level 4");

      // Try to make level4 a child of level3 (would create 4 levels)
      await expect(
        validateKitHierarchy(level4.id, level3.id, testOrg.id)
      ).rejects.toThrow(ShelfError);

      await expect(
        validateKitHierarchy(level4.id, level3.id, testOrg.id)
      ).rejects.toThrow("Maximum nesting depth");
    });

    it("correctly calculates total depth with existing children", async () => {
      // Create: Parent with Child
      const parent = await createTestKit("Parent");
      const child = await createTestKit("Child", parent.id);

      // Create: Grandparent -> GreatGrandparent
      const grandparent = await createTestKit("Grandparent");
      const greatGrandparent = await createTestKit(
        "Great Grandparent",
        grandparent.id
      );

      // Try to make parent a child of greatGrandparent
      // This would create: Grandparent -> GreatGrandparent -> Parent -> Child (4 levels)
      await expect(
        validateKitHierarchy(parent.id, greatGrandparent.id, testOrg.id)
      ).rejects.toThrow(ShelfError);

      await expect(
        validateKitHierarchy(parent.id, greatGrandparent.id, testOrg.id)
      ).rejects.toThrow("Maximum nesting depth");
    });

    it("allows hierarchy at exactly 3 levels", async () => {
      // Create: Level 1 -> Level 2
      const level1 = await createTestKit("Level 1");
      const level2 = await createTestKit("Level 2", level1.id);
      const level3 = await createTestKit("Level 3");

      // This should succeed (would create exactly 3 levels)
      await expect(
        validateKitHierarchy(level3.id, level2.id, testOrg.id)
      ).resolves.toBe(true);
    });

    it("throws error for invalid kit ID format", async () => {
      await expect(
        validateKitHierarchy("invalid-id", "also-invalid", testOrg.id)
      ).rejects.toThrow(ShelfError);

      await expect(
        validateKitHierarchy("invalid-id", "also-invalid", testOrg.id)
      ).rejects.toThrow("Invalid kit ID format");
    });
  });

  describe("isKitAvailable", () => {
    it("returns true for kit with no bookings", async () => {
      const kit = await createTestKit("Available Kit");

      const available = await isKitAvailable(
        kit.id,
        {
          from: new Date("2026-03-10"),
          to: new Date("2026-03-15"),
        },
        testOrg.id
      );

      expect(available).toBe(true);
    });

    it("returns false when kit has conflicting booking", async () => {
      const kit = await createTestKit("Booked Kit");

      // Create an asset in the kit
      const asset = await db.asset.create({
        data: {
          title: "Test Asset",
          organizationId: testOrg.id,
          kitId: kit.id,
        },
      });
      testKits.push(kit); // Track for cleanup

      // Create a booking
      const booking = await db.booking.create({
        data: {
          name: "Test Booking",
          organizationId: testOrg.id,
          status: "RESERVED",
          from: new Date("2026-03-10"),
          to: new Date("2026-03-15"),
          creatorId: testUser.id,
          assets: {
            connect: { id: asset.id },
          },
        },
      });

      try {
        // Check availability during booking period
        const available = await isKitAvailable(
          kit.id,
          {
            from: new Date("2026-03-12"),
            to: new Date("2026-03-14"),
          },
          testOrg.id
        );

        expect(available).toBe(false);
      } finally {
        // Clean up
        await db.booking.delete({ where: { id: booking.id } });
        await db.asset.delete({ where: { id: asset.id } });
      }
    });

    it("returns false when parent kit has conflicting booking", async () => {
      const parent = await createTestKit("Parent Kit");
      const child = await createTestKit("Child Kit", parent.id);

      // Create asset in parent kit
      const parentAsset = await db.asset.create({
        data: {
          title: "Parent Asset",
          organizationId: testOrg.id,
          kitId: parent.id,
        },
      });

      // Create booking on parent
      const booking = await db.booking.create({
        data: {
          name: "Parent Booking",
          organizationId: testOrg.id,
          status: "RESERVED",
          from: new Date("2026-03-10"),
          to: new Date("2026-03-15"),
          creatorId: testUser.id,
          assets: {
            connect: { id: parentAsset.id },
          },
        },
      });

      try {
        // Check child availability (should be false because parent is booked)
        const available = await isKitAvailable(
          child.id,
          {
            from: new Date("2026-03-12"),
            to: new Date("2026-03-14"),
          },
          testOrg.id
        );

        expect(available).toBe(false);
      } finally {
        // Clean up
        await db.booking.delete({ where: { id: booking.id } });
        await db.asset.delete({ where: { id: parentAsset.id } });
      }
    });

    it("returns false when child kit has conflicting booking", async () => {
      const parent = await createTestKit("Parent Kit");
      const child = await createTestKit("Child Kit", parent.id);

      // Create asset in child kit
      const childAsset = await db.asset.create({
        data: {
          title: "Child Asset",
          organizationId: testOrg.id,
          kitId: child.id,
        },
      });

      // Create booking on child
      const booking = await db.booking.create({
        data: {
          name: "Child Booking",
          organizationId: testOrg.id,
          status: "RESERVED",
          from: new Date("2026-03-10"),
          to: new Date("2026-03-15"),
          creatorId: testUser.id,
          assets: {
            connect: { id: childAsset.id },
          },
        },
      });

      try {
        // Check parent availability (should be false because child is booked)
        const available = await isKitAvailable(
          parent.id,
          {
            from: new Date("2026-03-12"),
            to: new Date("2026-03-14"),
          },
          testOrg.id
        );

        expect(available).toBe(false);
      } finally {
        // Clean up
        await db.booking.delete({ where: { id: booking.id } });
        await db.asset.delete({ where: { id: childAsset.id } });
      }
    });

    it("returns true for non-overlapping bookings", async () => {
      const kit = await createTestKit("Kit");

      // Create asset
      const asset = await db.asset.create({
        data: {
          title: "Test Asset",
          organizationId: testOrg.id,
          kitId: kit.id,
        },
      });

      // Create booking for different time period
      const booking = await db.booking.create({
        data: {
          name: "Test Booking",
          organizationId: testOrg.id,
          status: "RESERVED",
          from: new Date("2026-03-01"),
          to: new Date("2026-03-05"),
          creatorId: testUser.id,
          assets: {
            connect: { id: asset.id },
          },
        },
      });

      try {
        // Check availability for later period (should be true)
        const available = await isKitAvailable(
          kit.id,
          {
            from: new Date("2026-03-10"),
            to: new Date("2026-03-15"),
          },
          testOrg.id
        );

        expect(available).toBe(true);
      } finally {
        // Clean up
        await db.booking.delete({ where: { id: booking.id } });
        await db.asset.delete({ where: { id: asset.id } });
      }
    });
  });

  describe("Organization Boundary Enforcement", () => {
    it("prevents accessing kits from different organizations", async () => {
      const kit = await createTestKit("Kit");

      // Create another organization
      const otherOrg = await db.organization.create({
        data: {
          name: `Other Org ${Date.now()}`,
          type: "PRO",
        },
      });

      try {
        const hierarchy = await getKitHierarchy(kit.id, otherOrg.id);
        expect(hierarchy).toBeNull();

        const ancestors = await getKitAncestors(kit.id, otherOrg.id);
        expect(ancestors).toEqual([]);

        const descendants = await getKitDescendants(kit.id, otherOrg.id);
        expect(descendants).toEqual([]);
      } finally {
        // Clean up
        await db.organization.delete({
          where: { id: otherOrg.id },
        });
      }
    });
  });
});
