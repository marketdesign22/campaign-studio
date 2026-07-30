import { z } from "zod";
import { createCategory, deleteCategory, listCategories } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

export const categoriesRouter = router({
  list: protectedProcedure.query(() => listCategories()),
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(64), color: z.string().default("#335B82") }))
    .mutation(async ({ input }) => { await createCategory(input.name, input.color); return { ok: true }; }),
  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => { await deleteCategory(input.id); return { ok: true }; }),
});
