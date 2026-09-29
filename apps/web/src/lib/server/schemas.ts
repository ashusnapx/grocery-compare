import { z } from 'zod';
import { PLATFORM_IDS, type PlatformId } from '@gc/engine';

const platformId = z.enum(PLATFORM_IDS as unknown as [PlatformId, ...PlatformId[]]);

export const LocationSchema = z.object({
  lat: z.number().min(6).max(38),
  lng: z.number().min(68).max(98),
  pincode: z.string().regex(/^\d{6}$/),
  approximate: z.boolean(),
  label: z.string().max(120).optional(),
});

export const SettingsSchema = z.object({
  memberships: z.array(z.enum(['zepto_club', 'swiggy_one'])).max(5).default([]),
  excluded: z.array(platformId).max(6).default([]),
  overrides: z
    .array(
      z.object({
        platformId,
        deliveryFee: z.number().min(0).max(500).optional(),
        freeDeliveryAbove: z.number().min(0).max(10000).optional(),
        handlingFee: z.number().min(0).max(500).optional(),
        smallCartFee: z.number().min(0).max(500).optional(),
        smallCartBelow: z.number().min(0).max(10000).optional(),
        minOrder: z.number().min(0).max(10000).nullable().optional(),
      }),
    )
    .max(6)
    .default([]),
});

export const RowSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(100_000),
  unit: z.enum(['g', 'kg', 'ml', 'L', 'pcs', 'dozen', 'pack']),
  anyBrand: z.boolean(),
  pins: z.record(z.string(), z.string().max(128)).optional(),
});

export const CompareSchema = z.object({
  rows: z.array(RowSchema).min(1).max(60),
  location: LocationSchema,
  settings: SettingsSchema,
  /** Access tokens for the shopper's signed-in apps, used for this comparison only. */
  accounts: z.object({ zepto: z.string().min(8).max(4096).optional(), instamart: z.string().min(8).max(4096).optional() }).optional(),
});

const FillSchema = z.object({
  itemId: z.string().max(64),
  platformId,
  packs: z.array(z.object({ listingId: z.string().max(128), count: z.number(), size: z.number(), price: z.number(), title: z.string().max(300) })).max(12),
  quantity: z.number(),
  cost: z.number().positive().max(1_000_000),
  overBuy: z.boolean(),
  stepUp: z.boolean().optional(),
  label: z.string().max(300),
  packLabel: z.string().max(200),
  brand: z.string().max(120).nullable(),
  imageUrl: z.string().max(1000).nullable(),
  productUrl: z.string().max(1000),
});

export const PlanSchema = z.object({
  rows: z.array(z.object({ id: z.string().max(64), label: z.string().max(120), brandLocked: z.boolean() })).min(1).max(60),
  platforms: z
    .array(
      z.object({
        platformId,
        eta: z.string().max(60).nullable(),
        feeHints: z
          .object({
            minOrder: z.number().nullable().optional(),
            freeDeliveryAbove: z.number().nullable().optional(),
            deliveryFee: z.number().nullable().optional(),
            handlingFee: z.number().nullable().optional(),
            smallCartFee: z.number().nullable().optional(),
            smallCartBelow: z.number().nullable().optional(),
            surgeFee: z.number().nullable().optional(),
            packagingFee: z.number().nullable().optional(),
            platformFee: z.number().nullable().optional(),
          })
          .optional(),
      }),
    )
    .max(6),
  fills: z.array(FillSchema).max(60 * 6 * 3),
  unlockedFills: z.array(FillSchema).max(60 * 6 * 3),
  settings: SettingsSchema,
});
